import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { BuildingManager } from '../src/buildings/BuildingManager';
import { getDef } from '../src/buildings/catalog';
import { MIN_GAP, validatePlacement, type PlacementEnv } from '../src/buildings/Validation';
import { obbSamples } from '../src/core/obb';
import { Dust } from '../src/fx/Dust';
import { loadRapier, PhysicsWorld, type Rapier } from '../src/physics/PhysicsWorld';
import { Territory } from '../src/world/Territory';
import { makeMap } from './helpers';

let rapier: Rapier;
beforeAll(async () => {
  rapier = await loadRapier();
});

/** A world on the synthetic ramp (rises 0.1 per unit towards +x), with a border covering the whole land. */
function world() {
  const hf = makeMap(161, 161);
  const scene = new THREE.Group();
  const dust = new Dust(100);
  const mgr = new BuildingManager({ scene, hf }, { primary: '#dc143c', secondary: '#f2f2f2' }, {
    physics: new PhysicsWorld(rapier), dust, cameraPosition: () => new THREE.Vector3(0, 30, 30),
  });
  const territory = new Territory([[[[-60, -70], [70, -70], [70, 70], [-60, 70]]]]);
  const env: PlacementEnv = mgr.env(territory);
  return { hf, mgr, env };
}

/** How far the terrain under a building's footprint is from the height it was built at (worst sample). */
function worstMismatch(hf: ReturnType<typeof makeMap>, b: { padY: number; obb: Parameters<typeof obbSamples>[0] }) {
  return Math.max(...obbSamples(b.obb, 9).map(([x, z]) => Math.abs(hf.sample(x, z) - b.padY)));
}

describe('neighbouring buildings and the ground under them', () => {
  it('two hospitals side by side on a slope both sit on ground at their own level', () => {
    const { hf, mgr, env } = world();
    const def = getDef('hospital');
    const a = validatePlacement(env, def, 0, 0, 0);
    expect(a.ok, JSON.stringify(a.reasons)).toBe(true);
    const bA = mgr.place(def, 0, 0, 0, a.padY, { instant: true });
    // Right beside it (just outside the minimum gap), further up the ramp.
    const x2 = def.footprint.w + MIN_GAP + 0.2;
    const b = validatePlacement(env, def, x2, 0, 0);
    expect(b.ok, JSON.stringify(b.reasons)).toBe(true);
    const bB = mgr.place(def, x2, 0, 0, b.padY, { instant: true });
    // Neither building may be left standing on ground at a different height (a step, a gap or terrain poking through).
    expect(worstMismatch(hf, bA), 'first building').toBeLessThan(0.02);
    expect(worstMismatch(hf, bB), 'second building').toBeLessThan(0.02);
  });

  it('a row of buildings up a slope stays consistent, or is refused, but is never left mis-graded', () => {
    const { hf, mgr, env } = world();
    const def = getDef('barracks');
    const placed = [];
    for (let i = 0; i < 6; i++) {
      const x = i * (def.footprint.w + MIN_GAP + 0.2);
      const r = validatePlacement(env, def, x, 0, 0);
      if (!r.ok) continue; // refusing is acceptable; mis-grading is not
      placed.push(mgr.place(def, x, 0, 0, r.padY, { instant: true }));
    }
    expect(placed.length).toBeGreaterThanOrEqual(2);
    for (const b of placed) expect(worstMismatch(hf, b), `building at x=${b.x}`).toBeLessThan(0.02);
  });
});

describe('sharing a level with neighbours', () => {
  it('a building beside another is built at the same level, not its own', () => {
    const { mgr, env } = world();
    const def = getDef('hospital');
    const a = validatePlacement(env, def, 0, 0, 0);
    mgr.place(def, 0, 0, 0, a.padY, { instant: true });
    const x2 = def.footprint.w + MIN_GAP + 0.2;
    const b = validatePlacement(env, def, x2, 0, 0);
    expect(b.ok, JSON.stringify(b.reasons)).toBe(true);
    // On the ramp its own mean would be ~0.43 higher; it takes the neighbour's level instead.
    expect(b.padY).toBeCloseTo(a.padY, 6);
  });

  it('ground a neighbour already levelled does not count as steep', () => {
    const { mgr, env } = world();
    const def = getDef('hospital');
    mgr.place(def, 0, 0, 0, validatePlacement(env, def, 0, 0, 0).padY, { instant: true });
    const b = validatePlacement(env, def, def.footprint.w + MIN_GAP + 0.2, 0, 0);
    expect(b.reasons.map((r) => r.code)).not.toContain('too_steep');
  });

  it('a building far enough away is independent and takes its own level', () => {
    const { mgr, env } = world();
    const def = getDef('hospital');
    const a = validatePlacement(env, def, 0, 0, 0);
    mgr.place(def, 0, 0, 0, a.padY, { instant: true });
    const far = validatePlacement(env, def, 30, 0, 0);
    expect(far.ok).toBe(true);
    expect(far.padY).toBeGreaterThan(a.padY + 2); // the ramp has risen ~3 units by there
  });

  it('refuses a site between two neighbours at different levels', () => {
    const { hf, mgr, env } = world();
    const def = getDef('barracks');
    // Two buildings built at deliberately different levels, close enough to both influence the gap between.
    mgr.place(def, -3, 0, 0, 0.9, { instant: true });
    mgr.place(def, 5.6, 0, 0, 1.5, { instant: true });
    const r = validatePlacement(env, def, 1.3, 0, 0);
    expect(r.reasons.map((x) => x.code)).toContain('uneven_neighbors');
    expect(r.ok).toBe(false);
    void hf;
  });

  it('a row along a slope builds a level terrace until the earthworks limit stops it', () => {
    const { hf, mgr, env } = world();
    const def = getDef('barracks');
    const placed = [];
    let stopped = '';
    for (let i = 0; i < 8; i++) {
      const x = i * (def.footprint.w + MIN_GAP + 0.2);
      const r = validatePlacement(env, def, x, 0, 0);
      if (!r.ok) {
        stopped = r.reasons.map((q) => q.code).join(',');
        break;
      }
      placed.push(mgr.place(def, x, 0, 0, r.padY, { instant: true }));
    }
    expect(placed.length).toBeGreaterThanOrEqual(3);
    // Eventually the terrace would need too much cut and fill; that is the reason, not steepness or overlap.
    expect(stopped).toMatch(/earthworks/);
    const levels = placed.map((b) => b.padY);
    expect(Math.max(...levels) - Math.min(...levels)).toBeLessThan(1e-6); // one shared level
    for (const b of placed) expect(worstMismatch(hf, b)).toBeLessThan(0.02);
  });
});
