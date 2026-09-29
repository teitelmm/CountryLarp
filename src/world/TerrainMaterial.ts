import * as THREE from 'three';

/**
 * Terrain shading built on MeshLambertMaterial via onBeforeCompile, so three's lighting, shadow
 * maps and fog keep working while the vertex shader displaces a flat chunk grid by the height
 * texture and the fragment shader colours it.
 *
 * Data texture (RGBA32F, one texel per height node, sampled with texelFetch):
 *   R = height (world units)  G = pad weight (0..1)  B = normal.x  A = normal.z
 * Mask texture (R8, linear filtered): 1 inside the country's border.
 */
export interface TerrainUniforms {
  uData: THREE.IUniform<THREE.Texture>;
  uMask: THREE.IUniform<THREE.Texture>;
  uGridF: THREE.IUniform<THREE.Vector2>;
  uCell: THREE.IUniform<number>;
  uHalf: THREE.IUniform<THREE.Vector2>;
  uSkirt: THREE.IUniform<number>;
  uExag: THREE.IUniform<number>;
  /** xz = cursor position, z = radius of the placement grid overlay. */
  uCursor: THREE.IUniform<THREE.Vector3>;
  uGridStep: THREE.IUniform<number>;
  uGridAlpha: THREE.IUniform<number>;
}

const SHARED = /* glsl */ `
uniform sampler2D uData;
uniform vec2 uGridF;
uniform float uCell;
uniform vec2 uHalf;
varying vec2 vTerrainXZ;

vec2 tGrid(vec2 xz) { return xz / uCell + (uGridF - 1.0) * 0.5; }
vec4 tTexel(ivec2 p) { return texelFetch(uData, clamp(p, ivec2(0), ivec2(uGridF) - 1), 0); }
`;

const VERTEX_PARS = /* glsl */ `
${SHARED}
uniform float uSkirt;

float tNode(ivec2 p) { return tTexel(p).r; }

float tLinear(vec2 xz) {
  vec2 g = clamp(tGrid(xz), vec2(0.0), uGridF - 1.0);
  ivec2 p = min(ivec2(floor(g)), ivec2(uGridF) - 2);
  vec2 t = g - vec2(p);
  return mix(mix(tNode(p), tNode(p + ivec2(1, 0)), t.x),
             mix(tNode(p + ivec2(0, 1)), tNode(p + ivec2(1, 1)), t.x), t.y);
}

float tCR(float a, float b, float c, float d, float t) {
  return b + 0.5 * t * (c - a + t * (2.0 * a - 5.0 * b + 4.0 * c - d + t * (3.0 * (b - c) + d - a)));
}

// Catmull-Rom bicubic: identical to HeightField.sample() on the CPU.
float tBicubic(vec2 xz) {
  vec2 g = tGrid(xz);
  vec2 f = floor(g);
  vec2 t = g - f;
  ivec2 p = ivec2(f);
  float r0 = tCR(tNode(p + ivec2(-1, -1)), tNode(p + ivec2(0, -1)), tNode(p + ivec2(1, -1)), tNode(p + ivec2(2, -1)), t.x);
  float r1 = tCR(tNode(p + ivec2(-1, 0)),  tNode(p + ivec2(0, 0)),  tNode(p + ivec2(1, 0)),  tNode(p + ivec2(2, 0)),  t.x);
  float r2 = tCR(tNode(p + ivec2(-1, 1)),  tNode(p + ivec2(0, 1)),  tNode(p + ivec2(1, 1)),  tNode(p + ivec2(2, 1)),  t.x);
  float r3 = tCR(tNode(p + ivec2(-1, 2)),  tNode(p + ivec2(0, 2)),  tNode(p + ivec2(1, 2)),  tNode(p + ivec2(2, 2)),  t.x);
  return tCR(r0, r1, r2, r3, t.y);
}
`;

const VERTEX_BODY = /* glsl */ `
// Chunk meshes carry local xz in [0, size]; position.y is the skirt flag (0 or 1).
vec4 tWorld = modelMatrix * vec4(position, 1.0);
vec2 tXZ = clamp(tWorld.xz, -uHalf, uHalf);
vTerrainXZ = tXZ;
#ifdef TERRAIN_BICUBIC
float tH = tBicubic(tXZ);
#else
float tH = tLinear(tXZ);
#endif
vec3 transformed = vec3(tXZ.x - modelMatrix[3].x, tH - uSkirt * position.y, tXZ.y - modelMatrix[3].z);
`;

const FRAGMENT_PARS = /* glsl */ `
${SHARED}
uniform sampler2D uMask;
uniform float uExag;
uniform vec3 uCursor;
uniform float uGridStep;
uniform float uGridAlpha;

vec4 tBilinear(vec2 xz) {
  vec2 g = clamp(tGrid(xz), vec2(0.0), uGridF - 1.0);
  ivec2 p = min(ivec2(floor(g)), ivec2(uGridF) - 2);
  vec2 t = g - vec2(p);
  return mix(mix(tTexel(p), tTexel(p + ivec2(1, 0)), t.x),
             mix(tTexel(p + ivec2(0, 1)), tTexel(p + ivec2(1, 1)), t.x), t.y);
}

float tHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float tNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(tHash(i), tHash(i + vec2(1.0, 0.0)), f.x), mix(tHash(i + vec2(0.0, 1.0)), tHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
vec3 tLin(vec3 c) { return pow(c, vec3(2.2)); }

vec3 terrainAlbedo(float hM, float depthW, float ny, float pad, vec2 xz, float inside) {
  float n1 = tNoise(xz * 1.7);
  float n2 = tNoise(xz * 0.31);
  float n3 = tNoise(xz * 7.3);
  // Land cover: broad farmland/meadow regions with smaller forest patches (no real land-cover data).
  float regionL = tNoise(xz * 0.045) * 0.65 + tNoise(xz * 0.11 + 9.0) * 0.35;
  float forestN = tNoise(xz * 0.21 + 3.0) * 0.6 + tNoise(xz * 0.5) * 0.4;
  vec3 meadow = mix(tLin(vec3(0.35, 0.52, 0.23)), tLin(vec3(0.42, 0.57, 0.26)), n1);
  vec3 farm   = mix(tLin(vec3(0.55, 0.60, 0.30)), tLin(vec3(0.49, 0.59, 0.27)), n2);
  vec3 forest = mix(tLin(vec3(0.16, 0.31, 0.15)), tLin(vec3(0.20, 0.35, 0.18)), n3);
  vec3 grass = mix(meadow, farm, smoothstep(0.48, 0.62, regionL));
  float forestMask = smoothstep(0.58, 0.68, forestN) * (1.0 - 0.5 * smoothstep(0.50, 0.62, regionL));
  grass = mix(grass, forest, forestMask * 0.85);
  vec3 dry   = mix(tLin(vec3(0.52, 0.50, 0.30)), tLin(vec3(0.46, 0.40, 0.27)), n2);
  vec3 rock  = mix(tLin(vec3(0.40, 0.37, 0.34)), tLin(vec3(0.56, 0.53, 0.49)), n1);
  vec3 snow  = tLin(vec3(0.93, 0.95, 0.98));
  vec3 sand  = tLin(vec3(0.76, 0.70, 0.52));
  vec3 c = grass;
  c = mix(c, dry, smoothstep(300.0, 900.0, hM) * (0.4 + 0.6 * n2));
  c = mix(c, rock, smoothstep(900.0, 1700.0, hM));
  c = mix(c, snow, smoothstep(2200.0, 2900.0, hM + (n3 - 0.5) * 250.0));
  c = mix(c, sand, (1.0 - smoothstep(1.0, 9.0, hM)) * step(0.0, hM));
  c = mix(c, rock, smoothstep(0.86, 0.62, ny));
  // Graded building pads read as gravel/concrete.
  c = mix(c, tLin(vec3(0.62, 0.59, 0.52)), smoothstep(0.5, 0.95, pad) * 0.9);
  // Seabed under the (transparent) water plane.
  vec3 bed = mix(tLin(vec3(0.62, 0.62, 0.48)), tLin(vec3(0.10, 0.18, 0.26)), smoothstep(0.0, 0.5, depthW));
  c = mix(c, bed, smoothstep(0.0, 0.003, depthW));
  // Outside the border: desaturated and darker, so your territory reads at a glance.
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  c = mix(c, vec3(l) * vec3(0.78, 0.82, 0.90) * 0.85, (1.0 - inside) * 0.7);
  return c;
}
`;

const FRAGMENT_COLOR = /* glsl */ `
vec4 tS = tBilinear(vTerrainXZ);
float tInside = smoothstep(0.35, 0.65, texture2D(uMask, (tGrid(vTerrainXZ) + 0.5) / uGridF).r);
float tHM = tS.r / uExag * 1000.0;
vec3 tN = vec3(tS.b, sqrt(max(0.0, 1.0 - tS.b * tS.b - tS.a * tS.a)), tS.a);
diffuseColor.rgb = terrainAlbedo(tHM, -tS.r, tN.y, tS.g, vTerrainXZ, tInside);
// Fine detail: perturb the shading normal a little, but not on flat graded pads.
float tDetail = (1.0 - tS.g) * 0.10;
tN = normalize(tN + tDetail * vec3(tNoise(vTerrainXZ * 9.0) - 0.5, 0.0, tNoise(vTerrainXZ * 9.0 + 31.0) - 0.5));
// Placement grid overlay around the cursor.
if (uGridAlpha > 0.0) {
  vec2 gp = vTerrainXZ / uGridStep;
  vec2 gd = abs(fract(gp - 0.5) - 0.5) / max(fwidth(gp), vec2(1e-4));
  float gl = 1.0 - min(min(gd.x, gd.y), 1.0);
  float gf = 1.0 - smoothstep(uCursor.z * 0.55, uCursor.z, distance(vTerrainXZ, uCursor.xy));
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.92, 0.96, 1.0), gl * gf * uGridAlpha * 0.4);
}
`;

const FRAGMENT_NORMAL = /* glsl */ `
normal = normalize((viewMatrix * vec4(tN, 0.0)).xyz);
`;

export function createTerrainUniforms(
  data: THREE.Texture,
  mask: THREE.Texture,
  cols: number,
  rows: number,
  cell: number,
  halfX: number,
  halfZ: number,
  exag: number,
): TerrainUniforms {
  return {
    uData: { value: data },
    uMask: { value: mask },
    uGridF: { value: new THREE.Vector2(cols, rows) },
    uCell: { value: cell },
    uHalf: { value: new THREE.Vector2(halfX, halfZ) },
    uSkirt: { value: 1.5 },
    uExag: { value: exag },
    uCursor: { value: new THREE.Vector3(0, 0, 6) },
    uGridStep: { value: 0.5 },
    uGridAlpha: { value: 0 },
  };
}

/** `near` enables bicubic height sampling (only the finest LOD samples between lattice nodes). */
export function createTerrainMaterial(uniforms: TerrainUniforms, near: boolean): THREE.MeshLambertMaterial {
  const material = new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide });
  if (near) material.defines = { TERRAIN_BICUBIC: '' };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERTEX_PARS}`)
      .replace('#include <begin_vertex>', VERTEX_BODY);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAGMENT_PARS}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${FRAGMENT_COLOR}`)
      .replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>\n${FRAGMENT_NORMAL}`);
  };
  material.customProgramCacheKey = () => (near ? 'terrain-near' : 'terrain-far');
  return material;
}
