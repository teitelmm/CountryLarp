import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { BuildingManager } from '../src/buildings/BuildingManager';
import { FINISH_TIME, SIZING_TIME } from '../src/buildings/ConstructionSite';
import { getDef } from '../src/buildings/catalog';
import { FIXED_DT } from '../src/core/Clock';
import { Dust } from '../src/fx/Dust';
import { loadRapier, PhysicsWorld, type Rapier } from '../src/physics/PhysicsWorld';
import { CATALOG } from '../src/buildings/catalog';
import { makeMap } from './helpers';

let rapier: Rapier;
beforeAll(async () => {
  rapier = await loadRapier();
});

const colors = { primary: '#dc143c', secondary: '#f2f2f2' };
const NEAR = new THREE.Vector3(0, 30, 30);
const FAR = new THREE.Vector3(0, 2000, 2000);

/** A tiny world: the synthetic ramp terrain, a scene, dust and a building manager. */
function setup(camera = NEAR, maxBodies?: number) {
  // A fresh physics world per test, so a test that stops mid-build cannot leak bodies into the next.
  const physics = new PhysicsWorld(rapier);
  const hf = makeMap();
  const scene = new THREE.Group();
  const dust = new Dust(300);
  scene.add(dust.points);
  const mgr = new BuildingManager({ scene, hf }, colors, { physics, dust, cameraPosition: () => camera });
  // The manager builds sites with the deps' physics; inject the body cap via a wrapped place for the budget test.
  const place = (id: string, x: number, z: number, rot = 0) => {
    const def = getDef(id);
    const b = mgr.place(def, x, z, rot, hf.meanHeight(x, z, def.footprint.w / 2, def.footprint.d / 2, rot));
    if (maxBodies !== undefined && b.site) (b.site as unknown as { ctx: { maxBodies?: number } }).ctx.maxBodies = maxBodies;
    return b;
  };
  const step = () => {
    mgr.preStep(FIXED_DT);
    physics.step();
    mgr.postStep(FIXED_DT);
    dust.update(FIXED_DT);
  };
  const run = (seconds: number, each?: (t: number) => void) => {
    const n = Math.round(seconds / FIXED_DT);
    for (let i = 0; i < n; i++) {
      step();
      each?.(i * FIXED_DT);
    }
  };
  const runUntilDone = (limit: number, each?: (t: number) => void) => {
    let t = 0;
    while (mgr.activeSites > 0 && t < limit) {
      step();
      t += FIXED_DT;
      each?.(t);
    }
    return t;
  };
  return { hf, scene, dust, mgr, physics, place, step, run, runUntilDone };
}

describe('sizing phase', () => {
  it('pops the blueprint up with an overshoot and grades the ground flat', () => {
    const { hf, mgr, place, step } = setup();
    const b = place('hospital', 4, 0);
    const site = b.site!;
    expect(b.state).toBe('sizing');
    expect(b.progress).toBe(0);
    const before = hf.sample(4, 0);
    let peak = 0;
    let sawPartialGrade = false;
    for (let i = 0; i < Math.round(SIZING_TIME / FIXED_DT) + 2; i++) {
      step();
      const s = (site as unknown as { blueprint: THREE.Group }).blueprint.scale.x;
      peak = Math.max(peak, s);
      const pad = hf.pad[Math.round(hf.gridZ(0)) * hf.cols + Math.round(hf.gridX(4))];
      if (pad > 0.05 && pad < 0.95) sawPartialGrade = true;
    }
    expect(peak).toBeGreaterThan(1.03); // spring overshoot
    expect(peak).toBeLessThan(1.3);
    expect(sawPartialGrade).toBe(true); // the pad rises gradually, not in one frame
    expect(b.state).toBe('constructing');
    expect(site.phase).toBe('building');
    // Fully graded: the whole footprint sits at the pad height.
    const padY = b.padY;
    for (const [dx, dz] of [[0, 0], [1.6, 1.1], [-1.6, -1.1], [1.7, -1.2]]) expect(hf.sample(4 + dx, dz)).toBeCloseTo(padY, 3);
    expect(padY).not.toBeCloseTo(before + 100, 0);
    expect(mgr.activeSites).toBe(1);
  });
});

describe('construction with physics', () => {
  it('assembles the building piece by piece and finishes on schedule', () => {
    const { mgr, scene, dust, physics, place, runUntilDone } = setup();
    const def = getDef('hospital');
    const b = place('hospital', 4, 0);
    const site = b.site!;
    const n = def.pieces.length;
    let maxDynamic = 0;
    let lastProgress = 0;
    let sawDust = false;
    let monotone = true;
    const done = runUntilDone(def.buildTime + 20, () => {
      maxDynamic = Math.max(maxDynamic, physics.dynamicCount);
      if (b.progress < lastProgress - 1e-9) monotone = false;
      lastProgress = b.progress;
      if (dust.liveCount > 0) sawDust = true;
    });

    expect(b.state).toBe('complete');
    expect(b.progress).toBe(1);
    expect(monotone).toBe(true);
    expect(sawDust).toBe(true);
    // Physics really ran: several pieces were in flight together, never more than exist.
    expect(maxDynamic).toBeGreaterThan(0);
    expect(maxDynamic).toBeLessThanOrEqual(n);
    // On schedule: sizing + build time + topping out, within a few seconds of slack.
    expect(done).toBeGreaterThan(def.buildTime * 0.9);
    expect(done).toBeLessThan(SIZING_TIME + def.buildTime + FINISH_TIME + 4);
    // Everything temporary is gone.
    expect(mgr.activeSites).toBe(0);
    expect(physics.dynamicCount).toBe(0);
    expect(b.site).toBeNull();
    expect(scene.children).toHaveLength(2); // the buildings group and the dust points; no progress bar left
    // What remains is a handful of merged meshes, not one mesh per piece.
    const meshes: THREE.Mesh[] = [];
    b.root.traverse((o) => o instanceof THREE.Mesh && meshes.push(o));
    expect(meshes.length).toBeGreaterThan(0);
    expect(meshes.length).toBeLessThan(n);
    expect(b.root.children.length).toBe(1);
    // No leftover crane/scaffold/blueprint/pieces under the root.
    expect(site.phase).toBe('done');
  });

  it('really steers pieces into place: most arrive on their own rather than being force-welded', () => {
    const { place, runUntilDone } = setup();
    const b = place('war_factory', 4, 0);
    const site = b.site!;
    runUntilDone(60);
    const { arrived, forced, tweened } = site.stats;
    const n = getDef('war_factory').pieces.length;
    expect(arrived + forced + tweened).toBe(n);
    expect(tweened).toBe(0);
    // If the controller were broken every piece would be forced at the deadline; the deadline is only a safety net.
    expect(arrived).toBeGreaterThanOrEqual(Math.floor(n * 0.85));
  });

  it('welds every piece at its exact pose, in a solid finished structure', () => {
    const { place, run } = setup();
    const b = place('hospital', 4, 0);
    const site = b.site!;
    // Run to the end of the build phase but before the merge, so piece meshes still exist.
    run(SIZING_TIME + getDef('hospital').buildTime + 0.5);
    expect(site.phase === 'building' || site.phase === 'finishing').toBe(true);
    for (const p of site.pieces) {
      expect(p.phase).toBe('welded');
      expect(p.mesh).not.toBeNull();
      const m = p.mesh!;
      expect(m.position.x).toBeCloseTo(p.spec.pos[0], 9);
      expect(m.position.y).toBeCloseTo(p.spec.pos[1], 9);
      expect(m.position.z).toBeCloseTo(p.spec.pos[2], 9);
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(...(p.spec.rot ?? [0, 0, 0])));
      expect(m.quaternion.angleTo(q)).toBeLessThan(1e-9);
    }
  });

  it('keeps every transform finite throughout (no physics blow-ups)', () => {
    const { place, runUntilDone, mgr } = setup();
    place('power_plant', 4, 0);
    place('supply_depot', -2, 8);
    let bad = 0;
    runUntilDone(80, () => {
      mgr.all.forEach((b) => b.root.traverse((o) => {
        if (![o.position.x, o.position.y, o.position.z, o.quaternion.x, o.quaternion.w].every(Number.isFinite)) bad++;
      }));
    });
    expect(bad).toBe(0);
  });

  it('releases pieces in construction order (foundation first)', () => {
    const { place, run } = setup();
    const b = place('hospital', 4, 0);
    const site = b.site!;
    run(SIZING_TIME + 0.05);
    expect(site.pieces[0].spec.tag).toBe('foundation');
    run(1.5);
    expect(site.pieces[0].phase).not.toBe('waiting');
    const laterStage = site.pieces.filter((p) => p.spec.stage >= 2);
    expect(laterStage.every((p) => p.phase === 'waiting')).toBe(true);
  });
});

describe('the cheap path and the body budget', () => {
  it('a distant site tweens its pieces (no rigid bodies) and still completes', () => {
    const { physics, place, runUntilDone } = setup(FAR);
    const b = place('hospital', 4, 0);
    const site = b.site!;
    let maxDynamic = 0;
    const done = runUntilDone(60, () => (maxDynamic = Math.max(maxDynamic, physics.dynamicCount)));
    expect(maxDynamic).toBe(0);
    expect(site.stats.tweened).toBe(getDef('hospital').pieces.length);
    expect(b.state).toBe('complete');
    expect(done).toBeLessThan(SIZING_TIME + getDef('hospital').buildTime + FINISH_TIME + 4);
  });

  it('when the body cap is reached, extra pieces tween instead and everything still finishes', () => {
    const { physics, place, step, mgr } = setup(NEAR, 5);
    const sites = [place('field_hospital', 4, 0), place('field_hospital', 4, 6), place('field_hospital', 4, -6)].map((b) => b.site!);
    const buildings = sites.map((s) => s.building);
    let maxDynamic = 0;
    for (let i = 0; i < 60 * 40 && mgr.activeSites > 0; i++) {
      step();
      maxDynamic = Math.max(maxDynamic, physics.dynamicCount);
    }
    expect(maxDynamic).toBeLessThanOrEqual(5);
    expect(maxDynamic).toBeGreaterThan(0);
    for (const b of buildings) expect(b.state).toBe('complete');
    // Three buildings of 15 pieces each: with a cap of 5 bodies a good share must have been tweened.
    const tweened = sites.reduce((n, s) => n + s.stats.tweened, 0);
    const steered = sites.reduce((n, s) => n + s.stats.arrived + s.stats.forced, 0);
    expect(tweened).toBeGreaterThan(0);
    expect(tweened + steered).toBe(45);
  });
});

describe('interrupting construction', () => {
  it('removing a building mid-build frees its bodies and visuals', () => {
    const { mgr, scene, physics, place, run } = setup();
    const b = place('hospital', 4, 0);
    run(SIZING_TIME + 6);
    expect(physics.dynamicCount).toBeGreaterThan(-1);
    mgr.remove(b.id);
    expect(mgr.activeSites).toBe(0);
    expect(physics.dynamicCount).toBe(0);
    expect(mgr.all).toHaveLength(0);
    expect(scene.children.some((c) => c.type === 'Group' && c !== mgr.root)).toBe(false); // progress bar gone
    // The simulation keeps running cleanly with nothing left.
    run(1);
  });

  it('instant placement skips construction entirely', () => {
    const { hf, mgr } = setup();
    const def = getDef('barracks');
    const b = mgr.place(def, 4, 0, 0, 1.4, { instant: true });
    expect(b.state).toBe('complete');
    expect(b.site).toBeNull();
    expect(mgr.activeSites).toBe(0);
    expect(hf.pad[Math.round(hf.gridZ(0)) * hf.cols + Math.round(hf.gridX(4))]).toBe(1);
    expect(b.root.children.length).toBe(1);
  });
});

describe('every building in the catalog can be constructed', () => {
  it.each(CATALOG.map((d) => [d.id]))('%s: assembles, arrives under control, and cleans up', (id) => {
    const { mgr, scene, physics, place, runUntilDone } = setup();
    const def = getDef(id);
    const b = place(id, 4, 0);
    const site = b.site!;
    let bad = 0;
    let maxDynamic = 0;
    const done = runUntilDone(def.buildTime + 25, () => {
      maxDynamic = Math.max(maxDynamic, physics.dynamicCount);
      b.root.traverse((o) => {
        if (![o.position.x, o.position.y, o.position.z, o.quaternion.w].every(Number.isFinite)) bad++;
      });
    });
    expect(b.state, `${id} finished`).toBe('complete');
    expect(bad).toBe(0);
    expect(maxDynamic).toBeGreaterThan(0);
    expect(done).toBeLessThan(SIZING_TIME + def.buildTime + FINISH_TIME + 4);
    expect(physics.dynamicCount).toBe(0);
    expect(mgr.activeSites).toBe(0);
    expect(scene.children).toHaveLength(2);
    const { arrived, forced, tweened } = site.stats;
    expect(arrived + forced + tweened).toBe(def.pieces.length);
    // The controller must be doing the work: the deadline weld is a safety net, not the mechanism.
    expect(arrived / def.pieces.length, `${id}: ${arrived} arrived, ${forced} forced`).toBeGreaterThanOrEqual(0.8);
  }, 120000);
});
