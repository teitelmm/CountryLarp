import { describe, expect, it } from 'vitest';
import { CATALOG, defsInCategory, getDef, hasDef } from '../src/buildings/catalog';
import { getMaterials } from '../src/buildings/materials';
import { FOUNDATION_BOTTOM, FOUNDATION_TOP, pieceHalfExtents, pieceTop, pieceVolume } from '../src/buildings/recipeDsl';
import { CATEGORIES, type BuildingDef, type PieceSpec } from '../src/buildings/types';

const VALID_MATERIALS = new Set(Object.keys(getMaterials({ primary: '#123456', secondary: '#abcdef' })));
const EPS = 0.02;

const label = (d: BuildingDef, i: number) => `${d.id}#${i}(${d.pieces[i].shape}/${d.pieces[i].material}${d.pieces[i].tag ? '/' + d.pieces[i].tag : ''})`;

/** AABB of a piece in building-local space. */
function aabb(p: PieceSpec) {
  const h = pieceHalfExtents(p);
  return { min: [p.pos[0] - h[0], p.pos[1] - h[1], p.pos[2] - h[2]], max: [p.pos[0] + h[0], p.pos[1] + h[1], p.pos[2] + h[2]] };
}

describe('catalog contents', () => {
  it('has the 18 planned buildings across the 5 categories', () => {
    expect(CATALOG).toHaveLength(18);
    const counts = Object.fromEntries(CATEGORIES.map((c) => [c.id, defsInCategory(c.id).length]));
    expect(counts).toEqual({ medical: 2, industry: 4, civic: 4, military: 6, logistics: 2 });
  });

  it('has unique ids and lookup works', () => {
    const ids = CATALOG.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(hasDef(id)).toBe(true);
      expect(getDef(id).id).toBe(id);
    }
    expect(hasDef('nope')).toBe(false);
    expect(() => getDef('nope')).toThrow();
  });

  it('includes the buildings the design calls for', () => {
    for (const id of ['hospital', 'field_hospital', 'war_factory', 'monument']) expect(hasDef(id)).toBe(true);
  });

  it('every def has sane metadata', () => {
    const problems: string[] = [];
    for (const d of CATALOG) {
      if (!d.name || !d.description) problems.push(`${d.id}: missing name/description`);
      if (!(d.cost > 0) || !(d.buildTime > 0)) problems.push(`${d.id}: cost/buildTime must be positive`);
      if (!(d.footprint.w > 0 && d.footprint.d > 0)) problems.push(`${d.id}: bad footprint`);
      if (!(d.placement.maxSlopeDeg > 0)) problems.push(`${d.id}: bad slope limit`);
      if (Object.keys(d.effects).length === 0) problems.push(`${d.id}: no effects`);
      if (d.ports.length === 0) problems.push(`${d.id}: no supply ports`);
      if (!CATEGORIES.some((c) => c.id === d.category)) problems.push(`${d.id}: bad category`);
    }
    expect(problems).toEqual([]);
  });

  it('the war buildings and coastal buildings are flagged as designed', () => {
    expect(getDef('field_hospital').wartime).toBe(true);
    expect(getDef('war_factory').wartime).toBe(true);
    expect(getDef('naval_base').placement.needsCoast).toBe(true);
    expect(getDef('port').placement.needsCoast).toBe(true);
    expect(getDef('airfield').placement.maxSlopeDeg).toBeLessThanOrEqual(3);
    expect(getDef('field_hospital').buildTime).toBeLessThan(getDef('hospital').buildTime);
  });
});

describe('piece recipes', () => {
  it('have a sensible number of pieces and valid materials', () => {
    const problems: string[] = [];
    for (const d of CATALOG) {
      if (d.pieces.length < 6 || d.pieces.length > 80) problems.push(`${d.id}: ${d.pieces.length} pieces`);
      d.pieces.forEach((p, i) => {
        if (!VALID_MATERIALS.has(p.material)) problems.push(`${label(d, i)}: unknown material`);
        for (const det of p.details ?? []) if (!VALID_MATERIALS.has(det.material)) problems.push(`${label(d, i)}: unknown detail material ${det.material}`);
        if (!(pieceVolume(p) > 0)) problems.push(`${label(d, i)}: non-positive volume`);
        if (p.size.some((s) => !(s > 0))) problems.push(`${label(d, i)}: non-positive size`);
      });
    }
    expect(problems).toEqual([]);
  });

  it('start with a foundation covering the footprint and use contiguous stages from 0', () => {
    const problems: string[] = [];
    for (const d of CATALOG) {
      const stages = [...new Set(d.pieces.map((p) => p.stage))].sort((a, b) => a - b);
      stages.forEach((s, i) => {
        if (s !== i) problems.push(`${d.id}: stages not contiguous ${stages.join(',')}`);
      });
      const foundations = d.pieces.filter((p) => p.tag === 'foundation');
      if (foundations.length !== 1) problems.push(`${d.id}: expected exactly one foundation, found ${foundations.length}`);
      else {
        const f = foundations[0];
        if (f.stage !== 0) problems.push(`${d.id}: foundation must be stage 0`);
        if (Math.abs(f.size[0] - d.footprint.w) > 1e-9 || Math.abs(f.size[2] - d.footprint.d) > 1e-9) problems.push(`${d.id}: foundation must cover the footprint`);
      }
      if (stages.length < 3) problems.push(`${d.id}: needs at least 3 construction stages`);
    }
    expect(problems).toEqual([]);
  });

  it('keep every piece inside the footprint and standing on the foundation', () => {
    const problems: string[] = [];
    for (const d of CATALOG) {
      const hw = d.footprint.w / 2 + EPS;
      const hd = d.footprint.d / 2 + EPS;
      d.pieces.forEach((p, i) => {
        const b = aabb(p);
        if (b.min[0] < -hw || b.max[0] > hw || b.min[2] < -hd || b.max[2] > hd) {
          problems.push(`${label(d, i)} sticks out: x[${b.min[0].toFixed(2)},${b.max[0].toFixed(2)}] z[${b.min[2].toFixed(2)},${b.max[2].toFixed(2)}] vs ±${(hw - EPS).toFixed(2)}/±${(hd - EPS).toFixed(2)}`);
        }
        if (p.tag !== 'foundation' && b.min[1] < FOUNDATION_TOP - EPS) problems.push(`${label(d, i)} sinks below the foundation top: y=${b.min[1].toFixed(2)}`);
        if (p.tag === 'foundation' && Math.abs(b.min[1] - FOUNDATION_BOTTOM) > 1e-9) problems.push(`${label(d, i)} foundation bottom`);
      });
    }
    expect(problems).toEqual([]);
  });

  it("keep supply ports within the building's bounds", () => {
    const problems: string[] = [];
    for (const d of CATALOG) {
      for (const port of d.ports) {
        const [x, y, z] = port.pos;
        if (Math.abs(x) > d.footprint.w / 2 + 0.05 || Math.abs(z) > d.footprint.d / 2 + 0.05 || y < 0 || y > d.height + 0.5) {
          problems.push(`${d.id}: ${port.kind} port at (${x}, ${y}, ${z}) outside bounds`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it('derive height from the tallest piece', () => {
    for (const d of CATALOG) {
      const top = Math.max(...d.pieces.map(pieceTop));
      expect(d.height).toBeCloseTo(top, 1);
      expect(d.height).toBeGreaterThan(0.3);
    }
  });

  it('do not have pieces interpenetrating (they are separate rigid bodies during construction)', () => {
    // Two pieces overlapping by more than this on every axis at once collide in their final pose.
    // AABBs are conservative for rotated/round shapes, so the tolerance is deliberately generous.
    const TOL = 0.06;
    const problems: string[] = [];
    for (const d of CATALOG) {
      const boxes = d.pieces.map(aabb);
      for (let i = 0; i < d.pieces.length; i++) {
        if (d.pieces[i].tag === 'foundation') continue;
        if (d.pieces[i].rot) continue; // AABBs of rotated pieces are too conservative to judge
        for (let j = i + 1; j < d.pieces.length; j++) {
          if (d.pieces[j].tag === 'foundation' || d.pieces[j].rot) continue;
          const a = boxes[i];
          const b = boxes[j];
          const ox = Math.min(a.max[0], b.max[0]) - Math.max(a.min[0], b.min[0]);
          const oy = Math.min(a.max[1], b.max[1]) - Math.max(a.min[1], b.min[1]);
          const oz = Math.min(a.max[2], b.max[2]) - Math.max(a.min[2], b.min[2]);
          if (ox > TOL && oy > TOL && oz > TOL) {
            problems.push(`${label(d, i)} x ${label(d, j)} overlap by (${ox.toFixed(2)}, ${oy.toFixed(2)}, ${oz.toFixed(2)})`);
          }
        }
      }
    }
    expect(problems).toEqual([]);
  });
});
