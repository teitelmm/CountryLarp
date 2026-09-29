import * as THREE from 'three';
import type { MaterialSet } from './materials';

const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * A procedural tower crane beside the site. Its jib swings to face the piece about to be delivered and
 * the hook rides out along the jib; pieces are released from the hook. Built in the building's local frame.
 */
export class Crane {
  readonly group = new THREE.Group();
  /** Mast position in building-local space. */
  readonly mast: THREE.Vector3;
  private readonly jib = new THREE.Group();
  private readonly hook = new THREE.Group();
  private readonly cable: THREE.Mesh;
  private yaw = 0;
  private reach = 1;
  private retracting = 0;
  readonly mastHeight: number;
  readonly jibLength: number;
  private readonly cableLen: number;

  constructor(mats: MaterialSet, mast: THREE.Vector3, mastHeight: number, jibLength: number, k: number) {
    this.mast = mast.clone();
    this.mastHeight = mastHeight;
    this.jibLength = jibLength;
    this.cableLen = Math.max(0.5, mastHeight * 0.32);
    this.group.position.copy(this.mast);

    const t = 0.15 * k;
    const add = (parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      parent.add(m);
      return m;
    };
    const box = (sx: number, sy: number, sz: number) => new THREE.BoxGeometry(sx, sy, sz);
    // Ballast base and lattice mast (a slim box with cross-braces).
    add(this.group, box(0.55 * k, 0.16 * k, 0.55 * k), mats.concreteDark, 0, 0.08 * k, 0);
    add(this.group, box(t, mastHeight, t), mats.cYellow, 0, mastHeight / 2, 0);
    for (let y = 0.4 * k; y < mastHeight - 0.2; y += 0.55 * k) add(this.group, box(t * 2.2, 0.03 * k, 0.03 * k), mats.cYellow, 0, y, 0);
    // Slewing unit and cab.
    add(this.group, box(0.26 * k, 0.2 * k, 0.26 * k), mats.metalDark, 0, mastHeight + 0.05 * k, 0);
    add(this.group, box(0.16 * k, 0.16 * k, 0.16 * k), mats.glass, 0.02 * k, mastHeight + 0.24 * k, 0.16 * k);

    // Jib (rotates about the mast top): main arm along +x, counter-jib behind with a counterweight.
    this.jib.position.set(0, mastHeight + 0.1 * k, 0);
    add(this.jib, box(jibLength, 0.08 * k, 0.11 * k), mats.cYellow, jibLength / 2, 0, 0);
    add(this.jib, box(jibLength * 0.3, 0.08 * k, 0.11 * k), mats.cYellow, -jibLength * 0.15, 0, 0);
    add(this.jib, box(0.28 * k, 0.24 * k, 0.24 * k), mats.metal, -jibLength * 0.28, -0.08 * k, 0);
    // Hook block hangs on a cable from a trolley that runs out along the jib.
    this.hook.position.set(jibLength * 0.5, 0, 0);
    add(this.hook, box(0.12 * k, 0.05 * k, 0.16 * k), mats.metalDark, 0, 0, 0); // trolley
    this.cable = add(this.hook, new THREE.CylinderGeometry(0.012 * k, 0.012 * k, 1, 6), mats.metalDark, 0, -this.cableLen / 2, 0);
    this.cable.scale.y = this.cableLen;
    this.cable.castShadow = false;
    add(this.hook, box(0.11 * k, 0.09 * k, 0.11 * k), mats.orange, 0, -this.cableLen - 0.04 * k, 0);
    this.jib.add(this.hook);
    this.group.add(this.jib);
    this.reach = jibLength * 0.5;
  }

  /** Building-local position of the hook (where a piece is picked up / dropped). */
  hookLocal(out = new THREE.Vector3()): THREE.Vector3 {
    const r = this.reach;
    return out.set(this.mast.x + Math.cos(this.yaw) * r, this.mast.y + this.mastHeight + 0.1 - this.cableLen - 0.1, this.mast.z - Math.sin(this.yaw) * r);
  }

  /** Swing the jib towards a building-local point and run the trolley out (or in) to reach it. */
  aim(localX: number, localZ: number, dt: number) {
    const dx = localX - this.mast.x;
    const dz = localZ - this.mast.z;
    // Jib group rotation.y = theta points its +x arm along (cos theta, -sin theta) in the parent.
    const target = Math.atan2(-dz, dx);
    this.yaw += wrapAngle(target - this.yaw) * (1 - Math.exp(-3.2 * dt));
    const wantReach = THREE.MathUtils.clamp(Math.hypot(dx, dz), 0.35, this.jibLength * 0.96);
    this.reach += (wantReach - this.reach) * (1 - Math.exp(-3.5 * dt));
    this.jib.rotation.y = this.yaw;
    this.hook.position.x = this.reach;
  }

  /** How far the jib still has to swing to face a point (radians): lets the site wait for the crane. */
  angleTo(localX: number, localZ: number): number {
    return Math.abs(wrapAngle(Math.atan2(-(localZ - this.mast.z), localX - this.mast.x) - this.yaw));
  }

  /** Fold away after the build: the whole crane sinks and shrinks. Returns true once gone. */
  retract(dt: number): boolean {
    this.retracting = Math.min(1, this.retracting + dt / 1.1);
    const k = 1 - this.retracting;
    this.group.scale.set(1, Math.max(0.001, k), 1);
    this.jib.rotation.y += dt * 1.6;
    return this.retracting >= 1;
  }

  dispose() {
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose();
    });
  }
}
