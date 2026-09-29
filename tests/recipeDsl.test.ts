import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { Recipe, pieceHalfExtents, pieceTop, pieceVolume, windows } from '../src/buildings/recipeDsl';
import type { PieceSpec } from '../src/buildings/types';

describe('pieceHalfExtents', () => {
  it('matches three.js Euler XYZ rotation for arbitrary rotations (guards the composition order)', () => {
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32) * Math.PI * 2 - Math.PI;
    for (let n = 0; n < 60; n++) {
      const rot: [number, number, number] = [rnd(), rnd(), rnd()];
      const size: [number, number, number] = [0.3 + (n % 5) * 0.2, 0.5 + (n % 3) * 0.3, 0.4 + (n % 4) * 0.25];
      const piece: PieceSpec = { shape: 'box', size, pos: [0, 0, 0], rot, material: 'concrete', stage: 0 };
      const m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...rot, 'XYZ'));
      const ext = [0, 0, 0];
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
        const v = new THREE.Vector3((sx * size[0]) / 2, (sy * size[1]) / 2, (sz * size[2]) / 2).applyMatrix4(m);
        ext[0] = Math.max(ext[0], Math.abs(v.x));
        ext[1] = Math.max(ext[1], Math.abs(v.y));
        ext[2] = Math.max(ext[2], Math.abs(v.z));
      }
      const got = pieceHalfExtents(piece);
      for (let k = 0; k < 3; k++) expect(got[k]).toBeCloseTo(ext[k], 9);
    }
  });

  it('the ship-bow rotation [pi/2, pi, pi/2] points a wedge along +x with its base across z', () => {
    // wedge size [across-z, length-x, thickness-y]
    const bow: PieceSpec = { shape: 'wedge', size: [0.6, 0.5, 0.3], pos: [0, 0, 0], rot: [Math.PI / 2, Math.PI, Math.PI / 2], material: 'hullGrey', stage: 0 };
    const [ex, ey, ez] = pieceHalfExtents(bow);
    expect(ex).toBeCloseTo(0.25, 9);
    expect(ey).toBeCloseTo(0.15, 9);
    expect(ez).toBeCloseTo(0.3, 9);
    // The apex (local +y) must end up on +x.
    const m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...(bow.rot as [number, number, number]), 'XYZ'));
    const apex = new THREE.Vector3(0, 1, 0).applyMatrix4(m);
    expect(apex.x).toBeCloseTo(1, 9);
    expect(Math.abs(apex.y) + Math.abs(apex.z)).toBeCloseTo(0, 9);
  });

  it('unrotated shapes use their nominal extents; cylinders/cones/frustums use the wider diameter', () => {
    expect(pieceHalfExtents({ shape: 'box', size: [2, 4, 6], pos: [0, 0, 0], material: 'concrete', stage: 0 })).toEqual([1, 2, 3]);
    expect(pieceHalfExtents({ shape: 'cylinder', size: [1, 2, 1], pos: [0, 0, 0], material: 'concrete', stage: 0 })).toEqual([0.5, 1, 0.5]);
    expect(pieceHalfExtents({ shape: 'frustum', size: [3, 2, 1], pos: [0, 0, 0], material: 'concrete', stage: 0 })).toEqual([1.5, 1, 1.5]);
  });
});

describe('volumes', () => {
  const p = (shape: PieceSpec['shape'], size: [number, number, number]): PieceSpec => ({ shape, size, pos: [0, 0, 0], material: 'concrete', stage: 0 });
  it('computes the analytic volume of each shape', () => {
    expect(pieceVolume(p('box', [2, 3, 4]))).toBe(24);
    expect(pieceVolume(p('wedge', [2, 3, 4]))).toBe(12);
    expect(pieceVolume(p('cylinder', [2, 3, 2]))).toBeCloseTo(Math.PI * 3, 9);
    expect(pieceVolume(p('cone', [2, 3, 2]))).toBeCloseTo(Math.PI, 9);
    expect(pieceVolume(p('frustum', [2, 3, 2]))).toBeCloseTo(Math.PI * 3, 9); // equal radii = cylinder
  });
});

describe('Recipe builder', () => {
  it('stores centres from bottom-based positions and applies the current stage', () => {
    const r = new Recipe();
    r.foundation(4, 3);
    r.stage(2).box('brick', [1, 2, 1], [0.5, 0.08, -0.5]);
    expect(r.pieces[0].tag).toBe('foundation');
    expect(r.pieces[0].stage).toBe(0);
    expect(r.pieces[1].pos).toEqual([0.5, 1.08, -0.5]);
    expect(r.pieces[1].stage).toBe(2);
    expect(pieceTop(r.pieces[1])).toBeCloseTo(2.08, 9);
  });

  it('row and ring generate the requested positions', () => {
    const r = new Recipe();
    const xs: number[] = [];
    r.row(4, [1, 2], [0.5, 0], (_i, x) => xs.push(x));
    expect(xs).toEqual([1, 1.5, 2, 2.5]);
    const pts: Array<[number, number]> = [];
    r.ring(4, 2, [0, 0], (_i, x, z) => pts.push([Math.round(x), Math.round(z)]));
    expect(pts).toEqual([[2, 0], [0, 2], [-2, 0], [-0, -2]].map(([a, b]) => [a, b] as [number, number]));
  });
});

describe('windows', () => {
  it('lays a rows x cols grid on each requested face, just proud of the wall', () => {
    const size: [number, number, number] = [3, 1, 2];
    const w = windows(size, { rows: 2, cols: 6, faces: ['+z', '-z'] });
    expect(w).toHaveLength(2 * 6 * 2);
    for (const d of w) {
      expect(Math.abs(d.pos[2])).toBeGreaterThan(size[2] / 2 - 0.01);
      expect(Math.abs(d.pos[0])).toBeLessThan(size[0] / 2);
    }
    expect(windows(size, { rows: 2, cols: 6, faces: ['+z'], skipBottom: 1 })).toHaveLength(6);
  });
});
