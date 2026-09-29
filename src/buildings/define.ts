import { Recipe, pieceTop } from './recipeDsl';
import type { BuildingDef, Category, PlacementRules, SupplyPort } from './types';

interface DefineInput {
  id: string;
  name: string;
  category: Category;
  description: string;
  /** Footprint in world units (km). */
  w: number;
  d: number;
  cost: number;
  /** Game seconds at 1x. */
  buildTime: number;
  placement: PlacementRules;
  wartime?: boolean;
  ports: SupplyPort[];
  effects: Record<string, number>;
  recipe: (r: Recipe, w: number, d: number) => void;
}

/** Build a BuildingDef from a recipe; height is derived from the tallest piece. */
export function defineBuilding(input: DefineInput): BuildingDef {
  const r = new Recipe();
  input.recipe(r, input.w, input.d);
  const height = Math.round(Math.max(...r.pieces.map(pieceTop)) * 100) / 100;
  return {
    id: input.id,
    name: input.name,
    category: input.category,
    description: input.description,
    footprint: { w: input.w, d: input.d },
    height,
    cost: input.cost,
    buildTime: input.buildTime,
    placement: input.placement,
    wartime: input.wartime,
    ports: input.ports,
    effects: input.effects,
    pieces: r.pieces,
  };
}

// Port shorthands (local coordinates; y is height above the pad).
export const ground = (x: number, z: number, dir?: [number, number]): SupplyPort => ({ kind: 'ground', pos: [x, 0.12, z], dir });
export const rail = (x: number, z: number, dir?: [number, number]): SupplyPort => ({ kind: 'rail', pos: [x, 0.12, z], dir });
export const sea = (x: number, z: number, dir?: [number, number]): SupplyPort => ({ kind: 'sea', pos: [x, 0.05, z], dir });
export const air = (x: number, y: number, z: number): SupplyPort => ({ kind: 'air', pos: [x, y, z] });
export const pipeline = (x: number, z: number, dir?: [number, number]): SupplyPort => ({ kind: 'pipeline', pos: [x, 0.3, z], dir });
export const power = (x: number, y: number, z: number): SupplyPort => ({ kind: 'power', pos: [x, y, z] });
