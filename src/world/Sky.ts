import * as THREE from 'three';

/** Sky colour at the horizon. Also used for fog and the renderer clear colour so terrain fades into it. */
export const HORIZON_COLOR = new THREE.Color(0xc4d6e6);
export const ZENITH_COLOR = new THREE.Color(0x4a82c4);
/** Direction *towards* the sun: south-west, fairly low so relief and buildings cast readable shadows. */
export const SUN_DIRECTION = new THREE.Vector3(-0.55, 0.62, 0.56).normalize();

/** A camera-following gradient dome with a soft sun glow. */
export class Sky {
  readonly mesh: THREE.Mesh;

  constructor() {
    const material = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        uHorizon: { value: HORIZON_COLOR.clone() },
        uZenith: { value: ZENITH_COLOR.clone() },
        uSun: { value: SUN_DIRECTION.clone() },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = position;
          vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_Position = p.xyww; // always at the far plane
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uHorizon;
        uniform vec3 uZenith;
        uniform vec3 uSun;
        varying vec3 vDir;
        #include <common>
        void main() {
          vec3 d = normalize(vDir);
          float up = max(d.y, 0.0);
          vec3 col = mix(uHorizon, uZenith, pow(up, 0.55));
          float sun = max(dot(d, normalize(uSun)), 0.0);
          col += vec3(1.0, 0.92, 0.75) * (pow(sun, 700.0) * 2.0 + pow(sun, 12.0) * 0.12);
          gl_FragColor = vec4(col, 1.0);
          #include <colorspace_fragment>
        }
      `,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), material);
    this.mesh.scale.setScalar(4000);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1;
  }

  update(camera: THREE.Camera) {
    this.mesh.position.copy(camera.position);
  }

  dispose() {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
