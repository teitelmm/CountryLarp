import { air, defineBuilding, ground, power, rail, sea } from '../define';
import { windows } from '../recipeDsl';

export const barracks = defineBuilding({
  id: 'barracks',
  name: 'Barracks',
  category: 'military',
  description: 'Houses and trains infantry. The starting point of every army.',
  w: 4,
  d: 2.6,
  cost: 180,
  buildTime: 18,
  wartime: true,
  placement: { maxSlopeDeg: 9 },
  ports: [ground(0, 1.25, [0, 1]), rail(-1.95, 0, [-1, 0])],
  effects: { recruits: 6, housing: 2 },
  recipe: (r, w, d) => {
    r.foundation(w, d, 'concrete');
    r.stage(1);
    for (const z of [-0.85, -0.1, 0.65]) {
      const hut: [number, number, number] = [2.4, 0.5, 0.5];
      r.box('olive', hut, [-0.7, 0.08, z], { details: windows(hut, { rows: 1, cols: 8, faces: ['+z'], fill: 0.4 }) });
    }
    r.box('concreteDark', [0.9, 0.55, 0.9], [1.2, 0.08, -0.6], { details: windows([0.9, 0.55, 0.9], { rows: 1, cols: 3, faces: ['+z', '+x'] }) });
    r.stage(2);
    for (const z of [-0.85, -0.1, 0.65]) r.wedge('oliveDark', [0.6, 0.3, 2.5], [-0.7, 0.58, z], { rot: [0, Math.PI / 2, 0] });
    r.wedge('roofDark', [1.0, 0.3, 1.0], [1.2, 0.63, -0.6]);
    r.stage(3);
    r.box('asphalt', [1.3, 0.03, 0.9], [1.3, 0.08, 0.7]); // parade ground
    r.cyl('metal', 0.05, 1.5, [1.75, 0.08, 1.05]);
    r.box('team', [0.5, 0.3, 0.02], [1.47, 1.28, 1.05]);
    r.cyl('wood', 0.18, 0.9, [-1.75, 0.08, 1.05]);
    r.box('oliveDark', [0.36, 0.2, 0.36], [-1.75, 0.98, 1.05]);
  },
});

export const militaryAcademy = defineBuilding({
  id: 'military_academy',
  name: 'Military Academy',
  category: 'military',
  description: 'Trains officers and doctrine. Better commanders make every division stronger.',
  w: 3.8,
  d: 3.4,
  cost: 380,
  buildTime: 30,
  wartime: true,
  placement: { maxSlopeDeg: 6 },
  ports: [ground(0, 1.65, [0, 1])],
  effects: { officers: 4, doctrine: 2 },
  recipe: (r, w, d) => {
    r.foundation(w, d, 'stone');
    r.stage(1);
    for (const sx of [-1, 1]) {
      const wing: [number, number, number] = [0.9, 1.0, 2.4];
      r.box('brick', wing, [sx * 1.3, 0.08, -0.3], { details: windows(wing, { rows: 3, cols: 3, faces: [sx > 0 ? '+x' : '-x', '+z'] }) });
    }
    const bar: [number, number, number] = [1.7, 1.0, 0.9];
    r.box('brick', bar, [0, 0.08, -0.75], { details: windows(bar, { rows: 3, cols: 4, faces: ['+z', '-z'] }) });
    r.stage(2);
    for (const sx of [-1, 1]) r.wedge('roofDark', [1.0, 0.35, 2.5], [sx * 1.3, 1.08, -0.3]);
    r.box('roofDark', [1.7, 0.08, 1.0], [0, 1.08, -0.75]);
    r.box('brickDark', [0.6, 0.5, 0.6], [0, 1.16, -0.75]);
    r.stage(3);
    r.cone('team', 0.75, 0.55, [0, 1.66, -0.75]);
    r.box('asphalt', [1.8, 0.03, 1.1], [0, 0.08, 0.95]);
    r.cyl('metal', 0.05, 1.5, [-0.7, 0.08, 1.35]);
    r.box('team', [0.5, 0.3, 0.02], [-0.42, 1.28, 1.35]);
    r.cyl('stone', 0.28, 0.35, [0.5, 0.08, 1.0]);
    r.cone('metalDark', 0.14, 0.3, [0.5, 0.43, 1.0]);
  },
});

export const airfield = defineBuilding({
  id: 'airfield',
  name: 'Airfield',
  category: 'military',
  description: 'Runway, hangars and control tower. Base your fighters and bombers here. Needs very flat ground.',
  w: 12,
  d: 3,
  cost: 600,
  buildTime: 48,
  wartime: true,
  placement: { maxSlopeDeg: 3 },
  ports: [air(-4.5, 0.3, 0.5), air(4.5, 0.3, 0.5), ground(-5.9, -1.0, [-1, 0]), rail(5.9, -1.0, [1, 0])],
  effects: { airCapacity: 8, supplyHub: 1 },
  recipe: (r, w, d) => {
    r.foundation(w, d, 'concreteDark');
    r.stage(1);
    const dashes = Array.from({ length: 16 }, (_, i) => ({
      shape: 'box' as const,
      size: [0.36, 0.008, 0.05] as [number, number, number],
      pos: [-5.0 + i * 0.66, 0.03, 0] as [number, number, number],
      material: 'line' as const,
    }));
    r.box('asphalt', [11.2, 0.05, 0.9], [0, 0.08, 0.6], { details: dashes });
    r.box('asphalt', [9.0, 0.04, 0.28], [-0.4, 0.08, -0.15]);
    for (const x of [-4.4, -2.9, -1.4]) r.box('asphalt', [0.3, 0.04, 0.55], [x, 0.08, 0.15]);
    r.stage(2);
    for (const x of [-4.2, -2.8, -1.4]) {
      r.box('metal', [1.2, 0.5, 0.8], [x, 0.08, -1.05]);
    }
    r.stage(3);
    for (const x of [-4.2, -2.8, -1.4]) r.wedge('metalDark', [0.85, 0.28, 1.25], [x, 0.58, -1.05], { rot: [0, Math.PI / 2, 0] });
    // Control tower.
    r.box('concrete', [0.35, 0.75, 0.35], [1.6, 0.08, -1.05]);
    r.box('glass', [0.55, 0.22, 0.55], [1.6, 0.83, -1.05]);
    r.box('roofDark', [0.65, 0.05, 0.65], [1.6, 1.05, -1.05]);
    r.cyl('tank', 0.42, 0.32, [3.3, 0.08, -1.05]);
    r.cyl('tank', 0.42, 0.32, [3.9, 0.08, -1.05]);
    // Three parked aircraft on the apron.
    for (const x of [-3.6, -1.6, 0.6]) {
      r.cyl('metal', 0.14, 0.8, [x, 0.1, -0.15], { rot: [0, 0, Math.PI / 2] });
      r.box('metalDark', [0.24, 0.02, 0.8], [x + 0.05, 0.2, -0.15]);
      r.box('metalDark', [0.1, 0.16, 0.02], [x - 0.36, 0.16, -0.15]);
    }
    r.cyl('metal', 0.03, 0.5, [5.6, 0.08, 1.2]);
    r.box('orange', [0.22, 0.1, 0.02], [5.5, 0.48, 1.2]);
  },
});

export const navalBase = defineBuilding({
  id: 'naval_base',
  name: 'Naval Base',
  category: 'military',
  description: 'Drydock, warehouses and a gantry crane where your fleet is built and repaired. Must be built on a coast.',
  w: 6,
  d: 4,
  cost: 700,
  buildTime: 54,
  wartime: true,
  placement: { maxSlopeDeg: 6, needsCoast: true },
  ports: [sea(0, 1.95, [0, 1]), ground(-2.9, -1.0, [-1, 0]), rail(2.9, -1.0, [1, 0])],
  effects: { navalCapacity: 6, supplyHub: 1 },
  recipe: (r, w, d) => {
    r.foundation(w, d, 'concrete');
    r.stage(1);
    // Drydock basin: two long walls and an end wall around a ship on the stocks.
    r.box('concreteDark', [3.4, 0.35, 0.2], [-0.4, 0.08, 0.35]);
    r.box('concreteDark', [3.4, 0.35, 0.2], [-0.4, 0.08, 1.45]);
    r.box('concreteDark', [0.2, 0.35, 0.9], [-2.0, 0.08, 0.9]);
    // Warehouses.
    for (const x of [-2.2, -0.7]) r.box('metal', [1.3, 0.7, 1.0], [x, 0.08, -1.3]);
    r.box('brickDark', [1.1, 0.6, 0.9], [1.0, 0.08, -1.3], { details: windows([1.1, 0.6, 0.9], { rows: 1, cols: 4, faces: ['+z'] }) });
    r.stage(2);
    // Ship hull on the stocks.
    r.box('hullGrey', [3.0, 0.32, 0.7], [-0.4, 0.14, 0.9]);
    // Bow: wedge apex points +x (see the rotation test), base across z.
    r.wedge('hullGrey', [0.7, 0.6, 0.32], [1.4, 0.0, 0.9], { rot: [Math.PI / 2, Math.PI, Math.PI / 2] });
    // Gantry crane spanning the drydock.
    for (const z of [0.0, 1.8]) {
      r.box('orange', [0.1, 1.5, 0.1], [0.6, 0.08, z]);
      r.box('orange', [0.1, 1.5, 0.1], [1.5, 0.08, z]);
    }
    r.stage(3);
    r.box('orange', [1.2, 0.1, 2.0], [1.05, 1.58, 0.9]);
    r.box('white', [0.5, 0.3, 0.5], [-0.9, 0.46, 0.9]);
    r.cyl('hullRed', 0.16, 0.3, [-0.9, 0.76, 0.9]);
    r.box('roofDark', [1.4, 0.06, 1.1], [-2.2, 0.78, -1.3]);
    r.box('roofDark', [1.4, 0.06, 1.1], [-0.7, 0.78, -1.3]);
    r.box('concrete', [2.2, 0.12, 0.35], [-0.8, 0.08, 1.75]); // quay edge
    r.cyl('metal', 0.05, 1.3, [2.5, 0.08, 1.4]);
    r.box('team', [0.5, 0.3, 0.02], [2.22, 1.05, 1.4]);
  },
});

export const radarStation = defineBuilding({
  id: 'radar_station',
  name: 'Radar Station',
  category: 'military',
  description: 'Early-warning radar that spots aircraft and ships far out. Best on high ground.',
  w: 2.4,
  d: 2.4,
  cost: 250,
  buildTime: 22,
  wartime: true,
  placement: { maxSlopeDeg: 18 },
  ports: [ground(0, 1.15, [0, 1]), power(-0.8, 0.5, -0.6)],
  effects: { detection: 8 },
  recipe: (r, w, d) => {
    r.foundation(w, d, 'concrete');
    r.stage(1);
    r.box('concreteDark', [1.2, 0.5, 1.0], [-0.35, 0.08, 0.2], { details: windows([1.2, 0.5, 1.0], { rows: 1, cols: 4, faces: ['+z'], fill: 0.4 }) });
    r.cyl('metal', 0.3, 1.6, [0.45, 0.08, -0.35]);
    r.stage(2);
    r.box('roofDark', [1.3, 0.05, 1.1], [-0.35, 0.58, 0.2]);
    r.box('metalDark', [0.5, 0.12, 0.5], [0.45, 1.68, -0.35]);
    r.stage(3);
    // Dish: a squat cylinder plate on a mast, tilted skywards.
    r.cyl('metal', 0.08, 0.22, [0.45, 1.8, -0.35]);
    r.cyl('white', 0.9, 0.06, [0.45, 1.97, -0.35], { rot: [0.6, 0, 0.0] });
    r.cone('metalDark', 0.14, 0.4, [0.45, 2.02, -0.62], { rot: [-0.6, 0, 0] });
    r.ring(8, 1.02, [0, 0], (_i, x, z) => r.box('metalDark', [0.05, 0.3, 0.05], [x, 0.08, z]));
    r.box('olive', [0.4, 0.3, 0.3], [-0.85, 0.08, -0.8]);
  },
});

export const fortress = defineBuilding({
  id: 'fortress',
  name: 'Fortress',
  category: 'military',
  description: 'A hardened stronghold with corner towers and a keep. Holds the line where the ground is rough.',
  w: 3.6,
  d: 3.6,
  cost: 350,
  buildTime: 34,
  wartime: true,
  placement: { maxSlopeDeg: 20 },
  ports: [ground(0, 1.75, [0, 1])],
  effects: { defense: 8, garrison: 3 },
  recipe: (r, w, d) => {
    r.foundation(w, d, 'stone');
    r.stage(1);
    // Curtain walls (between the corner towers).
    r.box('stone', [2.2, 0.7, 0.32], [0, 0.08, -1.45]);
    r.box('stone', [0.32, 0.7, 2.2], [-1.45, 0.08, 0]);
    r.box('stone', [0.32, 0.7, 2.2], [1.45, 0.08, 0]);
    r.box('stone', [0.7, 0.7, 0.32], [-0.75, 0.08, 1.45]);
    r.box('stone', [0.7, 0.7, 0.32], [0.75, 0.08, 1.45]);
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) r.cyl('stone', 0.6, 1.1, [sx * 1.45, 0.08, sz * 1.45]);
    r.stage(2);
    r.box('stone', [1.1, 1.1, 1.1], [0, 0.08, -0.2], { details: windows([1.1, 1.1, 1.1], { rows: 2, cols: 2, faces: ['+z', '+x', '-x'], fill: 0.3, material: 'metalDark' }) });
    r.box('concreteDark', [0.7, 0.5, 0.3], [0, 0.08, 1.45]);
    r.stage(3);
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) r.cone('team', 0.68, 0.45, [sx * 1.45, 1.18, sz * 1.45]);
    r.box('stone', [1.2, 0.1, 1.2], [0, 1.18, -0.2]);
    r.cyl('metal', 0.04, 0.8, [0, 1.28, -0.2]);
    r.box('team', [0.45, 0.28, 0.02], [0.24, 1.8, -0.2]);
    for (const x of [-0.5, 0.5]) {
      r.cyl('metalDark', 0.1, 0.5, [x, 0.08, 0.7], { rot: [Math.PI / 2 - 0.35, 0, 0] });
    }
  },
});

export const militaryBuildings = [barracks, militaryAcademy, airfield, navalBase, radarStation, fortress];
