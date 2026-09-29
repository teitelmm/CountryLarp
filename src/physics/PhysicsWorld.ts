import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { hullPoints } from '../buildings/PieceFactory';
import type { PieceSpec } from '../buildings/types';
import { FIXED_DT } from '../core/Clock';

export type Rapier = typeof RAPIER;

let ready: Promise<void> | null = null;

/** Initialise the Rapier WASM module once (idempotent). */
export async function loadRapier(): Promise<Rapier> {
  await (ready ??= RAPIER.init());
  return RAPIER;
}

/** World-units per second squared. Chosen so a piece dropped a couple of units lands in about half a second. */
export const GRAVITY = 12;

export interface PieceBody {
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  /** Approximate mass and mean principal inertia, for the steering controller. */
  mass: number;
  inertia: number;
}

/**
 * The rigid-body world used for construction and demolition. Bodies live in world space. It steps
 * at the fixed simulation rate; construction sites steer their pieces with forces before each step.
 */
export class PhysicsWorld {
  readonly world: RAPIER.World;
  private dynamic = 0;

  constructor(private readonly R: Rapier) {
    this.world = new R.World({ x: 0, y: -GRAVITY, z: 0 });
    this.world.timestep = FIXED_DT;
  }

  /** Number of currently dynamic (simulated) piece bodies. */
  get dynamicCount() {
    return this.dynamic;
  }

  step() {
    this.world.step();
  }

  /** A fixed slab whose *top* is at `topY`: the ground a construction site's foundation rests on. */
  addGround(cx: number, topY: number, cz: number, hx: number, hz: number, rot: number): RAPIER.Collider {
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rot);
    const desc = this.R.ColliderDesc.cuboid(hx, 0.5, hz)
      .setTranslation(cx, topY - 0.5, cz)
      .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
      .setFriction(0.9)
      .setRestitution(0.05);
    return this.world.createCollider(desc);
  }

  removeCollider(c: RAPIER.Collider) {
    this.world.removeCollider(c, false);
  }

  /** Create a dynamic body for a piece at a world pose. */
  createPiece(spec: PieceSpec, pos: THREE.Vector3, quat: THREE.Quaternion): PieceBody {
    const R = this.R;
    const body = this.world.createRigidBody(
      R.RigidBodyDesc.dynamic()
        .setTranslation(pos.x, pos.y, pos.z)
        .setRotation({ x: quat.x, y: quat.y, z: quat.z, w: quat.w })
        .setLinearDamping(0.3)
        .setAngularDamping(2.5)
        .setCanSleep(false)
        .setCcdEnabled(true),
    );
    const [sx, sy, sz] = spec.size;
    let desc: RAPIER.ColliderDesc | null = null;
    switch (spec.shape) {
      case 'box':
        desc = R.ColliderDesc.cuboid(sx / 2, sy / 2, sz / 2);
        break;
      case 'cylinder':
        desc = R.ColliderDesc.cylinder(sy / 2, sx / 2);
        break;
      case 'cone':
        desc = R.ColliderDesc.cone(sy / 2, sx / 2);
        break;
      case 'frustum':
      case 'wedge': {
        const pts = hullPoints(spec);
        desc = pts ? R.ColliderDesc.convexHull(pts) : null;
        break;
      }
    }
    // A degenerate hull falls back to the bounding cuboid rather than failing the build.
    desc ??= R.ColliderDesc.cuboid(sx / 2, sy / 2, sz / 2);
    desc.setDensity(spec.density ?? 1).setFriction(0.9).setRestitution(0.08);
    const collider = this.world.createCollider(desc, body);
    this.dynamic++;
    const mass = body.mass();
    const inertia = (mass * (sx * sx + sy * sy + sz * sz)) / 18;
    return { body, collider, mass, inertia };
  }

  /** Stop simulating a piece and lock it at an exact pose (it becomes part of the structure). */
  freeze(p: PieceBody, pos: THREE.Vector3, quat: THREE.Quaternion) {
    const b = p.body;
    b.resetForces(false);
    b.resetTorques(false);
    b.setLinvel({ x: 0, y: 0, z: 0 }, false);
    b.setAngvel({ x: 0, y: 0, z: 0 }, false);
    b.setBodyType(this.R.RigidBodyType.Fixed, true);
    b.setTranslation({ x: pos.x, y: pos.y, z: pos.z }, true);
    b.setRotation({ x: quat.x, y: quat.y, z: quat.z, w: quat.w }, true);
    this.dynamic = Math.max(0, this.dynamic - 1);
  }

  /** Remove a body. `wasDynamic` keeps the dynamic count right for bodies removed before being frozen. */
  removeBody(p: PieceBody, wasDynamic: boolean) {
    this.world.removeRigidBody(p.body);
    if (wasDynamic) this.dynamic = Math.max(0, this.dynamic - 1);
  }

  dispose() {
    this.world.free();
  }
}
