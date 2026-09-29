import { defineBuilding, ground, rail } from '../define';
import { windows } from '../recipeDsl';

export const housingBlock = defineBuilding({
  id: 'housing_block',
  name: 'Housing Block',
  category: 'civic',
  description: 'Apartment blocks for your growing population. More housing means more workers and recruits.',
  w: 3,
  d: 3,
  cost: 150,
  buildTime: 18,
  placement: { maxSlopeDeg: 8 },
  ports: [ground(0, 1.45, [0, 1])],
  effects: { housing: 8, morale: 1 },
  recipe: (r, w, d) => {
    r.foundation(w, d, 'concrete');
    r.stage(1);
    const blocks: Array<[number, number, number, number, number]> = [
      // x, z, width, height, depth
      [-0.75, -0.75, 1.1, 1.05, 0.75],
      [0.55, -0.75, 1.1, 1.3, 0.75],
      [-0.85, 0.35, 0.75, 0.9, 1.1],
    ];
    for (const [x, z, bw, bh, bd] of blocks) {
      const size: [number, number, number] = [bw, bh, bd];
      r.box('plaster', size, [x, 0.08, z], { details: windows(size, { rows: Math.round(bh / 0.3), cols: Math.round(bw / 0.28), faces: ['+z', '-z', '+x', '-x'], fill: 0.5 }) });
    }
    r.stage(2);
    for (const [x, z, bw, bh, bd] of blocks) r.wedge('roofTile', [bw + 0.06, 0.28, bd + 0.06], [x, 0.08 + bh, z], { ridge: 0.5 });
    r.stage(3);
    r.box('lawn', [1.4, 0.03, 1.0], [0.75, 0.08, 0.6]);
    for (const [x, z] of [[0.35, 0.3], [1.05, 0.35], [0.5, 0.95], [1.1, 0.95]] as const) {
      r.cone('field2', 0.3, 0.5, [x, 0.14, z], { details: [{ shape: 'cylinder', size: [0.05, 0.1, 0.05], pos: [0, -0.3, 0], material: 'wood' }] });
    }
  },
});

export const farmComplex = defineBuilding({
  id: 'farm_complex',
  name: 'Farm Complex',
  category: 'civic',
  description: 'Barn, silos and fields. Feeds your population and your army; hungry people are unhappy people.',
  w: 4,
  d: 3.4,
  cost: 120,
  buildTime: 16,
  placement: { maxSlopeDeg: 9 },
  ports: [ground(0, 1.65, [0, 1]), rail(1.95, 0, [1, 0])],
  effects: { food: 10, jobs: 2 },
  recipe: (r, w, d) => {
    r.foundation(w, d, 'lawn');
    r.stage(1);
    // Fields as thin coloured plates.
    r.box('field1', [1.2, 0.04, 1.3], [-1.3, 0.08, 1.0]);
    r.box('field3', [1.2, 0.04, 1.3], [-0.05, 0.08, 1.0]);
    r.box('field2', [1.2, 0.04, 1.3], [1.2, 0.08, 1.0]);
    // Barn, farmhouse, silos.
    r.box('brickDark', [1.1, 0.55, 0.8], [-1.0, 0.08, -0.9]);
    r.box('plaster', [0.55, 0.4, 0.5], [0.15, 0.08, -1.0], { details: windows([0.55, 0.4, 0.5], { rows: 1, cols: 3, faces: ['+z'] }) });
    r.cyl('metal', 0.38, 1.0, [1.0, 0.08, -1.0]);
    r.cyl('metal', 0.38, 0.85, [1.5, 0.08, -0.7]);
    r.stage(2);
    r.wedge('roofDark', [1.2, 0.36, 0.9], [-1.0, 0.63, -0.9]);
    r.wedge('roofTile', [0.62, 0.26, 0.56], [0.15, 0.48, -1.0]);
    r.cone('metalDark', 0.44, 0.24, [1.0, 1.08, -1.0]);
    r.cone('metalDark', 0.44, 0.24, [1.5, 0.93, -0.7]);
    r.stage(3);
    r.row(3, [-1.55, -0.2], [0.26, 0.0], (_i, x, z) => r.cyl('hay', 0.24, 0.26, [x, 0.07, z], { rot: [Math.PI / 2, 0, 0] }));
    r.box('team', [0.34, 0.16, 0.22], [0.5, 0.08, 0.1]);
    r.cyl('metalDark', 0.1, 0.1, [0.42, 0.24, 0.1]);
  },
});

export const university = defineBuilding({
  id: 'university',
  name: 'University',
  category: 'civic',
  description: 'Educates the next generation. Raises research capacity and produces officers and engineers.',
  w: 4,
  d: 3.2,
  cost: 350,
  buildTime: 30,
  placement: { maxSlopeDeg: 6 },
  ports: [ground(0, 1.55, [0, 1])],
  effects: { research: 5, morale: 1 },
  recipe: (r, w, d) => {
    r.foundation(w, d, 'stone');
    r.stage(1);
    const hall: [number, number, number] = [2.2, 0.9, 1.1];
    r.box('marble', hall, [0, 0.08, -0.7], { details: windows(hall, { rows: 2, cols: 6, faces: ['+z', '-z'] }) });
    for (const sx of [-1, 1]) {
      const wing: [number, number, number] = [0.8, 0.7, 1.7];
      r.box('marble', wing, [sx * 1.55, 0.08, -0.1], { details: windows(wing, { rows: 2, cols: 3, faces: [sx > 0 ? '+x' : '-x', '+z'] }) });
    }
    r.row(6, [-0.75, 0.0], [0.3, 0], (_i, x, z) => r.cyl('marble', 0.12, 0.72, [x, 0.08, z]));
    r.stage(2);
    r.box('roofDark', [2.2, 0.06, 1.2], [0, 0.98, -0.7]);
    r.box('marble', [0.7, 0.8, 0.7], [0, 1.04, -0.7], { details: windows([0.7, 0.8, 0.7], { rows: 1, cols: 2, faces: ['+z', '-z', '+x', '-x'], fill: 0.4 }) });
    for (const sx of [-1, 1]) r.wedge('roofDark', [0.85, 0.3, 1.8], [sx * 1.55, 0.78, -0.1], { ridge: 0.5 });
    r.box('marble', [1.6, 0.06, 0.32], [0, 0.8, 0.0]); // portico roof
    r.stage(3);
    r.cone('gold', 0.55, 0.55, [0, 1.84, -0.7]);
    r.box('stone', [1.4, 0.1, 0.3], [0, 0.08, 0.3]);
    r.box('lawn', [2.0, 0.03, 0.9], [0, 0.08, 1.05]);
    r.cyl('metal', 0.04, 1.0, [1.2, 0.08, 1.1]);
    r.box('team', [0.4, 0.24, 0.02], [1.02, 0.85, 1.1]);
  },
});

export const monument = defineBuilding({
  id: 'monument',
  name: 'National Monument',
  category: 'civic',
  description: 'A towering landmark that rallies the nation. Boosts morale and stability far beyond its footprint.',
  w: 3,
  d: 3,
  cost: 200,
  buildTime: 28,
  placement: { maxSlopeDeg: 8 },
  ports: [ground(0, 1.45, [0, 1])],
  effects: { morale: 8, stability: 3 },
  recipe: (r, w, d) => {
    r.foundation(w, d, 'stone');
    r.stage(1);
    r.cyl('marble', 2.7, 0.05, [0, 0.08, 0]);
    r.box('stone', [1.5, 0.14, 1.5], [0, 0.13, 0]);
    r.box('stone', [1.2, 0.14, 1.2], [0, 0.27, 0]);
    r.box('stone', [0.9, 0.14, 0.9], [0, 0.41, 0]);
    r.stage(2);
    r.frustum('marble', 0.55, 0.3, 2.7, [0, 0.55, 0]);
    r.stage(3);
    r.cone('gold', 0.42, 0.55, [0, 3.25, 0]);
    // Lamp posts and team banners at the corners of the plaza.
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
      r.cyl('metalDark', 0.05, 0.7, [sx * 1.15, 0.13, sz * 1.15]);
      r.cone('gold', 0.14, 0.12, [sx * 1.15, 0.83, sz * 1.15]);
    }
    r.box('team', [0.34, 0.5, 0.02], [-1.15, 0.3, 1.3]);
    r.box('accent', [0.34, 0.5, 0.02], [1.15, 0.3, 1.3]);
  },
});

export const civicBuildings = [housingBlock, farmComplex, university, monument];
