import { civicBuildings } from './recipes/civic';
import { industryBuildings } from './recipes/industry';
import { logisticsBuildings } from './recipes/logistics';
import { medicalBuildings } from './recipes/medical';
import { militaryBuildings } from './recipes/military';
import type { BuildingDef, Category } from './types';

/** Every building the player can construct, in menu order. */
export const CATALOG: BuildingDef[] = [
  ...medicalBuildings,
  ...industryBuildings,
  ...civicBuildings,
  ...militaryBuildings,
  ...logisticsBuildings,
];

const byId = new Map(CATALOG.map((d) => [d.id, d]));

export function getDef(id: string): BuildingDef {
  const def = byId.get(id);
  if (!def) throw new Error(`Unknown building "${id}"`);
  return def;
}

export function hasDef(id: string): boolean {
  return byId.has(id);
}

export function defsInCategory(category: Category): BuildingDef[] {
  return CATALOG.filter((d) => d.category === category);
}
