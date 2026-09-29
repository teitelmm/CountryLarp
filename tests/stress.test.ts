import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { BuildingManager } from '../src/buildings/BuildingManager';
import { getDef, CATALOG } from '../src/buildings/catalog';
import { CONFIG } from '../src/core/config';
import { FIXED_DT } from '../src/core/Clock';
import { Dust } from '../src/fx/Dust';
import { loadRapier, PhysicsWorld, type Rapier } from '../src/physics/PhysicsWorld';
import { makeMap } from './helpers';

let rapier: Rapier;
beforeAll(async () => {
  rapier = await loadRapier();
});

describe('many buildings at once', () => {
  it('40 simultaneous constructions stay inside the physics budget and all finish', () => {
    const physics = new PhysicsWorld(rapier);
    const hf = makeMap(161, 161); // 160 x 160 km of the synthetic ramp
    const scene = new THREE.Group();
    const dust = new Dust(900);
    scene.add(dust.points);
    const mgr = new BuildingManager({ scene, hf }, { primary: '#dc143c', secondary: '#f2f2f2' }, {
      physics, dust, cameraPosition: () => new THREE.Vector3(0, 40, 40),
    });

    // A grid of mixed buildings (coastal ones skipped: the ramp has no usable coast here).
    const defs = CATALOG.filter((d) => !d.placement.needsCoast && d.footprint.w <= 6);
    const placed = [];
    for (let i = 0; i < 40; i++) {
      const def = defs[i % defs.length];
      const x = -30 + (i % 8) * 12;
      const z = -25 + Math.floor(i / 8) * 12;
      placed.push(mgr.place(def, x, z, (i % 4) * (Math.PI / 2), hf.meanHeight(x, z, def.footprint.w / 2, def.footprint.d / 2, 0)));
    }
    expect(mgr.activeSites).toBe(40);

    let maxDynamic = 0;
    let steps = 0;
    const started = performance.now();
    while (mgr.activeSites > 0 && steps < 60 * 90) {
      mgr.preStep(FIXED_DT);
      physics.step();
      mgr.postStep(FIXED_DT);
      dust.update(FIXED_DT);
      maxDynamic = Math.max(maxDynamic, physics.dynamicCount);
      steps++;
    }
    const wall = performance.now() - started;

    for (const b of placed) expect(b.state, `${b.def.id} finished`).toBe('complete');
    expect(maxDynamic).toBeLessThanOrEqual(CONFIG.maxPhysicsBodies);
    expect(maxDynamic).toBeGreaterThan(20); // it really did simulate many bodies at once
    expect(physics.dynamicCount).toBe(0);
    // A pathological slowdown would show up here: 40 buildings x up to ~50 s of game time.
    const perStepMs = wall / steps;
    expect(perStepMs, `avg ${perStepMs.toFixed(2)} ms per simulation step`).toBeLessThan(8);

    // ...and they can all be brought down again cleanly.
    for (const b of placed) mgr.demolish(b.id);
    expect(mgr.activeDemolitions).toBe(40);
    let clear = 0;
    while (mgr.activeDemolitions > 0 && clear < 60 * 20) {
      mgr.preStep(FIXED_DT);
      physics.step();
      mgr.postStep(FIXED_DT);
      maxDynamic = Math.max(maxDynamic, physics.dynamicCount);
      clear++;
    }
    expect(mgr.activeDemolitions).toBe(0);
    expect(physics.dynamicCount).toBe(0);
    expect(mgr.all).toHaveLength(0);
    expect(getDef('hospital')).toBeTruthy();
  }, 120000);
});
