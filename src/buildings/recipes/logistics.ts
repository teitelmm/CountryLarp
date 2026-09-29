import { air, defineBuilding, ground, rail, sea } from '../define';
import type { MaterialId } from '../types';

export const supplyDepot = defineBuilding({
  id: 'supply_depot',
  name: 'Supply Depot',
  category: 'logistics',
  description: 'Warehouses, trucks and a rail siding. A node in your supply network: units resupply from here.',
  w: 4,
  d: 3,
  cost: 220,
  buildTime: 22,
  wartime: true,
  placement: { maxSlopeDeg: 6 },
  ports: [ground(0, 1.45, [0, 1]), rail(1.95, 0, [1, 0]), air(0, 1.4, 0)],
  effects: { supplyRange: 6, storage: 10 },
  recipe: (r, w, d) => {
    r.foundation(w, d, 'concrete');
    r.stage(1);
    for (const x of [-1.3, 0, 1.3]) r.box('metal', [1.1, 0.6, 0.9], [x, 0.08, -0.85]);
    r.box('asphalt', [3.4, 0.03, 0.7], [0, 0.08, 0.75]); // yard road
    r.stage(2);
    for (const x of [-1.3, 0, 1.3]) r.wedge('metalDark', [1.15, 0.28, 0.95], [x, 0.68, -0.85]);
    // Crate stacks.
    const mats: MaterialId[] = ['wood', 'cGreen', 'cBlue', 'wood', 'cYellow', 'cGreen'];
    r.row(6, [-1.6, 0.05], [0.28, 0], (i, x, z) => r.box(mats[i], [0.22, 0.2, 0.22], [x, 0.11, z]));
    r.row(3, [-1.5, 0.05], [0.28, 0], (i, x, z) => r.box(mats[i + 1], [0.2, 0.18, 0.2], [x, 0.31, z]));
    r.stage(3);
    for (const [x, z] of [[0.6, 0.75], [1.4, 0.75]] as const) {
      r.box('team', [0.5, 0.22, 0.26], [x, 0.11, z]);
      r.box('oliveDark', [0.2, 0.2, 0.26], [x + 0.32, 0.11, z]);
    }
    // Rail siding along the +x edge.
    r.box('metalDark', [0.06, 0.05, 2.6], [1.9, 0.08, 0.1]);
    r.box('metalDark', [0.06, 0.05, 2.6], [1.7, 0.08, 0.1]);
    r.cyl('oliveDark', 0.2, 0.28, [-0.4, 0.08, 1.15]);
    r.cyl('oliveDark', 0.2, 0.28, [-0.1, 0.08, 1.15]);
  },
});

export const port = defineBuilding({
  id: 'port',
  name: 'Port',
  category: 'logistics',
  description: 'Quays, cranes and container yards. Ships bring supplies and troops in from overseas. Must be built on a coast.',
  w: 6,
  d: 4.5,
  cost: 650,
  buildTime: 54,
  placement: { maxSlopeDeg: 6, needsCoast: true },
  ports: [sea(0, 2.2, [0, 1]), ground(-2.9, -1.4, [-1, 0]), rail(2.9, -1.4, [1, 0])],
  effects: { supplyHub: 2, tradeCapacity: 8 },
  recipe: (r, w, d) => {
    r.foundation(w, d, 'concrete');
    r.stage(1);
    r.box('metal', [1.9, 0.8, 1.0], [-2.0, 0.08, -1.6]);
    r.box('brickDark', [1.2, 0.6, 0.9], [-0.1, 0.08, -1.65]);
    // Container yard: three rows of stacked containers.
    const colors: MaterialId[] = ['cRed', 'cBlue', 'cGreen', 'cYellow', 'cOrange', 'cBlue'];
    r.stage(2);
    let n = 0;
    for (const z of [-0.5, 0.05]) {
      r.row(5, [0.7, z], [0.5, 0], (_i, x, zz) => {
        r.box(colors[n % colors.length], [0.44, 0.2, 0.2], [x, 0.11, zz]);
        n++;
      });
    }
    r.row(4, [0.95, -0.5], [0.5, 0], (i, x, z) => r.box(colors[(i + 2) % colors.length], [0.44, 0.2, 0.2], [x, 0.31, z]));
    r.wedge('roofDark', [1.95, 0.3, 1.05], [-2.0, 0.88, -1.6], { rot: [0, Math.PI, 0] });
    r.stage(3);
    // Two quayside gantry cranes.
    for (const x of [-1.6, 0.4]) {
      for (const z of [0.85, 1.35]) r.box('orange', [0.09, 1.3, 0.09], [x, 0.08, z]);
      r.box('orange', [0.14, 0.1, 1.6], [x, 1.38, 1.4]); // jib reaches out over the ship
    }
    // Cargo ship alongside.
    r.box('hullGrey', [2.4, 0.3, 0.6], [1.2, 0.1, 1.85]);
    r.wedge('hullGrey', [0.6, 0.5, 0.3], [2.65, 0.0, 1.85], { rot: [Math.PI / 2, Math.PI, Math.PI / 2] }); // bow points +x
    r.box('white', [0.5, 0.34, 0.4], [0.5, 0.4, 1.85]);
    r.cyl('hullRed', 0.16, 0.3, [0.5, 0.74, 1.85]);
    r.row(3, [1.2, 1.85], [0.5, 0], (i, x, z) => r.box(colors[i], [0.4, 0.2, 0.3], [x, 0.4, z]));
    r.cyl('metal', 0.05, 1.5, [2.7, 0.08, -1.7]);
    r.box('team', [0.5, 0.3, 0.02], [2.42, 1.3, -1.7]);
  },
});

export const logisticsBuildings = [supplyDepot, port];
