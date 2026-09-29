import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import { unpackDataImage } from '../scripts/lib/bake-lib.mjs';
import { STARTER_SET } from '../scripts/countries.config.mjs';
import { decodeCountry, type CountryMeta } from '../src/world/CountryData';

const dir = path.resolve(__dirname, '../public/data/countries');
const readMeta = (iso: string): CountryMeta => JSON.parse(fs.readFileSync(path.join(dir, `${iso}.json`), 'utf8'));
const readPng = (iso: string) => PNG.sync.read(fs.readFileSync(path.join(dir, `${iso}.png`)));

describe('baked starter countries', () => {
  it('ship every country in the starter set with an index entry', () => {
    const index = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'));
    const isos = index.map((c: { iso: string }) => c.iso);
    for (const iso of STARTER_SET) expect(isos).toContain(iso);
  });

  it.each(STARTER_SET.map((s) => s.toLowerCase()))('%s: runtime decode matches the baker and metadata', (iso) => {
    const meta = readMeta(iso);
    const png = readPng(iso);
    expect(png.width).toBe(meta.cols);
    expect(png.height).toBe(meta.rows);

    const data = decodeCountry(meta, png.data);
    // The runtime decoder and the baker's unpack must agree (they are separate implementations).
    const ref = unpackDataImage(png.data, meta.cols, meta.rows);
    expect(Array.from(data.heights.subarray(0, 5000))).toEqual(Array.from(ref.heights.subarray(0, 5000)));
    expect(Array.from(data.mask.subarray(0, 5000))).toEqual(Array.from(ref.mask.subarray(0, 5000)));

    // Mask area matches the recorded stats, and some land is above sea level.
    let inside = 0;
    let maxH = -Infinity;
    for (let n = 0; n < data.mask.length; n++) {
      if (data.mask[n]) {
        inside++;
        if (data.heights[n] > maxH) maxH = data.heights[n];
      }
    }
    expect(inside).toBe(meta.stats.landCells);
    // Stats are taken before quantisation, so allow one step of slack.
    expect(Math.abs(maxH - meta.stats.maxHeightM)).toBeLessThanOrEqual(1);
    expect(Math.abs(inside * meta.cellKm ** 2 - meta.stats.landKm2)).toBeLessThan(1);

    // Land inside the border is never at or below sea level (polders are lifted by the baker).
    let below = 0;
    for (let n = 0; n < data.mask.length; n++) if (data.mask[n] && data.heights[n] <= 0) below++;
    expect(below).toBe(0);
  });

  it.each(STARTER_SET.map((s) => s.toLowerCase()))('%s: border rings sit inside the map and enclose the mask', (iso) => {
    const meta = readMeta(iso);
    const data = decodeCountry(meta, readPng(iso).data);
    const hx = data.sizeX / 2 + meta.cellKm;
    const hz = data.sizeZ / 2 + meta.cellKm;
    expect(meta.borders.length).toBeGreaterThan(0);
    for (const poly of meta.borders) {
      expect(poly.length).toBeGreaterThan(0);
      for (const ring of poly) {
        expect(ring.length).toBeGreaterThan(3);
        for (const [x, z] of ring) {
          expect(Math.abs(x)).toBeLessThanOrEqual(hx);
          expect(Math.abs(z)).toBeLessThanOrEqual(hz);
        }
      }
    }
  });

  it('known areas are within a few percent of reality', () => {
    // Real areas (km^2): metropolitan/mainland extents as baked. GBR is looser (single-parallel projection).
    const expected: Record<string, [number, number]> = {
      pol: [312_696, 0.02], deu: [357_022, 0.02], fra: [551_695, 0.02], ita: [301_340, 0.03], ukr: [603_550, 0.02], gbr: [242_495, 0.06],
    };
    for (const [iso, [area, tol]] of Object.entries(expected)) {
      const m = readMeta(iso);
      expect(Math.abs(m.stats.landKm2 - area) / area, `${iso} area ${m.stats.landKm2}`).toBeLessThan(tol);
    }
  });

  it('Ukraine includes Crimea (recognised borders): its outline reaches south of 45.0N', () => {
    const meta = readMeta('ukr');
    // World z is south-positive km from the map centre; convert to latitude via lat0.
    let minLat = Infinity;
    for (const poly of meta.borders) for (const ring of poly) for (const [, z] of ring) minLat = Math.min(minLat, meta.lat0 - z / 111.195);
    expect(minLat).toBeLessThan(45.0);
  });
});
