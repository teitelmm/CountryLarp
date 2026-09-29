import * as THREE from 'three';
import { CONFIG } from '../core/config';

export interface CameraPose {
  focus?: THREE.Vector3;
  yaw?: number;
  pitch?: number;
  distance?: number;
}

/**
 * Strategy-game camera: a focus point on the terrain plus yaw, pitch and distance.
 * yaw = 0 looks north (towards -z) with north up on screen. Pitch is degrees-from-horizontal in
 * radians. Input handling and smoothing are layered on top of this pose API.
 */
export class RTSCamera {
  readonly camera: THREE.PerspectiveCamera;
  readonly focus = new THREE.Vector3();
  yaw = 0;
  pitch = THREE.MathUtils.degToRad(55);
  distance = 300;
  minDistance: number = CONFIG.camera.minDistance;
  maxDistance = 2000;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(CONFIG.camera.fov, aspect, 0.5, 9000);
    this.apply();
  }

  setPose(pose: CameraPose) {
    if (pose.focus) this.focus.copy(pose.focus);
    if (pose.yaw !== undefined) this.yaw = pose.yaw;
    if (pose.pitch !== undefined) this.pitch = pose.pitch;
    if (pose.distance !== undefined) this.distance = pose.distance;
    this.apply();
  }

  /** Position the camera from the pose. Near/far scale with distance to keep depth precision. */
  apply() {
    this.pitch = THREE.MathUtils.clamp(
      this.pitch,
      THREE.MathUtils.degToRad(CONFIG.camera.minPitchDeg),
      THREE.MathUtils.degToRad(CONFIG.camera.maxPitchDeg),
    );
    this.distance = THREE.MathUtils.clamp(this.distance, this.minDistance, this.maxDistance);
    const cp = Math.cos(this.pitch);
    this.camera.position.set(
      this.focus.x + Math.sin(this.yaw) * cp * this.distance,
      this.focus.y + Math.sin(this.pitch) * this.distance,
      this.focus.z + Math.cos(this.yaw) * cp * this.distance,
    );
    this.camera.lookAt(this.focus);
    this.camera.near = Math.max(0.3, this.distance * 0.02);
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
  }

  resize(aspect: number) {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }
}
