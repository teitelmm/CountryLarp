import * as THREE from 'three';
import { CONFIG } from '../core/config';
import type { Input } from '../core/Input';
import type { HeightField } from '../world/HeightField';

export interface CameraPose {
  focus?: THREE.Vector3;
  yaw?: number;
  pitch?: number;
  distance?: number;
}

interface PoseState {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  dist: number;
}

const PAN_SPEED = 0.9; // world units per second per unit of camera distance
const YAW_SPEED = 1.6; // rad/s for Q/E
const PITCH_SPEED = 0.9; // rad/s for PageUp/PageDown
const ORBIT_YAW = 0.005; // rad per pixel of right-drag
const ORBIT_PITCH = 0.004;
const ZOOM_RATE = 0.0015; // per wheel pixel (exponential)
const EDGE_PX = 8;

const damp = (cur: number, target: number, k: number, dt: number) => cur + (target - cur) * (1 - Math.exp(-k * dt));

/**
 * Strategy-game camera: a focus point riding the terrain plus yaw, pitch and distance.
 *
 *   yaw = 0 looks north (towards -z) with north up on screen; pitch is the angle above horizontal.
 *
 * Controls (all smoothed towards targets):
 *   WASD / arrows / screen edge   pan (Shift = fast)      MMB drag   grab-pan the ground
 *   Q / E                         rotate                   RMB drag   orbit + tilt
 *   PageUp / PageDown             tilt                     Wheel      zoom towards the cursor
 *   Home                          reset view
 *
 * `focus`, `yaw`, `pitch` and `distance` always hold the current (rendered) values.
 */
export class RTSCamera {
  readonly camera: THREE.PerspectiveCamera;
  readonly focus = new THREE.Vector3();
  yaw = 0;
  pitch = THREE.MathUtils.degToRad(55);
  distance = 300;
  minDistance: number = CONFIG.camera.minDistance;
  maxDistance = 2000;
  edgeScroll = true;

  private readonly target: PoseState = { x: 0, y: 0, z: 0, yaw: 0, pitch: this.pitch, dist: this.distance };
  private hf: HeightField | null = null;
  private home: PoseState | null = null;
  private grab: { anchor: THREE.Vector3 } | null = null;
  private readonly scratch = new THREE.PerspectiveCamera();
  private readonly raycaster = new THREE.Raycaster();

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(CONFIG.camera.fov, aspect, 0.5, 9000);
    this.apply();
  }

  /** Give the camera the terrain to ride and collide with. */
  attach(hf: HeightField) {
    this.hf = hf;
    this.maxDistance = Math.max(hf.halfX, hf.halfZ) * 2 * CONFIG.camera.maxDistanceFactor;
  }

  /** Jump to a pose immediately (no smoothing). Also used as the "home" view via setHome(). */
  setPose(pose: CameraPose) {
    const t = this.target;
    if (pose.focus) {
      t.x = pose.focus.x;
      t.y = pose.focus.y;
      t.z = pose.focus.z;
    }
    if (pose.yaw !== undefined) t.yaw = pose.yaw;
    if (pose.pitch !== undefined) t.pitch = pose.pitch;
    if (pose.distance !== undefined) t.dist = pose.distance;
    this.clampTarget();
    this.snap();
  }

  /** Remember the current target as the view Home restores. */
  setHome() {
    this.home = { ...this.target };
  }

  /** Fly the focus to a world position (smoothly). */
  focusOn(x: number, z: number, distance?: number) {
    this.target.x = x;
    this.target.z = z;
    if (distance !== undefined) this.target.dist = distance;
    this.clampTarget();
  }

  /** Make current values equal the targets (re-reading terrain height). */
  snap() {
    const t = this.target;
    if (this.hf) t.y = this.hf.surface(t.x, t.z);
    this.focus.set(t.x, t.y, t.z);
    this.yaw = t.yaw;
    this.pitch = t.pitch;
    this.distance = t.dist;
    this.apply();
  }

  private clampTarget() {
    const t = this.target;
    t.pitch = THREE.MathUtils.clamp(t.pitch, THREE.MathUtils.degToRad(CONFIG.camera.minPitchDeg), THREE.MathUtils.degToRad(CONFIG.camera.maxPitchDeg));
    t.dist = THREE.MathUtils.clamp(t.dist, this.minDistance, this.maxDistance);
    if (this.hf) {
      t.x = THREE.MathUtils.clamp(t.x, -this.hf.halfX, this.hf.halfX);
      t.z = THREE.MathUtils.clamp(t.z, -this.hf.halfZ, this.hf.halfZ);
    }
  }

  // --- picking -----------------------------------------------------------------------------

  /** World point of the terrain (or sea) under a screen position, using the *current* camera. */
  raycastTerrain(ndc: THREE.Vector2): THREE.Vector3 | null {
    if (!this.hf) return null;
    this.raycaster.setFromCamera(ndc, this.camera);
    return this.hf.raycast(this.raycaster.ray.origin, this.raycaster.ray.direction);
  }

  private raycastTarget(ndc: THREE.Vector2): THREE.Vector3 | null {
    if (!this.hf) return null;
    const t = this.target;
    const cam = this.scratch;
    cam.fov = this.camera.fov;
    cam.aspect = this.camera.aspect;
    cam.near = this.camera.near;
    cam.far = this.camera.far;
    poseToCamera(t.x, t.y, t.z, t.yaw, t.pitch, t.dist, cam);
    this.raycaster.setFromCamera(ndc, cam);
    return this.hf.raycast(this.raycaster.ray.origin, this.raycaster.ray.direction);
  }

  // --- control -----------------------------------------------------------------------------

  /**
   * Zoom the *target* by `wheelPixels` (positive = out), keeping the ground point under `ndc` fixed.
   * The camera is scaled about that point, which preserves the view ray through the cursor.
   */
  zoomAt(ndc: THREE.Vector2, wheelPixels: number) {
    const t = this.target;
    const oldDist = t.dist;
    const newDist = THREE.MathUtils.clamp(oldDist * Math.exp(wheelPixels * ZOOM_RATE), this.minDistance, this.maxDistance);
    if (newDist === oldDist) return;
    const p = this.raycastTarget(ndc);
    if (p) {
      const r = newDist / oldDist;
      t.x = p.x + (t.x - p.x) * r;
      t.z = p.z + (t.z - p.z) * r;
    }
    t.dist = newDist;
    this.clampTarget();
    if (this.hf) t.y = this.hf.surface(t.x, t.z);
  }

  /** Per-frame update: read input, move targets, smooth, and position the camera. */
  update(dt: number, input: Input) {
    dt = Math.min(dt, 0.1);
    const t = this.target;

    const wheel = input.consumeWheel();
    if (wheel !== 0) this.zoomAt(input.pointer.known ? input.pointer.ndc : new THREE.Vector2(0, 0), wheel);

    // Keyboard / edge panning in the camera's yaw frame.
    let right = 0;
    let fwd = 0;
    if (input.isDown('KeyD', 'ArrowRight')) right += 1;
    if (input.isDown('KeyA', 'ArrowLeft')) right -= 1;
    if (input.isDown('KeyW', 'ArrowUp')) fwd += 1;
    if (input.isDown('KeyS', 'ArrowDown')) fwd -= 1;
    const idle = !input.drag && !input.buttons[0] && !input.buttons[1] && !input.buttons[2];
    if (this.edgeScroll && idle && input.pointer.overCanvas && input.pointer.known) {
      if (input.pointer.x <= EDGE_PX) right -= 1;
      else if (input.pointer.x >= innerWidth - EDGE_PX) right += 1;
      if (input.pointer.y <= EDGE_PX) fwd += 1;
      else if (input.pointer.y >= innerHeight - EDGE_PX) fwd -= 1;
    }
    if (right !== 0 || fwd !== 0) {
      const len = Math.hypot(right, fwd);
      const speed = t.dist * PAN_SPEED * (input.shift ? 2.5 : 1) * dt;
      const sy = Math.sin(this.yaw);
      const cy = Math.cos(this.yaw);
      // forward = (-sin yaw, -cos yaw), right = (cos yaw, -sin yaw)
      t.x += ((cy * right - sy * fwd) / len) * speed;
      t.z += ((-sy * right - cy * fwd) / len) * speed;
    }

    // Rotate / tilt.
    if (input.isDown('KeyQ')) t.yaw += YAW_SPEED * dt;
    if (input.isDown('KeyE')) t.yaw -= YAW_SPEED * dt;
    if (input.isDown('PageUp')) t.pitch += PITCH_SPEED * dt;
    if (input.isDown('PageDown')) t.pitch -= PITCH_SPEED * dt;

    const drag = input.consumeDrag();
    if (input.drag?.button === 2) {
      t.yaw -= drag.dx * ORBIT_YAW;
      t.pitch += drag.dy * ORBIT_PITCH;
    }

    // Middle-drag: grab the ground under the cursor and keep it there.
    if (input.buttons[1] && input.drag?.button === 1) {
      if (!this.grab) {
        // Anchor where the button went down, so the ground sticks to the cursor from the first pixel.
        const anchor = this.raycastTerrain(input.drag.startNdc);
        if (anchor) this.grab = { anchor };
      }
      if (this.grab) this.applyGrab(input.pointer.ndc);
    } else {
      this.grab = null;
    }

    if (input.isDown('Home') && this.home) Object.assign(t, this.home);

    this.clampTarget();
    if (this.hf) t.y = this.hf.surface(t.x, t.z);

    // Smooth towards the targets.
    this.focus.x = damp(this.focus.x, t.x, 14, dt);
    this.focus.z = damp(this.focus.z, t.z, 14, dt);
    this.focus.y = damp(this.focus.y, t.y, 8, dt);
    this.yaw = damp(this.yaw, t.yaw, 11, dt);
    this.pitch = damp(this.pitch, t.pitch, 11, dt);
    this.distance = damp(this.distance, t.dist, 10, dt);
    this.apply();
  }

  /** Shift focus (current and target) so the anchor stays under the cursor. */
  private applyGrab(ndc: THREE.Vector2) {
    const anchor = this.grab!.anchor;
    this.raycaster.setFromCamera(ndc, this.camera);
    const { origin, direction } = this.raycaster.ray;
    if (Math.abs(direction.y) < 1e-4) return;
    const s = (anchor.y - origin.y) / direction.y;
    if (s <= 0) return;
    const dx = anchor.x - (origin.x + direction.x * s);
    const dz = anchor.z - (origin.z + direction.z * s);
    this.target.x += dx;
    this.target.z += dz;
    this.focus.x += dx;
    this.focus.z += dz;
  }

  /** Position the camera from the current pose; never let it sink below the terrain. */
  apply() {
    this.pitch = THREE.MathUtils.clamp(this.pitch, THREE.MathUtils.degToRad(CONFIG.camera.minPitchDeg), THREE.MathUtils.degToRad(CONFIG.camera.maxPitchDeg));
    this.distance = THREE.MathUtils.clamp(this.distance, this.minDistance, this.maxDistance);
    poseToCamera(this.focus.x, this.focus.y, this.focus.z, this.yaw, this.pitch, this.distance, this.camera);
    if (this.hf) {
      const p = this.camera.position;
      const floor = this.hf.surface(p.x, p.z) + 0.6 + this.distance * 0.02;
      if (p.y < floor) {
        p.y = floor;
        this.camera.lookAt(this.focus);
        this.camera.updateMatrixWorld();
      }
    }
    // Keep depth precision reasonable across the zoom range.
    this.camera.near = Math.max(0.3, this.distance * 0.02);
    this.camera.updateProjectionMatrix();
  }

  resize(aspect: number) {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }
}

/** Place `cam` looking at (fx, fy, fz) from the given yaw/pitch/distance. */
export function poseToCamera(fx: number, fy: number, fz: number, yaw: number, pitch: number, dist: number, cam: THREE.PerspectiveCamera) {
  const cp = Math.cos(pitch);
  cam.position.set(fx + Math.sin(yaw) * cp * dist, fy + Math.sin(pitch) * dist, fz + Math.cos(yaw) * cp * dist);
  cam.up.set(0, 1, 0);
  cam.lookAt(fx, fy, fz);
  cam.updateMatrixWorld(true);
  cam.updateProjectionMatrix();
}
