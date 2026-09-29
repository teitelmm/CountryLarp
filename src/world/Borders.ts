import * as THREE from 'three';
import type { CountryMeta } from './CountryData';
import type { HeightField } from './HeightField';

const MAX_SEGMENT = 1.0; // km: resample border edges so the curtain follows the terrain

/**
 * The country border as a translucent "curtain" hugging the terrain: a bright line on the ground
 * fading upward. Its height grows with camera distance so it stays a readable line at country zoom.
 */
export class Borders {
  readonly mesh: THREE.Mesh;
  private readonly material: THREE.ShaderMaterial;

  constructor(meta: CountryMeta, hf: HeightField) {
    const positions: number[] = [];
    const top: number[] = [];
    const along: number[] = [];
    const indices: number[] = [];

    for (const polygon of meta.borders) {
      // Only outer rings (index 0) and holes alike are drawn: all are border.
      for (const ring of polygon) {
        if (ring.length < 3) continue;
        let dist = 0;
        let prev: [number, number] | null = null;
        const first = positions.length / 3;
        const push = (x: number, z: number) => {
          if (prev) dist += Math.hypot(x - prev[0], z - prev[1]);
          prev = [x, z];
          const y = hf.surface(x, z);
          positions.push(x, y, z, x, y, z); // bottom, top (top is lifted in the shader)
          top.push(0, 1);
          along.push(dist, dist);
        };
        for (let k = 0; k < ring.length; k++) {
          const [x0, z0] = ring[k];
          const [x1, z1] = ring[(k + 1) % ring.length];
          const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / MAX_SEGMENT));
          for (let s = 0; s < steps; s++) push(x0 + ((x1 - x0) * s) / steps, z0 + ((z1 - z0) * s) / steps);
        }
        const count = positions.length / 3 / 2 - first / 2;
        for (let v = 0; v < count; v++) {
          const a = first + v * 2;
          const b = first + ((v + 1) % count) * 2;
          indices.push(a, a + 1, b, a + 1, b + 1, b);
        }
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('aTop', new THREE.Float32BufferAttribute(top, 1));
    geo.setAttribute('aAlong', new THREE.Float32BufferAttribute(along, 1));
    geo.setIndex(indices);

    const color = new THREE.Color(meta.colors.primary).lerp(new THREE.Color(0xffffff), 0.35);
    this.material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: true,
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        {
          uHeight: { value: 2 },
          uTime: { value: 0 },
          uColor: { value: color },
        },
      ]),
      vertexShader: /* glsl */ `
        attribute float aTop;
        attribute float aAlong;
        uniform float uHeight;
        varying float vTop;
        varying float vAlong;
        #include <fog_pars_vertex>
        void main() {
          vTop = aTop;
          vAlong = aAlong;
          vec3 p = position;
          p.y += 0.03 + aTop * uHeight;
          vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        uniform float uTime;
        varying float vTop;
        varying float vAlong;
        #include <common>
        #include <fog_pars_fragment>
        void main() {
          float fade = pow(1.0 - vTop, 1.6);
          float base = 1.0 - smoothstep(0.0, 0.10, vTop);
          float pulse = 0.85 + 0.15 * sin(vAlong * 0.5 - uTime * 2.0);
          vec3 col = mix(uColor, vec3(1.0), base * 0.6);
          float alpha = (fade * 0.7 + base * 0.6) * pulse;
          gl_FragColor = vec4(col, alpha);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <fog_fragment>
        }
      `,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.renderOrder = 2;
    this.mesh.frustumCulled = false;
  }

  /** Keep the curtain readable: taller when the camera is far away. */
  update(time: number, cameraDistance: number) {
    this.material.uniforms.uTime.value = time;
    this.material.uniforms.uHeight.value = THREE.MathUtils.clamp(cameraDistance * 0.022, 1.0, 24);
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
