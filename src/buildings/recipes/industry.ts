import { defineBuilding, ground, pipeline, power, rail } from '../define';
import { windows } from '../recipeDsl';

export const civilianFactory = defineBuilding({
  id: 'civilian_factory',
  name: 'Civilian Factory',
  category: 'industry',
  description: 'General manufacturing: consumer goods, tools and construction materials that feed the economy.',
  w: 4,
  d: 3,
  cost: 300,
  buildTime: 28,
  placement: { maxSlopeDeg: 5 },
  ports: [ground(0.2, 1.45, [0, 1]), rail(-1.95, -0.3, [-1, 0]), power(1.6, 1.6, -1.1)],
  effects: { industry: 5, jobs: 3 },
  recipe: (r, w, d) => {
    r.foundation(w, d);
    r.stage(1);
    const hall: [number, number, number] = [3.0, 0.8, 1.8];
    r.box('brick', hall, [-0.45, 0.08, -0.5], { details: windows(hall, { rows: 1, cols: 8, faces: ['+z'], fill: 0.45 }) });
    r.box('plaster', [0.9, 0.6, 0.8], [-1.5, 0.08, 1.0], { details: windows([0.9, 0.6, 0.8], { rows: 2, cols: 3, faces: ['+z'] }) });
    r.box('concrete', [0.8, 0.25, 0.9], [1.5, 0.08, 0.5]);
    r.stage(2);
    // Sawtooth roof: four asymmetric prisms, vertical face towards the glazing side.
    r.row(4, [-1.575, -0.5], [0.75, 0], (_i, x, z) => r.wedge('metal', [0.75, 0.35, 1.8], [x, 0.88, z], { ridge: 0.0 }));
    r.box('roofDark', [1.0, 0.06, 0.9], [-1.5, 0.68, 1.0]);
    r.cyl('brickDark', 0.24, 1.5, [1.45, 0.08, -1.0]);
    r.cyl('brickDark', 0.24, 1.3, [1.45, 0.08, -0.4]);
    r.stage(3);
    r.row(5, [1.2, 1.2], [0.15, 0], (i, x, z) => r.box('wood', [0.14, 0.14 + (i % 2) * 0.05, 0.14], [x, 0.08, z]));
    r.box('team', [0.5, 0.24, 0.28], [0.4, 0.08, 1.2]);
    r.cyl('metal', 0.04, 1.1, [-0.6, 0.08, 1.2]);
    r.box('team', [0.42, 0.26, 0.02], [-0.4, 0.86, 1.2]);
  },
});

export const warFactory = defineBuilding({
  id: 'war_factory',
  name: 'War Factory',
  category: 'industry',
  description: 'Turns industry into armaments: tanks, guns and vehicles for your army. The core of a war economy.',
  w: 5,
  d: 3.6,
  cost: 450,
  buildTime: 36,
  wartime: true,
  placement: { maxSlopeDeg: 5 },
  ports: [ground(1.6, 1.75, [0, 1]), rail(-2.45, -0.5, [-1, 0]), power(2.0, 1.9, -1.3)],
  effects: { militaryIndustry: 4, jobs: 4 },
  recipe: (r, w, d) => {
    r.foundation(w, d, 'concreteDark');
    r.stage(1);
    const hall: [number, number, number] = [4.0, 1.0, 2.2];
    r.box('olive', hall, [-0.3, 0.08, -0.6], {
      details: [
        ...windows(hall, { rows: 1, cols: 10, faces: ['+z'], fill: 0.4 }),
        { shape: 'box', size: [4.0, 0.08, 0.02], pos: [0, 0.18, 1.105], material: 'accent' },
      ],
    });
    r.box('concreteDark', [1.2, 0.6, 1.0], [-1.7, 0.08, 1.1], { details: windows([1.2, 0.6, 1.0], { rows: 1, cols: 4, faces: ['+z'] }) });
    r.box('concrete', [1.3, 0.03, 1.2], [1.5, 0.08, 1.05]); // tank yard
    r.stage(2);
    r.row(5, [-1.9, -0.6], [0.8, 0], (_i, x, z) => r.wedge('oliveDark', [0.8, 0.45, 2.2], [x, 1.08, z], { ridge: 0.0 }));
    r.box('roofDark', [1.3, 0.06, 1.1], [-1.7, 0.68, 1.1]);
    r.row(3, [2.05, -1.35], [0, 0.42], (_i, x, z) => r.cyl('metalDark', 0.28, 1.75 - _i * 0.15, [x, 0.08, z]));
    // Gantry over the yard.
    for (const sz of [0.55, 1.55]) r.box('metal', [0.06, 0.8, 0.06], [1.1, 0.08, sz]);
    for (const sz of [0.55, 1.55]) r.box('metal', [0.06, 0.8, 0.06], [1.95, 0.08, sz]);
    r.box('metalDark', [0.95, 0.07, 0.08], [1.52, 0.88, 0.55]);
    r.box('metalDark', [0.95, 0.07, 0.08], [1.52, 0.88, 1.55]);
    r.stage(3);
    // Two finished tanks waiting in the yard.
    for (const [x, z] of [[1.3, 0.9], [1.75, 1.25]] as const) {
      r.box('tan', [0.5, 0.14, 0.28], [x, 0.11, z]);
      r.cyl('tan', 0.17, 0.08, [x - 0.03, 0.25, z]);
      r.box('metalDark', [0.3, 0.035, 0.035], [x + 0.1, 0.28, z]);
    }
    r.cyl('metal', 0.05, 1.6, [2.25, 0.08, 1.55]);
    r.box('team', [0.55, 0.34, 0.02], [1.98, 1.3, 1.55]);
  },
});

export const powerPlant = defineBuilding({
  id: 'power_plant',
  name: 'Power Plant',
  category: 'industry',
  description: 'Generates the electricity your factories, hospitals and cities run on. Twin cooling towers.',
  w: 5,
  d: 4.2,
  cost: 400,
  buildTime: 36,
  placement: { maxSlopeDeg: 5 },
  ports: [power(2.2, 2.0, 0), ground(-0.5, 2.05, [0, 1]), pipeline(-2.45, 0.6, [-1, 0])],
  effects: { power: 12, pollution: 3 },
  recipe: (r, w, d) => {
    r.foundation(w, d);
    r.stage(1);
    const turbine: [number, number, number] = [2.8, 1.0, 1.6];
    r.box('concrete', turbine, [-1.0, 0.08, -1.0], { details: windows(turbine, { rows: 1, cols: 8, faces: ['+z'], fill: 0.35 }) });
    r.box('brickDark', [1.6, 1.4, 1.2], [-1.4, 0.08, 1.0], { details: windows([1.6, 1.4, 1.2], { rows: 3, cols: 4, faces: ['+z'], fill: 0.35 }) });
    r.frustum('concrete', 1.5, 0.95, 2.2, [1.4, 0.08, -0.85]);
    r.frustum('concrete', 1.5, 0.95, 2.2, [1.4, 0.08, 0.95]);
    r.stage(2);
    r.box('metalDark', [3.0, 0.08, 1.7], [-1.0, 1.08, -1.0]);
    r.box('roofDark', [1.6, 0.08, 1.3], [-1.4, 1.48, 1.0]);
    r.cyl('brick', 0.3, 2.6, [-2.33, 0.08, 1.6], {
      details: [
        { shape: 'cylinder', size: [0.32, 0.18, 0.32], pos: [0, 1.0, 0], material: 'white' },
        { shape: 'cylinder', size: [0.31, 0.18, 0.31], pos: [0, 0.6, 0], material: 'cRed' },
      ],
    });
    r.stage(3);
    // Transformer yard and pylon.
    r.row(3, [-0.3, 1.55], [0.36, 0], (_i, x, z) => r.box('metal', [0.3, 0.3, 0.3], [x, 0.08, z]));
    r.box('metalDark', [0.08, 1.5, 0.08], [2.1, 0.08, 1.7]);
    r.box('metalDark', [0.7, 0.06, 0.06], [2.1, 1.35, 1.77]); // crossarms sit in front of the pole
    r.box('metalDark', [0.5, 0.06, 0.06], [2.1, 1.05, 1.77]);
  },
});

export const oilRefinery = defineBuilding({
  id: 'oil_refinery',
  name: 'Oil Refinery',
  category: 'industry',
  description: 'Refines crude oil into fuel for tanks, trucks and aircraft. Tank farm, towers and a flare stack.',
  w: 5,
  d: 4,
  cost: 500,
  buildTime: 42,
  placement: { maxSlopeDeg: 5 },
  ports: [pipeline(-2.45, 0, [-1, 0]), ground(0.5, 1.95, [0, 1]), rail(2.45, 0.5, [1, 0])],
  effects: { fuel: 8, pollution: 4 },
  recipe: (r, w, d) => {
    r.foundation(w, d);
    r.stage(1);
    // Tank farm: 2 x 2 large tanks.
    for (const [x, z] of [[-1.7, -1.1], [-0.5, -1.1], [-1.7, 0.2], [-0.5, 0.2]] as const) {
      r.cyl('tank', 0.95, 0.65, [x, 0.08, z], { details: [{ shape: 'cylinder', size: [0.85, 0.03, 0.85], pos: [0, 0.34, 0], material: 'metal' }] });
    }
    // Distillation towers.
    r.cyl('metal', 0.36, 1.9, [1.0, 0.08, -1.0]);
    r.cyl('metal', 0.32, 1.6, [1.7, 0.08, -1.0]);
    r.box('concrete', [1.1, 0.6, 0.8], [1.4, 0.08, 0.3], { details: windows([1.1, 0.6, 0.8], { rows: 1, cols: 4, faces: ['+z'] }) });
    r.stage(2);
    r.cone('metalDark', 0.4, 0.3, [1.0, 1.98, -1.0]);
    r.cone('metalDark', 0.36, 0.28, [1.7, 1.68, -1.0]);
    // Pipe racks.
    r.box('metalDark', [2.8, 0.07, 0.07], [-0.8, 0.55, -0.45]);
    r.box('metalDark', [2.0, 0.07, 0.07], [0.5, 0.75, -0.45]);
    r.box('rust', [0.07, 0.07, 1.0], [1.0, 0.7, -0.3]);
    r.stage(3);
    // Flare stack.
    r.cyl('metalDark', 0.08, 2.3, [2.2, 0.08, -1.55]);
    r.cone('orange', 0.18, 0.32, [2.2, 2.38, -1.55]);
    r.cyl('tank', 0.5, 0.4, [-1.1, 0.08, 1.45]);
    r.cyl('tank', 0.5, 0.4, [-0.2, 0.08, 1.45]);
    r.box('team', [0.4, 0.22, 0.02], [0.6, 0.98, 1.6]);
    r.cyl('metal', 0.04, 0.9, [0.4, 0.08, 1.6]);
  },
});

export const industryBuildings = [civilianFactory, warFactory, powerPlant, oilRefinery];
