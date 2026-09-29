import * as THREE from 'three';
import { CONFIG } from '../core/config';
import type { PieceBody } from '../physics/PhysicsWorld';
import type { Building } from './Building';
import { PHYSICS_RANGE, type SiteContext } from './ConstructionSite';
import { createPieceMesh } from './PieceFactory';
import type { PieceSpec } from './types';

/** Seconds the rubble lies around before it fades. */
export const RUBBLE_TIME = 2.6;
/** Seconds over which the rubble shrinks away. */
export const FADE_TIME = 1.1;

interface Debris {
  spec: PieceSpec;
  mesh: THREE.Mesh;
  pb?: PieceBody;
  /** Final scale when fading (used for the no-physics path). */
  scale: number;
}

/**
 * Demolition: the finished building is replaced by its individual pieces, which are thrown outward as
 * rigid bodies (heavy ones barely move), tumble across the pad in a cloud of dust, and shrink away.
 * Far from the camera, or over the body budget, it skips the bodies and just shrinks away.
 */
export class Demolition {
  done = false;
  readonly usesPhysics: boolean;
  private t = 0;
  private readonly debris: Debris[] = [];
  private readonly group = new THREE.Group();
  private ground: ReturnType<SiteContext['physics']['addGround']> | null = null;

  constructor(private readonly building: Building, private readonly ctx: SiteContext) {
    const { def, root, x, z, rot, padY } = building;
    root.updateMatrixWorld(true);
    const n = def.pieces.length;
    this.usesPhysics =
      ctx.physics.dynamicCount + n <= (ctx.maxBodies ?? CONFIG.maxPhysicsBodies) && ctx.cameraPosition().distanceTo(root.position) < PHYSICS_RANGE;
    ctx.scene.add(this.group);

    const centre = new THREE.Vector3(x, padY + def.height * 0.35, z);
    if (this.usesPhysics) {
      this.ground = ctx.physics.addGround(x, padY - 0.2, z, def.footprint.w / 2 + 6, def.footprint.d / 2 + 6, rot);
    }
    for (const spec of def.pieces) {
      const mesh = createPieceMesh(spec, ctx.mats);
      const pos = new THREE.Vector3(...spec.pos).applyMatrix4(root.matrixWorld);
      const quat = root.quaternion.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(...(spec.rot ?? [0, 0, 0]))));
      mesh.position.copy(pos);
      mesh.quaternion.copy(quat);
      this.group.add(mesh);
      const d: Debris = { spec, mesh, scale: 1 };
      if (this.usesPhysics) {
        const pb = ctx.physics.createPiece(spec, pos, quat);
        d.pb = pb;
        const foundation = spec.tag === 'foundation';
        // Blast outward and up from the middle of the building; the foundation slab only shudders.
        const dir = pos.clone().sub(centre);
        dir.y = Math.max(dir.y, 0.2) + 0.8;
        dir.normalize();
        const k = (foundation ? 0.15 : 1) * (2.2 + Math.random() * 3.2);
        pb.body.applyImpulse({ x: dir.x * k * pb.mass, y: dir.y * k * pb.mass * 1.3, z: dir.z * k * pb.mass }, true);
        pb.body.applyTorqueImpulse(
          { x: (Math.random() - 0.5) * 2 * pb.inertia * 3, y: (Math.random() - 0.5) * 2 * pb.inertia * 3, z: (Math.random() - 0.5) * 2 * pb.inertia * 3 },
          true,
        );
      }
      this.debris.push(d);
    }

    // The merged model has been replaced by the loose pieces.
    for (const child of [...root.children]) {
      root.remove(child);
      child.traverse((o) => o instanceof THREE.Mesh && o.geometry.dispose());
    }
    // A cloud of dust from the collapse.
    const r = Math.hypot(def.footprint.w, def.footprint.d) * 0.5;
    ctx.dust.ring(x, padY + 0.1, z, r * 0.6, Math.min(50, Math.round(16 + def.footprint.w * def.footprint.d)), 0.42);
    for (let i = 0; i < 24; i++) {
      const a = Math.random() * Math.PI * 2;
      const rr = Math.random() * r * 0.7;
      ctx.dust.emit(x + Math.cos(a) * rr, padY + 0.2 + Math.random() * def.height * 0.6, z + Math.sin(a) * rr, 1, { spread: 0.7, up: 0.9, size: 0.34, life: 2.0 });
    }
  }

  /** Nothing to steer: rubble simply falls. */
  preStep(_dt: number) {}

  /** Sync meshes from bodies; fade and finish. */
  postStep(dt: number) {
    if (this.done) return;
    this.t += dt;
    const fade = THREE.MathUtils.clamp((this.t - RUBBLE_TIME) / FADE_TIME, 0, 1);
    const s = Math.max(0.001, 1 - fade);
    for (const d of this.debris) {
      if (d.pb) {
        const tr = d.pb.body.translation();
        const r = d.pb.body.rotation();
        d.mesh.position.set(tr.x, tr.y, tr.z);
        d.mesh.quaternion.set(r.x, r.y, r.z, r.w);
      }
      // Without bodies the pieces just shrink in place, a little faster.
      d.mesh.scale.setScalar(this.usesPhysics ? s : Math.max(0.001, 1 - this.t / 0.6));
    }
    const total = this.usesPhysics ? RUBBLE_TIME + FADE_TIME : 0.6;
    if (this.t >= total) this.finish();
  }

  private finish() {
    const { ctx } = this;
    for (const d of this.debris) {
      if (d.pb) ctx.physics.removeBody(d.pb, true);
      d.pb = undefined;
    }
    if (this.ground) ctx.physics.removeCollider(this.ground);
    this.ground = null;
    ctx.scene.remove(this.group); // piece geometries are shared/cached, so they are not disposed here
    this.done = true;
  }

  /** Stop immediately (game shutting down). */
  abort() {
    if (!this.done) this.finish();
  }
}
