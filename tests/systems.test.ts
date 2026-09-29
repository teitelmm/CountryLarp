import * as THREE from 'three';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Building } from '../src/buildings/Building';
import { BuildingManager } from '../src/buildings/BuildingManager';
import { SIZING_TIME } from '../src/buildings/ConstructionSite';
import { StrategicMarkers, MARKER_FADE_IN, MARKER_FULL } from '../src/buildings/StrategicMarkers';
import { getDef, hasDef } from '../src/buildings/catalog';
import { footprintObb } from '../src/buildings/Validation';
import { FIXED_DT } from '../src/core/Clock';
import { clearSave, encode, parse, readSave, saveKey, writeSave, type SaveData } from '../src/core/Save';
import { Treasury } from '../src/core/Treasury';
import { Dust } from '../src/fx/Dust';
import { loadRapier, PhysicsWorld, type Rapier } from '../src/physics/PhysicsWorld';
import { makeMap } from './helpers';

let rapier: Rapier;
beforeAll(async () => {
  rapier = await loadRapier();
});

const colors = { primary: '#dc143c', secondary: '#f2f2f2' };

function world() {
  const physics = new PhysicsWorld(rapier);
  const hf = makeMap();
  const scene = new THREE.Group();
  const dust = new Dust(200);
  scene.add(dust.points);
  const mgr = new BuildingManager({ scene, hf }, colors, { physics, dust, cameraPosition: () => new THREE.Vector3(0, 30, 30) });
  const step = () => {
    mgr.preStep(FIXED_DT);
    physics.step();
    mgr.postStep(FIXED_DT);
  };
  return { physics, hf, scene, dust, mgr, step };
}

describe('Treasury', () => {
  it('spends only what it has and reports changes', () => {
    const t = new Treasury(100);
    const seen: number[] = [];
    t.onChange((v) => seen.push(v));
    expect(t.canAfford(100)).toBe(true);
    expect(t.canAfford(101)).toBe(false);
    expect(t.spend(101)).toBe(false);
    expect(t.funds).toBe(100);
    expect(t.spend(40)).toBe(true);
    expect(t.funds).toBe(60);
    expect(t.spend(-5)).toBe(false); // a negative price must not mint money
    t.add(15);
    t.set(500);
    expect(seen).toEqual([60, 75, 500]);
  });

  it('stops notifying after unsubscribe', () => {
    const t = new Treasury(10);
    let n = 0;
    const off = t.onChange(() => n++);
    t.add(1);
    off();
    t.add(1);
    expect(n).toBe(1);
  });
});

describe('save format', () => {
  const b = (id: number, def: string, x: number, state: Building['state']) => {
    const d = getDef(def);
    const bd = new Building(id, d, x, 2, 0.5, 1.25, footprintObb(d, x, 2, 0.5));
    bd.state = state;
    return bd;
  };

  it('round-trips buildings and funds', () => {
    const data = encode('POL', 4321, [b(1, 'hospital', 4, 'complete'), b(2, 'port', -3, 'constructing')]);
    const back = parse(JSON.stringify(data), 'POL', hasDef)!;
    expect(back).toEqual(data);
    expect(back.buildings.map((x) => x.complete)).toEqual([true, false]);
    expect(back.funds).toBe(4321);
  });

  it('does not save buildings that are being demolished', () => {
    const data = encode('POL', 1, [b(1, 'hospital', 4, 'complete'), b(2, 'hospital', 9, 'demolishing')]);
    expect(data.buildings).toHaveLength(1);
  });

  it('rejects malformed, foreign or outdated saves', () => {
    const good: SaveData = { v: 1, iso: 'POL', funds: 10, buildings: [] };
    expect(parse(null, 'POL', hasDef)).toBeNull();
    expect(parse('not json', 'POL', hasDef)).toBeNull();
    expect(parse('{}', 'POL', hasDef)).toBeNull();
    expect(parse(JSON.stringify({ ...good, v: 2 }), 'POL', hasDef)).toBeNull();
    expect(parse(JSON.stringify(good), 'DEU', hasDef)).toBeNull(); // another country's save
    expect(parse(JSON.stringify({ ...good, funds: null }), 'POL', hasDef)).toBeNull();
    expect(parse(JSON.stringify({ ...good, buildings: 'x' }), 'POL', hasDef)).toBeNull();
    expect(parse(JSON.stringify(good), 'POL', hasDef)).toEqual(good);
  });

  it('skips individual bad buildings but keeps the rest', () => {
    const ok = { def: 'hospital', x: 1, z: 2, rot: 0, padY: 1, complete: true, elapsed: 0 };
    const raw = { v: 1, iso: 'POL', funds: 5, buildings: [ok, { ...ok, def: 'removed_building' }, { ...ok, x: 'NaN' }, { ...ok, padY: null }, { ...ok, elapsed: -7, complete: false }, null] };
    const back = parse(JSON.stringify(raw), 'POL', hasDef)!;
    expect(back.buildings).toHaveLength(2);
    expect(back.buildings[1].elapsed).toBe(0); // negative elapsed is clamped
  });

  it('uses a per-country key and never throws when storage is unavailable', () => {
    expect(saveKey('pol')).toBe(saveKey('POL'));
    expect(saveKey('POL')).not.toBe(saveKey('DEU'));
    // Node has no localStorage: every accessor must degrade quietly.
    expect(readSave('POL', hasDef)).toBeNull();
    expect(writeSave({ v: 1, iso: 'POL', funds: 1, buildings: [] })).toBe(false);
    expect(() => clearSave('POL')).not.toThrow();
  });

  describe('with a working localStorage', () => {
    afterEach(() => vi.unstubAllGlobals());
    it('writes, reads back and clears', () => {
      const store = new Map<string, string>();
      vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) });
      const data: SaveData = { v: 1, iso: 'POL', funds: 77, buildings: [{ def: 'hospital', x: 1, z: 2, rot: 0, padY: 1, complete: true, elapsed: 0 }] };
      expect(writeSave(data)).toBe(true);
      expect(readSave('POL', hasDef)).toEqual(data);
      expect(readSave('DEU', hasDef)).toBeNull();
      clearSave('POL');
      expect(readSave('POL', hasDef)).toBeNull();
    });

    it('survives a storage that throws (quota / private mode)', () => {
      vi.stubGlobal('localStorage', { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('quota'); }, removeItem: () => { throw new Error('denied'); } });
      expect(readSave('POL', hasDef)).toBeNull();
      expect(writeSave({ v: 1, iso: 'POL', funds: 1, buildings: [] })).toBe(false);
      expect(() => clearSave('POL')).not.toThrow();
    });
  });
});

describe('resuming construction (fast-forward)', () => {
  const place = (m: BuildingManager, hf: ReturnType<typeof makeMap>) => {
    const def = getDef('hospital');
    return m.place(def, 4, 0, 0, hf.meanHeight(4, 0, def.footprint.w / 2, def.footprint.d / 2, 0));
  };

  it('jumps to the saved point and then finishes on the original schedule', () => {
    const def = getDef('hospital');
    // Reference: how long an uninterrupted build takes.
    const ref = world();
    const rb = place(ref.mgr, ref.hf);
    let refTime = 0;
    while (ref.mgr.activeSites > 0 && refTime < 200) { ref.step(); refTime += FIXED_DT; }
    expect(rb.state).toBe('complete');

    // Resume at 40% of the way and let it finish.
    const w = world();
    const b = place(w.mgr, w.hf);
    const skip = refTime * 0.4;
    b.site!.fastForward(skip);
    expect(b.state).toBe('constructing');
    expect(b.progress).toBeGreaterThan(0.2);
    expect(b.progress).toBeLessThan(0.7);
    expect(w.physics.dynamicCount).toBe(0); // the skipped part used no rigid bodies
    expect(b.site!.totalTime).toBeCloseTo(skip, 1);
    let rest = 0;
    while (w.mgr.activeSites > 0 && rest < 200) { w.step(); rest += FIXED_DT; }
    expect(b.state).toBe('complete');
    expect(rest + skip).toBeGreaterThan(refTime - 3);
    expect(rest + skip).toBeLessThan(refTime + 3);
    expect(def.pieces.length).toBeGreaterThan(0);
  });

  it('fast-forwarding past the end completes the building', () => {
    const w = world();
    const b = place(w.mgr, w.hf);
    b.site!.fastForward(SIZING_TIME + getDef('hospital').buildTime + 10);
    expect(b.state).toBe('complete');
    expect(w.physics.dynamicCount).toBe(0);
  });
});

describe('picking', () => {
  it('finds the building under a point or along a ray', () => {
    const { mgr } = world();
    const def = getDef('barracks');
    const b = mgr.place(def, 4, 0, 0, 1.4, { instant: true });
    expect(mgr.at(4, 0)).toBe(b);
    expect(mgr.at(4 + def.footprint.w / 2 - 0.1, 0.5)).toBe(b);
    expect(mgr.at(30, 30)).toBeNull();
    expect(mgr.at(4 + def.footprint.w / 2 + 0.5, 0)).toBeNull();

    const down = new THREE.Raycaster(new THREE.Vector3(4, 20, 0), new THREE.Vector3(0, -1, 0));
    expect(mgr.pick(down)).toBe(b);
    const miss = new THREE.Raycaster(new THREE.Vector3(30, 20, 30), new THREE.Vector3(0, -1, 0));
    expect(mgr.pick(miss)).toBeNull();
  });

  it('picks the nearer of two buildings and ignores demolished ones', () => {
    const { mgr } = world();
    const a = mgr.place(getDef('barracks'), 0, 0, 0, 1.4, { instant: true });
    const c = mgr.place(getDef('barracks'), 9, 0, 0, 1.4, { instant: true });
    expect(mgr.pick(new THREE.Raycaster(new THREE.Vector3(9, 20, 0), new THREE.Vector3(0, -1, 0)))).toBe(c);
    mgr.demolish(c.id);
    expect(mgr.pick(new THREE.Raycaster(new THREE.Vector3(9, 20, 0), new THREE.Vector3(0, -1, 0)))).toBeNull();
    expect(mgr.at(0, 0)).toBe(a);
  });
});

describe('strategic markers fade with distance', () => {
  it('are invisible close up, fully visible far away, and monotone in between', () => {
    expect(StrategicMarkers.opacityAt(MARKER_FADE_IN - 10)).toBe(0);
    expect(StrategicMarkers.opacityAt(MARKER_FULL + 10)).toBe(1);
    let prev = 0;
    for (let d = MARKER_FADE_IN; d <= MARKER_FULL; d += 2) {
      const o = StrategicMarkers.opacityAt(d);
      expect(o).toBeGreaterThanOrEqual(prev);
      prev = o;
    }
    expect(StrategicMarkers.opacityAt((MARKER_FADE_IN + MARKER_FULL) / 2)).toBeCloseTo(0.5, 1);
  });
});
