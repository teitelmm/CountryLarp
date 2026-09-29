import * as THREE from 'three';
import type { TerrainUniforms } from './TerrainMaterial';

/**
 * Sea-level water plane. It reads the terrain height texture to tint by depth, fade out at the
 * shore and foam along the coastline. The plane extends far past the map so the sea reaches the
 * horizon (the terrain fades into fog at its edge).
 */
export class Water {
  readonly mesh: THREE.Mesh;
  private readonly material: THREE.ShaderMaterial;

  constructor(terrain: TerrainUniforms, sunDir: THREE.Vector3, mapSize: number) {
    this.material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      fog: true,
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        {
          uTime: { value: 0 },
          uSunDir: { value: sunDir.clone().normalize() },
        },
      ]),
      vertexShader: /* glsl */ `
        varying vec3 vWorld;
        #include <fog_pars_vertex>
        void main() {
          vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
          vec4 mvPosition = viewMatrix * vec4(vWorld, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uData;
        uniform vec2 uGridF;
        uniform float uCell;
        uniform vec2 uHalf;
        uniform float uTime;
        uniform vec3 uSunDir;
        varying vec3 vWorld;
        #include <common>
        #include <fog_pars_fragment>

        float terrainHeight(vec2 xz) {
          vec2 g = clamp(xz / uCell + (uGridF - 1.0) * 0.5, vec2(0.0), uGridF - 1.0);
          ivec2 p = min(ivec2(floor(g)), ivec2(uGridF) - 2);
          vec2 t = g - vec2(p);
          float a = texelFetch(uData, p, 0).r;
          float b = texelFetch(uData, p + ivec2(1, 0), 0).r;
          float c = texelFetch(uData, p + ivec2(0, 1), 0).r;
          float d = texelFetch(uData, p + ivec2(1, 1), 0).r;
          return mix(mix(a, b, t.x), mix(c, d, t.x), t.y);
        }

        void main() {
          // Outside the lattice we are open sea.
          bool inMap = abs(vWorld.x) < uHalf.x && abs(vWorld.z) < uHalf.y;
          float depth = inMap ? max(0.0, -terrainHeight(vWorld.xz)) : 10.0;

          vec3 shallow = pow(vec3(0.22, 0.60, 0.66), vec3(2.2));
          vec3 deep = pow(vec3(0.03, 0.17, 0.32), vec3(2.2));
          float k = 1.0 - exp(-depth * 7.0);
          vec3 col = mix(shallow, deep, k);

          // Gentle ripples from three non-aligned waves (separable sines look like a grid).
          vec2 p = vWorld.xz;
          vec2 d1 = normalize(vec2(1.0, 0.6));
          vec2 d2 = normalize(vec2(-0.4, 1.0));
          vec2 d3 = normalize(vec2(0.7, -0.9));
          vec2 grad = d1 * cos(dot(p, d1) * 2.1 + uTime * 0.9) * 0.030
                    + d2 * cos(dot(p, d2) * 3.3 - uTime * 1.2) * 0.022
                    + d3 * cos(dot(p, d3) * 5.1 + uTime * 1.6) * 0.012;
          vec3 n = normalize(vec3(-grad.x, 1.0, -grad.y));
          vec3 V = normalize(cameraPosition - vWorld);
          float fres = pow(1.0 - max(dot(n, V), 0.0), 4.0);
          vec3 sky = pow(vec3(0.62, 0.76, 0.92), vec3(2.2));
          col = mix(col, sky, fres * 0.55);
          vec3 R = reflect(-uSunDir, n);
          col += vec3(1.0, 0.95, 0.85) * pow(max(dot(R, V), 0.0), 120.0) * 0.8;

          // Shore: foam line, and fade so the beach shows through.
          float foam = (1.0 - smoothstep(0.0, 0.012, depth)) * (0.65 + 0.35 * sin(uTime * 1.5 + p.x * 6.0 + p.y * 5.0));
          col = mix(col, vec3(0.95), clamp(foam, 0.0, 1.0) * 0.6);
          float alpha = mix(0.38, 0.93, k) * smoothstep(0.0, 0.010, depth);
          alpha = max(alpha, foam * 0.5);

          gl_FragColor = vec4(col, alpha);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <fog_fragment>
        }
      `,
    });
    // Share the terrain's uniforms by reference so the water follows terrain edits.
    this.material.uniforms.uData = terrain.uData;
    this.material.uniforms.uGridF = terrain.uGridF;
    this.material.uniforms.uCell = terrain.uCell;
    this.material.uniforms.uHalf = terrain.uHalf;

    const geo = new THREE.PlaneGeometry(mapSize * 8, mapSize * 8, 1, 1);
    geo.rotateX(-Math.PI / 2);
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.renderOrder = 1; // after opaque terrain
    this.mesh.frustumCulled = false;
  }

  update(time: number) {
    this.material.uniforms.uTime.value = time;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
