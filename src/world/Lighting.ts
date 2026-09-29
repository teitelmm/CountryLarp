import * as THREE from 'three';
import { SUN_DIRECTION } from './Sky';

/**
 * Hemisphere ambient plus one directional sun. The sun's shadow frustum is centred on the camera
 * focus and scales with camera distance, so shadow-map resolution is spent where you are looking.
 */
export class Lighting {
  readonly group = new THREE.Group();
  readonly sun: THREE.DirectionalLight;
  private readonly hemi: THREE.HemisphereLight;

  constructor() {
    this.hemi = new THREE.HemisphereLight(0xcfe3ff, 0x6a6553, 1.15);
    this.sun = new THREE.DirectionalLight(0xfff0d8, 2.6);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.02;
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 900;
    this.group.add(this.hemi, this.sun, this.sun.target);
    this.follow(new THREE.Vector3(), 100);
  }

  /** Centre the shadow frustum on `focus`; `cameraDistance` sets how much area it covers. */
  follow(focus: THREE.Vector3, cameraDistance: number) {
    const extent = THREE.MathUtils.clamp(cameraDistance * 0.85, 14, 260);
    const cam = this.sun.shadow.camera;
    if (cam.right !== extent) {
      cam.left = -extent;
      cam.right = extent;
      cam.top = extent;
      cam.bottom = -extent;
      cam.updateProjectionMatrix();
    }
    // Snap to shadow-map texels so shadows do not shimmer while panning.
    const texel = (2 * extent) / this.sun.shadow.mapSize.x;
    const fx = Math.round(focus.x / texel) * texel;
    const fz = Math.round(focus.z / texel) * texel;
    this.sun.target.position.set(fx, focus.y, fz);
    this.sun.position.set(fx, focus.y, fz).addScaledVector(SUN_DIRECTION, 400);
    this.sun.target.updateMatrixWorld();
  }
}
