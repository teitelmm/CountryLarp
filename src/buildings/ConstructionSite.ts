import * as THREE from 'three';
import { CONFIG } from '../core/config';
import { easeInOutCubic, easeOutBack, squashSettle } from '../fx/spring';
import type { Dust } from '../fx/Dust';
import type { HeightField, GradePlan } from '../world/HeightField';
import { GRAVITY, type PhysicsWorld, type PieceBody } from '../physics/PhysicsWorld';
import type { Building } from './Building';
import { Crane } from './Crane';
import { createBuildingGroup, createPieceMesh, mergeBuilding } from './PieceFactory';
import { Scaffold } from './Scaffold';
import type { MaterialSet } from './materials';
import type { PieceSpec } from './types';

/** Seconds for the blueprint to size up (and the ground to be graded) when a building is placed. */
export const SIZING_TIME = 0.9;
/** Seconds of topping-out: squash-and-settle, scaffold strip-down, crane fold-away. */
export const FINISH_TIME = 2.6;
/** Beyond this camera distance a site skips rigid bodies and tweens its pieces (same look, no cost). */
export const PHYSICS_RANGE = 380;
const TWEEN_FLIGHT = 1.1;
const START_DELAY = 0.3;

export interface SiteContext {
  /** World-space container for things that must not inherit the building's transform (progress bar). */
  scene: THREE.Object3D;
  hf: HeightField;
  physics: PhysicsWorld;
  dust: Dust;
  mats: MaterialSet;
  cameraPosition(): THREE.Vector3;
  /** Cap on simultaneously simulated piece bodies (defaults to CONFIG.maxPhysicsBodies). */
  maxBodies?: number;
}

type PiecePhase = 'waiting' | 'flying' | 'welded';

interface PieceRt {
  spec: PieceSpec;
  phase: PiecePhase;
  mode: 'physics' | 'tween';
  mesh: THREE.Mesh | null;
  releaseAt: number;
  age: number;
  targetPos: THREE.Vector3; // world
  targetQuat: THREE.Quaternion; // world
  pb?: PieceBody;
  /** True once the piece stopped colliding to slide into place. */
  ghosted?: boolean;
  // tween mode
  fromPos: THREE.Vector3;
  fromQuat: THREE.Quaternion;
}

export type SitePhase = 'sizing' | 'building' | 'finishing' | 'done';

// Scratch objects (the steering runs for every flying piece every step).
const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _qe = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();

/**
 * Drives one building from placement to completion:
 *
 *  1. Sizing     the blueprint volume pops in with a spring overshoot while the ground is graded flat.
 *  2. Building   a crane swings to each piece and releases it. Pieces are rigid bodies steered towards
 *                their place by a PD controller (collisions stay on, so they bump and settle) and are
 *                welded into the structure exactly in place; scaffolding rises with progress.
 *  3. Finishing  squash-and-settle, the scaffold is stripped and tumbles, the crane folds away, and the
 *                pieces are merged into a few static meshes.
 *
 * Every timeline is in game seconds, driven by fixed steps: `preStep` (timeline + forces), then the
 * physics world steps, then `postStep` (sync + welds).
 */
export class ConstructionSite {
  phase: SitePhase = 'sizing';
  readonly pieces: PieceRt[];
  /** How pieces reached their place: steered into position, tweened (no physics), or forced at the deadline. */
  readonly stats = { arrived: 0, tweened: 0, forced: 0 };

  private t = 0;
  private elapsed = 0;
  /** Total game seconds since the site was created (saved so construction can resume). */
  totalTime = 0;
  private forceTween = false;
  private readonly T: number;
  private readonly deadline: number;
  private readonly interval: number;
  private nextRelease = 0;
  private welded = 0;
  private readonly plan: GradePlan;
  private ground: ReturnType<PhysicsWorld['addGround']> | null = null;
  private readonly piecesGroup = new THREE.Group();
  private readonly crane: Crane | null;
  private readonly scaffold: Scaffold;
  private readonly blueprint = new THREE.Group();
  private readonly volumeMat: THREE.MeshBasicMaterial;
  private readonly edgeMat: THREE.LineBasicMaterial;
  private readonly bar = new THREE.Group();
  private readonly barFill: THREE.Mesh;
  private readonly barMats: THREE.Material[] = [];
  private readonly rootQuatInv = new THREE.Quaternion();
  private aborted = false;

  constructor(readonly building: Building, private readonly ctx: SiteContext) {
    const { def, root } = building;
    const { w, d } = def.footprint;
    this.T = def.buildTime;
    this.deadline = THREE.MathUtils.clamp(this.T * 0.2, 1.2, 2.4);
    root.updateMatrixWorld(true);
    this.rootQuatInv.copy(root.quaternion).invert();

    // --- pieces, in build order: stage, then bottom-up ------------------------------------------
    const order = def.pieces
      .map((spec, i) => ({ spec, i }))
      .sort((a, b) => a.spec.stage - b.spec.stage || a.spec.pos[1] - a.spec.size[1] / 2 - (b.spec.pos[1] - b.spec.size[1] / 2) || a.i - b.i);
    const n = order.length;
    const window = Math.max(0.5, this.T - this.deadline - START_DELAY - 0.3);
    this.interval = n > 1 ? window / (n - 1) : 0;
    this.pieces = order.map(({ spec }, k) => {
      const localQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(...(spec.rot ?? [0, 0, 0])));
      return {
        spec,
        phase: 'waiting' as PiecePhase,
        mode: 'physics' as const,
        mesh: null,
        releaseAt: START_DELAY + k * this.interval,
        age: 0,
        targetPos: new THREE.Vector3(...spec.pos).applyMatrix4(root.matrixWorld),
        targetQuat: root.quaternion.clone().multiply(localQ),
        fromPos: new THREE.Vector3(),
        fromQuat: new THREE.Quaternion(),
      };
    });

    root.add(this.piecesGroup);

    // --- terrain pad (applied progressively during sizing) ---------------------------------------
    this.plan = ctx.hf.planGrade({ cx: building.x, cz: building.z, halfW: w / 2, halfD: d / 2, rot: building.rot, targetY: building.padY, margin: CONFIG.gradeMargin });

    // --- blueprint: volume + edges + footprint outline, scaled up with a spring -------------------
    const teamColor = new THREE.Color(ctx.mats.team.color);
    const lightColor = teamColor.clone().lerp(new THREE.Color(0xffffff), 0.55);
    const volGeo = new THREE.BoxGeometry(w, def.height, d).translate(0, def.height / 2, 0);
    this.volumeMat = new THREE.MeshBasicMaterial({ color: teamColor, transparent: true, opacity: 0.22, depthWrite: false });
    this.edgeMat = new THREE.LineBasicMaterial({ color: lightColor, transparent: true, opacity: 0.9 });
    this.blueprint.add(new THREE.Mesh(volGeo, this.volumeMat));
    this.blueprint.add(new THREE.LineSegments(new THREE.EdgesGeometry(volGeo), this.edgeMat));
    this.blueprint.scale.setScalar(0.001);
    root.add(this.blueprint);

    // --- scaffold and crane -----------------------------------------------------------------------
    this.scaffold = new Scaffold(w, d, def.height, ctx.mats.metal);
    root.add(this.scaffold.mesh);
    if (this.T >= 6) {
      const k = THREE.MathUtils.clamp(Math.max(w, d) / 4.5, 0.55, 1.3);
      const mast = new THREE.Vector3(-(w / 2 + 0.65 + 0.3 * k), 0, -(d / 2 + 0.65 + 0.3 * k));
      let reach = 0;
      for (const p of this.pieces) reach = Math.max(reach, Math.hypot(p.spec.pos[0] - mast.x, p.spec.pos[2] - mast.z));
      this.crane = new Crane(ctx.mats, mast, def.height + 0.9 + 0.3 * k, reach + 0.4, k);
      root.add(this.crane.group);
    } else {
      this.crane = null;
    }

    // --- progress bar (world space, billboarded) ---------------------------------------------------
    const barW = 1.4;
    const back = new THREE.MeshBasicMaterial({ color: 0x0b1220, transparent: true, opacity: 0.8, depthTest: false });
    // Both bar materials are transparent so they share a render pass and `renderOrder` decides the layering
    // (an opaque fill would be drawn in the earlier opaque pass and then painted over by the background).
    const fillMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(ctx.mats.accent.color).lerp(new THREE.Color(0xffd166), 0.5), transparent: true, depthTest: false });
    this.barMats.push(back, fillMat);
    const backMesh = new THREE.Mesh(new THREE.PlaneGeometry(barW + 0.08, 0.2), back);
    this.barFill = new THREE.Mesh(new THREE.PlaneGeometry(barW, 0.12).translate(barW / 2, 0, 0), fillMat);
    this.barFill.position.set(-barW / 2, 0, 0.001);
    this.barFill.scale.x = 0.001;
    backMesh.renderOrder = 20;
    this.barFill.renderOrder = 21;
    this.bar.add(backMesh, this.barFill);
    this.bar.position.set(building.x, building.padY + def.height + 1.3, building.z);
    ctx.scene.add(this.bar);

    // Break ground: a ring of dust, and the slab the foundation will rest on (top at the foundation's bottom).
    this.ground = ctx.physics.addGround(building.x, building.padY - 0.2, building.z, w / 2 + 0.5, d / 2 + 0.5, building.rot);
    ctx.dust.ring(building.x, building.padY + 0.05, building.z, Math.hypot(w, d) * 0.5, Math.min(40, Math.round(12 + w * d)), 0.26);
  }

  get done() {
    return this.phase === 'done';
  }

  get progress() {
    const n = this.pieces.length;
    const flying = this.pieces.filter((p) => p.phase === 'flying').length;
    return Math.min(1, (this.welded + 0.4 * flying) / n);
  }

  // --- timeline ---------------------------------------------------------------------------------

  /** Advance the timeline and apply steering forces (before the physics step). */
  preStep(dt: number) {
    if (this.phase === 'done' || this.aborted) return;
    this.totalTime += dt;
    switch (this.phase) {
      case 'sizing': {
        this.t += dt;
        const k = Math.min(1, this.t / SIZING_TIME);
        this.ctx.hf.applyGrade(this.plan, easeInOutCubic(k));
        this.blueprint.scale.setScalar(Math.max(0.001, easeOutBack(k)));
        if (this.t >= SIZING_TIME) {
          this.phase = 'building';
          this.t = 0;
          this.building.state = 'constructing';
        }
        break;
      }
      case 'building':
        this.elapsed += dt;
        this.buildStep(dt);
        break;
      case 'finishing':
        this.finishStep(dt);
        break;
    }
    this.updateProgress();
  }

  private updateProgress() {
    const phase: SitePhase = this.phase;
    this.building.progress = phase === 'finishing' || phase === 'done' ? 1 : phase === 'sizing' ? 0 : this.progress;
  }

  private buildStep(dt: number) {
    const { crane } = this;
    // Blueprint volume dissolves as the real structure arrives; edges thin out.
    const fade = Math.max(0, 1 - this.elapsed / 2.5);
    this.volumeMat.opacity = 0.22 * fade;
    this.edgeMat.opacity = 0.25 + 0.65 * fade;

    // The crane looks ahead to the next piece; a piece is released once it is in position (or after a grace period).
    const next = this.pieces[this.nextRelease];
    if (crane && next) {
      crane.aim(next.spec.pos[0], next.spec.pos[2], dt);
    } else if (crane) {
      crane.aim(this.crane!.mast.x, this.crane!.mast.z, dt); // idle over its own base
    }
    while (this.nextRelease < this.pieces.length) {
      const p = this.pieces[this.nextRelease];
      if (this.elapsed < p.releaseAt) break;
      const aligned = !crane || crane.angleTo(p.spec.pos[0], p.spec.pos[2]) < 0.35 || this.elapsed > p.releaseAt + 0.9;
      if (!aligned) break;
      this.release(p);
      this.nextRelease++;
      break; // at most one release per step keeps the crane visibly working
    }

    // Steering forces for physics pieces; tweens for the rest.
    for (const p of this.pieces) {
      if (p.phase !== 'flying') continue;
      p.age += dt;
      if (p.mode === 'physics') this.steer(p);
      else this.tween(p);
    }

    this.scaffold.setProgress(Math.min(1, this.progress * 1.05 + 0.04));
  }

  /** Pick the piece up at the crane's hook and let it go. */
  private release(p: PieceRt) {
    const { ctx, building } = this;
    // Spawn at the hook (or high above the target when there is no crane).
    const spawn = new THREE.Vector3();
    if (this.crane) {
      this.crane.hookLocal(spawn);
      building.root.localToWorld(spawn);
    } else {
      spawn.copy(p.targetPos).add(new THREE.Vector3((Math.random() - 0.5) * 0.6, 1.8, (Math.random() - 0.5) * 0.6));
    }
    const tilt = new THREE.Quaternion().setFromEuler(new THREE.Euler((Math.random() - 0.5) * 0.9, (Math.random() - 0.5) * 1.4, (Math.random() - 0.5) * 0.9));
    const spawnQuat = p.targetQuat.clone().multiply(tilt);

    const usePhysics = !this.forceTween && ctx.physics.dynamicCount < (ctx.maxBodies ?? CONFIG.maxPhysicsBodies) && ctx.cameraPosition().distanceTo(building.root.position) < PHYSICS_RANGE;
    p.mode = usePhysics ? 'physics' : 'tween';
    p.phase = 'flying';
    p.age = 0;
    p.mesh = createPieceMesh(p.spec, ctx.mats);
    this.piecesGroup.add(p.mesh);
    if (usePhysics) {
      p.pb = ctx.physics.createPiece(p.spec, spawn, spawnQuat);
    } else {
      p.fromPos.copy(spawn);
      p.fromQuat.copy(spawnQuat);
    }
    this.placeMesh(p, spawn, spawnQuat);
  }

  /** Put a piece's mesh at a world pose (converted into the building's local frame). */
  private placeMesh(p: PieceRt, worldPos: THREE.Vector3, worldQuat: THREE.Quaternion) {
    if (!p.mesh) return;
    p.mesh.position.copy(worldPos);
    this.building.root.worldToLocal(p.mesh.position);
    p.mesh.quaternion.copy(this.rootQuatInv).multiply(worldQuat);
  }

  /**
   * PD steering: the piece is pulled towards a point above its place and then lowered onto it, with most of
   * gravity cancelled so it swings in rather than dropping. Collisions stay on: it bumps against anything in
   * the way and the controller pulls it back.
   */
  private steer(p: PieceRt) {
    const pb = p.pb;
    if (!pb) return;
    const b = pb.body;
    const tr = b.translation();
    const v = b.linvel();
    const dx = p.targetPos.x - tr.x;
    const dz = p.targetPos.z - tr.z;
    const horiz = Math.hypot(dx, dz);
    // Approach from above until nearly over the spot, then come down.
    const hover = horiz > 0.3 ? Math.min(1.6, 0.35 + horiz * 0.6) : 0;
    const dy = p.targetPos.y + hover - tr.y;
    const W = 5.5;
    let ax = W * W * dx - 2 * W * v.x;
    let ay = W * W * dy - 2 * W * v.y;
    let az = W * W * dz - 2 * W * v.z;
    const a = Math.hypot(ax, ay, az);
    const AMAX = 42;
    if (a > AMAX) {
      ax *= AMAX / a;
      ay *= AMAX / a;
      az *= AMAX / a;
    }
    b.resetForces(true);
    // Gravity is cancelled outright so the piece holds its place exactly instead of sagging.
    b.addForce({ x: pb.mass * ax, y: pb.mass * (ay + GRAVITY), z: pb.mass * az }, true);

    // Orientation: torque towards the target rotation.
    const r = b.rotation();
    _q.set(r.x, r.y, r.z, r.w);
    _qe.copy(p.targetQuat).multiply(_q2.copy(_q).invert());
    if (_qe.w < 0) _qe.set(-_qe.x, -_qe.y, -_qe.z, -_qe.w);
    const angle = 2 * Math.acos(Math.min(1, _qe.w));
    const s = Math.sqrt(Math.max(0, 1 - _qe.w * _qe.w));
    if (s > 1e-6) _v.set(_qe.x / s, _qe.y / s, _qe.z / s);
    else _v.set(0, 0, 0);
    const w = b.angvel();
    const WR = 6;
    // Computed torque: the desired angular acceleration times the body's real (world-space) inertia
    // tensor, so every axis is critically damped alike. A single averaged inertia would be far too stiff
    // about a beam's long axis and too soft end-over-end. Packed as [xx, xy, xz, yy, yz, zz].
    const alx = WR * WR * angle * _v.x - 2 * WR * w.x;
    const aly = WR * WR * angle * _v.y - 2 * WR * w.y;
    const alz = WR * WR * angle * _v.z - 2 * WR * w.z;
    const I = b.effectiveAngularInertia().elements;
    b.resetTorques(true);
    b.addTorque(
      {
        x: I[0] * alx + I[1] * aly + I[2] * alz,
        y: I[1] * alx + I[3] * aly + I[4] * alz,
        z: I[2] * alx + I[4] * aly + I[5] * alz,
      },
      true,
    );
  }

  /** Physics-free flight: ease from the hook to the target along a small arc. */
  private tween(p: PieceRt) {
    const k = Math.min(1, p.age / TWEEN_FLIGHT);
    const e = easeInOutCubic(k);
    _v.copy(p.fromPos).lerp(p.targetPos, e);
    _v.y += Math.sin(Math.PI * k) * 0.5;
    _q.copy(p.fromQuat).slerp(p.targetQuat, e);
    this.placeMesh(p, _v, _q);
    if (k >= 1) {
      this.stats.tweened++;
      this.weld(p);
    }
  }

  // --- after the physics step -----------------------------------------------------------------------

  /** Sync meshes from bodies, weld arrived pieces, and detect completion. */
  postStep(dt: number) {
    if (this.aborted || this.phase === 'done') return;
    if (this.phase === 'building') {
      for (const p of this.pieces) {
        if (p.phase !== 'flying' || p.mode !== 'physics' || !p.pb) continue;
        const b = p.pb.body;
        const tr = b.translation();
        const r = b.rotation();
        _v.set(tr.x, tr.y, tr.z);
        _q.set(r.x, r.y, r.z, r.w);
        this.placeMesh(p, _v, _q);
        const err = Math.hypot(tr.x - p.targetPos.x, tr.y - p.targetPos.y, tr.z - p.targetPos.z);
        const ang = _q.angleTo(p.targetQuat);
        const lv = b.linvel();
        const speed = Math.hypot(lv.x, lv.y, lv.z);
        const arrived = err < 0.04 && ang < 0.1 && speed < 0.4 && p.age > 0.25;
        // A piece leaning on a neighbour late in its window stops colliding so the controller can slide it
        // home smoothly instead of it being snapped at the deadline.
        if (!arrived && p.age > this.deadline * 0.6 && !p.ghosted) {
          p.pb.collider.setSensor(true);
          p.ghosted = true;
        }
        if (arrived || p.age > this.deadline) {
          if (arrived) this.stats.arrived++;
          else this.stats.forced++;
          this.weld(p);
        }
      }
      const allWelded = this.welded === this.pieces.length;
      if ((allWelded && this.elapsed >= this.T * 0.98) || this.elapsed > this.T + this.deadline + 8) this.startFinishing();
    } else if (this.phase === 'finishing') {
      this.building.root.updateMatrixWorld();
    }
    void dt;
  }

  /** Lock a piece into the structure at its exact pose. */
  private weld(p: PieceRt) {
    if (p.phase === 'welded') return;
    const { ctx } = this;
    if (p.mode === 'physics' && p.pb) ctx.physics.freeze(p.pb, p.targetPos, p.targetQuat);
    p.phase = 'welded';
    this.welded++;
    if (p.mesh) {
      p.mesh.position.set(...p.spec.pos);
      p.mesh.rotation.set(...(p.spec.rot ?? [0, 0, 0]));
    }
    // Impact dust, scaled by how big the piece is.
    const [sx, sy, sz] = p.spec.size;
    const bulk = Math.cbrt(sx * sy * sz);
    const isFoundation = p.spec.tag === 'foundation';
    ctx.dust.emit(p.targetPos.x, p.targetPos.y - sy / 2 + 0.03, p.targetPos.z, THREE.MathUtils.clamp(Math.round(bulk * 9), 2, isFoundation ? 22 : 9), {
      spread: 0.35 + bulk * 0.5,
      up: 0.35,
      size: 0.08 + bulk * 0.12,
      life: 0.9,
    });
  }

  private startFinishing() {
    this.phase = 'finishing';
    this.t = 0;
    this.building.state = 'finishing';
    this.scaffold.setProgress(1);
    this.scaffold.collapse();
    const { building, ctx } = this;
    ctx.dust.ring(building.x, building.padY + 0.05, building.z, Math.hypot(building.def.footprint.w, building.def.footprint.d) * 0.55, 30, 0.3);
    // The blueprint outline has done its job.
    this.blueprint.visible = false;
  }

  private finishStep(dt: number) {
    this.t += dt;
    const [sxz, sy] = squashSettle(this.t);
    this.piecesGroup.scale.set(sxz, sy, sxz);
    const stripped = this.scaffold.update(dt);
    const craneGone = this.crane ? this.crane.retract(dt) : true;
    if (this.t >= FINISH_TIME && stripped && craneGone) this.finalize();
  }

  /** Swap the assembled pieces for merged static meshes and free everything temporary. */
  private finalize() {
    const { building, ctx } = this;
    for (const p of this.pieces) {
      if (p.pb) ctx.physics.removeBody(p.pb, p.phase === 'flying' && p.mode === 'physics');
      p.pb = undefined;
    }
    this.cleanup();
    const merged = mergeBuilding(createBuildingGroup(building.def, ctx.mats), ctx.mats);
    building.root.add(merged);
    building.state = 'complete';
    building.progress = 1;
    this.phase = 'done';
  }

  /** Remove every temporary object (shared piece geometries are cached, so they are not disposed). */
  private cleanup() {
    const { building, ctx } = this;
    building.root.remove(this.piecesGroup);
    building.root.remove(this.scaffold.mesh);
    this.scaffold.dispose();
    building.root.remove(this.blueprint);
    this.blueprint.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments) o.geometry.dispose();
    });
    this.volumeMat.dispose();
    this.edgeMat.dispose();
    if (this.crane) {
      building.root.remove(this.crane.group);
      this.crane.dispose();
    }
    ctx.scene.remove(this.bar);
    this.bar.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose();
    });
    for (const m of this.barMats) m.dispose();
    if (this.ground) ctx.physics.removeCollider(this.ground);
    this.ground = null;
  }

  /** Cancel construction (e.g. the building is removed mid-build): free bodies and visuals. */
  abort() {
    if (this.aborted || this.phase === 'done') return;
    this.aborted = true;
    for (const p of this.pieces) {
      if (p.pb) this.ctx.physics.removeBody(p.pb, p.phase === 'flying' && p.mode === 'physics');
      p.pb = undefined;
    }
    this.cleanup();
    this.phase = 'done';
  }

  /**
   * Skip ahead `seconds` of construction without rigid bodies (pieces are tweened): used to resume a saved
   * game. Dust from the skipped time is discarded by the caller.
   */
  fastForward(seconds: number, dt = 1 / 60) {
    this.forceTween = true;
    const steps = Math.round(seconds / dt);
    for (let i = 0; i < steps && this.phase !== 'done'; i++) {
      this.preStep(dt);
      this.postStep(dt);
    }
    this.forceTween = false;
  }

  /** Per-frame visuals that depend on the camera: billboard the progress bar at a readable size. */
  updateVisuals(cameraQuat: THREE.Quaternion, cameraDistance: number) {
    if (this.phase === 'done') return;
    this.bar.quaternion.copy(cameraQuat);
    this.bar.scale.setScalar(THREE.MathUtils.clamp(cameraDistance * 0.022, 0.5, 9));
    this.barFill.scale.x = Math.max(0.001, this.building.progress);
    this.bar.visible = this.phase !== 'finishing';
  }
}
