import { air, defineBuilding, ground } from '../define';
import { windows } from '../recipeDsl';
import type { DetailSpec } from '../types';

/** A red cross laid flat on a horizontal face (`y` = local height of that face). */
const flatCross = (x: number, y: number, z: number, s: number): DetailSpec[] => [
  { shape: 'box', size: [s, 0.012, s], pos: [x, y + 0.006, z], material: 'white' },
  { shape: 'box', size: [s * 0.78, 0.012, s * 0.24], pos: [x, y + 0.014, z], material: 'redCross' },
  { shape: 'box', size: [s * 0.24, 0.012, s * 0.78], pos: [x, y + 0.014, z], material: 'redCross' },
];

export const hospital = defineBuilding({
  id: 'hospital',
  name: 'Hospital',
  category: 'medical',
  description: 'Treats the sick and wounded of your population and keeps morale up. Has a rooftop helipad.',
  w: 3.6,
  d: 2.6,
  cost: 250,
  buildTime: 24,
  placement: { maxSlopeDeg: 7 },
  ports: [ground(0, 1.25, [0, 1]), air(0.55, 1.75, -0.35)],
  effects: { health: 6, morale: 2 },
  recipe: (r, w, d) => {
    r.foundation(w, d);
    // Stage 1: ground-floor structure.
    r.stage(1);
    const mainSize: [number, number, number] = [2.0, 1.0, 1.2];
    r.box('plaster', mainSize, [0, 0.08, -0.35], { details: windows(mainSize, { rows: 2, cols: 6, faces: ['+z', '-z'] }) });
    for (const sx of [-1, 1]) {
      const wing: [number, number, number] = [0.8, 0.8, 1.6];
      r.box('plaster', wing, [sx * 1.4, 0.08, 0.2], { details: windows(wing, { rows: 2, cols: 3, faces: [sx > 0 ? '+x' : '-x', '+z'] }) });
    }
    r.box('plaster', [1.0, 0.7, 0.5], [0, 0.08, 0.55], {
      details: [
        { shape: 'box', size: [0.08, 0.3, 0.02], pos: [0, 0.05, 0.26], material: 'redCross' },
        { shape: 'box', size: [0.3, 0.08, 0.02], pos: [0, 0.05, 0.26], material: 'redCross' },
        { shape: 'box', size: [0.34, 0.22, 0.02], pos: [0, -0.2, 0.255], material: 'glass' },
      ],
    });
    // Stage 2: upper floor and roofs.
    r.stage(2);
    const upper: [number, number, number] = [1.8, 0.55, 1.1];
    r.box('plaster', upper, [0, 1.08, -0.35], { details: windows(upper, { rows: 1, cols: 5, faces: ['+z', '-z'] }) });
    r.box('concreteDark', [2.1, 0.08, 1.3], [0, 1.63, -0.35], { details: flatCross(-0.4, 0.04, 0, 0.6) });
    for (const sx of [-1, 1]) r.box('concreteDark', [0.8, 0.06, 1.7], [sx * 1.4, 0.88, 0.2]);
    r.box('concreteDark', [1.1, 0.06, 0.6], [0, 0.78, 0.55]);
    // Stage 3: helipad, ambulance, lawn.
    r.stage(3);
    r.cyl('concreteDark', 0.8, 0.05, [0.55, 1.71, -0.35], {
      details: [
        { shape: 'box', size: [0.06, 0.012, 0.32], pos: [-0.1, 0.03, 0], material: 'white' },
        { shape: 'box', size: [0.06, 0.012, 0.32], pos: [0.1, 0.03, 0], material: 'white' },
        { shape: 'box', size: [0.26, 0.012, 0.06], pos: [0, 0.03, 0], material: 'white' },
      ],
    });
    r.box('lawn', [2.4, 0.03, 0.45], [0, 0.08, 1.05]);
    r.box('white', [0.36, 0.2, 0.18], [-1.35, 0.11, 1.05], {
      details: [{ shape: 'box', size: [0.05, 0.12, 0.02], pos: [0, 0.02, 0.095], material: 'redCross' }, { shape: 'box', size: [0.12, 0.05, 0.02], pos: [0, 0.02, 0.095], material: 'redCross' }],
    });
    r.box('white', [0.36, 0.2, 0.18], [1.35, 0.11, 1.05]);
  },
});

export const fieldHospital = defineBuilding({
  id: 'field_hospital',
  name: 'Field Hospital',
  category: 'medical',
  description: 'Fast-deploying tented hospital for the war front. Small, cheap, and quick to build on rough ground.',
  w: 2.2,
  d: 1.8,
  cost: 60,
  buildTime: 8,
  wartime: true,
  placement: { maxSlopeDeg: 14 },
  ports: [ground(0, 0.85, [0, 1]), air(0, 0.9, 0)],
  effects: { health: 2, mobile: 1 },
  recipe: (r, w, d) => {
    r.foundation(w, d, 'sand');
    r.stage(1);
    for (const [x, z, s] of [[-0.62, -0.25, 1], [0, -0.25, 1.1], [0.62, -0.25, 1]] as const) {
      r.wedge('olive', [0.56, 0.42 * s, 1.0], [x, 0.08, z], {
        details: [{ shape: 'box', size: [0.2, 0.22, 0.02], pos: [0, -0.1 * s, 0.505], material: 'oliveDark' }],
      });
    }
    r.stage(2);
    r.cyl('metal', 0.04, 0.95, [0.9, 0.08, 0.55]);
    r.box('white', [0.34, 0.22, 0.02], [0.72, 0.72, 0.55], {
      details: [{ shape: 'box', size: [0.05, 0.16, 0.02], pos: [0, 0, 0.011], material: 'redCross' }, { shape: 'box', size: [0.16, 0.05, 0.02], pos: [0, 0, 0.011], material: 'redCross' }],
    });
    r.box('white', [0.42, 0.22, 0.2], [-0.7, 0.08, 0.6], {
      details: [{ shape: 'box', size: [0.05, 0.13, 0.02], pos: [0, 0.02, 0.105], material: 'redCross' }, { shape: 'box', size: [0.13, 0.05, 0.02], pos: [0, 0.02, 0.105], material: 'redCross' }],
    });
    r.box('olive', [0.36, 0.2, 0.2], [-0.15, 0.08, 0.62]);
    // Stage 3: sandbag wall along the front, and a ground cross for air-drop visibility.
    r.stage(3);
    r.row(6, [-0.85, -0.78], [0.34, 0], (_i, x, z) => r.box('tan', [0.3, 0.1, 0.12], [x, 0.08, z]));
    r.box('white', [0.5, 0.012, 0.5], [0.55, 0.08, 0.58], { details: flatCross(0, 0.006, 0, 0.5) });
  },
});

export const medicalBuildings = [hospital, fieldHospital];
