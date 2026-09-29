import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { getDef } from '../src/buildings/catalog';
import type { PieceSpec } from '../src/buildings/types';
import { loadRapier, PhysicsWorld } from '../src/physics/PhysicsWorld';

let physics: PhysicsWorld;
beforeAll(async () => {
  physics = new PhysicsWorld(await loadRapier());
});

const box = (size: [number, number, number]): PieceSpec => ({ shape: 'box', size, pos: [0, 0, 0], material: 'concrete', stage: 0 });
const id = new THREE.Quaternion();

function settle(steps: number) {
  for (let i = 0; i < steps; i++) physics.step();
}

describe('PhysicsWorld', () => {
  it('a dropped box lands on the ground slab and rests on its top', () => {
    const ground = physics.addGround(0, 0, 0, 5, 5, 0);
    const p = physics.createPiece(box([1, 0.5, 1]), new THREE.Vector3(0, 3, 0), id);
    expect(physics.dynamicCount).toBe(1);
    settle(180);
    expect(p.body.translation().y).toBeCloseTo(0.25, 2); // half height above the ground top
    expect(Math.abs(p.body.linvel().y)).toBeLessThan(0.05);
    physics.removeBody(p, true);
    physics.removeCollider(ground);
    expect(physics.dynamicCount).toBe(0);
  });

  it('respects a rotated ground slab (top at the requested height)', () => {
    const ground = physics.addGround(10, 2, -4, 3, 3, 0.7);
    const p = physics.createPiece(box([0.4, 0.4, 0.4]), new THREE.Vector3(10, 4, -4), id);
    settle(150);
    expect(p.body.translation().y).toBeCloseTo(2.2, 2);
    physics.removeBody(p, true);
    physics.removeCollider(ground);
  });

  it('freeze pins a piece at an exact pose, stops it simulating and updates the count', () => {
    const p = physics.createPiece(box([1, 1, 1]), new THREE.Vector3(0, 5, 0), id);
    settle(10);
    const target = new THREE.Vector3(2.5, 1.25, -3.75);
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.1, 0.9, -0.2));
    physics.freeze(p, target, q);
    expect(physics.dynamicCount).toBe(0);
    settle(60);
    const t = p.body.translation();
    expect([t.x, t.y, t.z]).toEqual([2.5, 1.25, -3.75]);
    const r = p.body.rotation();
    expect(Math.abs(r.x - q.x) + Math.abs(r.y - q.y) + Math.abs(r.z - q.z) + Math.abs(r.w - q.w)).toBeLessThan(1e-6);
    expect(p.body.isFixed()).toBe(true);
    physics.removeBody(p, false);
    expect(physics.dynamicCount).toBe(0);
  });

  it('a frozen piece supports another one (welded structure is solid)', () => {
    const ground = physics.addGround(0, 0, 0, 5, 5, 0);
    const base = physics.createPiece(box([2, 0.3, 2]), new THREE.Vector3(0, 0.15, 0), id);
    physics.freeze(base, new THREE.Vector3(0, 0.15, 0), id);
    const top = physics.createPiece(box([1, 1, 1]), new THREE.Vector3(0.2, 3, 0.1), id);
    settle(200);
    expect(top.body.translation().y).toBeCloseTo(0.3 + 0.5, 2);
    physics.removeBody(top, true);
    physics.removeBody(base, false);
    physics.removeCollider(ground);
  });

  it('builds a working collider for every piece shape in the catalog (no NaN, sane mass)', () => {
    const seen = new Set<string>();
    for (const def of [getDef('hospital'), getDef('power_plant'), getDef('naval_base'), getDef('farm_complex')]) {
      for (const spec of def.pieces) {
        const p = physics.createPiece(spec, new THREE.Vector3(0, 50, 0), id);
        seen.add(spec.shape);
        expect(Number.isFinite(p.mass) && p.mass > 0, `${def.id} ${spec.shape}`).toBe(true);
        expect(Number.isFinite(p.inertia) && p.inertia > 0).toBe(true);
        physics.removeBody(p, true);
      }
    }
    // box, cylinder, cone, frustum (cooling towers) and wedge (roofs) must all have been exercised.
    for (const s of ['box', 'cylinder', 'cone', 'frustum', 'wedge']) expect(seen.has(s), `shape ${s}`).toBe(true);
    expect(physics.dynamicCount).toBe(0);
  });

  it('applied forces move a body and can be reset (the steering controller relies on this)', () => {
    const p = physics.createPiece(box([0.5, 0.5, 0.5]), new THREE.Vector3(0, 100, 0), id);
    p.body.setGravityScale(0, true);
    for (let i = 0; i < 60; i++) {
      p.body.resetForces(true);
      p.body.addForce({ x: 10 * p.mass, y: 0, z: 0 }, true); // a = 10 units/s^2
      physics.step();
    }
    const vx = p.body.linvel().x;
    expect(vx).toBeGreaterThan(5); // ~10 * 1s minus a little damping
    for (let i = 0; i < 30; i++) {
      p.body.resetForces(true);
      physics.step();
    }
    expect(p.body.linvel().x).toBeLessThan(vx); // forces were reset: only damping acts now
    physics.removeBody(p, true);
  });
});
