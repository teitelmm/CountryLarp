import * as THREE from 'three';
import type { CountryColors } from '../world/CountryData';
import type { MaterialId } from './types';

/** Base palette (sRGB hex). team / teamLight / accent are resolved per country. */
const PALETTE: Record<Exclude<MaterialId, 'team' | 'teamLight' | 'accent'>, number> = {
  concrete: 0xb8b6ae, concreteDark: 0x8b8983, plaster: 0xe9e5da, brick: 0xa3523d, brickDark: 0x7a3b2c,
  roofTile: 0x8c4a36, roofDark: 0x5a4a44, glass: 0x6ea6c8, metal: 0x8d979f, metalDark: 0x4a525a,
  asphalt: 0x3a3c40, line: 0xe8e6dc, sand: 0xc9b98d, lawn: 0x5f9146, field1: 0xb7b13e, field2: 0x6d9a3f,
  field3: 0x8c6f3b, olive: 0x5b653c, oliveDark: 0x3e472b, tan: 0x8f8462, redCross: 0xd32f2f,
  white: 0xf4f4f0, orange: 0xe2851d, rust: 0x8b4a2b, tank: 0xdedbd3, gold: 0xd3a62c, stone: 0x9c978c,
  marble: 0xe8e5de, hullGrey: 0x6f7b85, hullRed: 0x8b2f2f, wood: 0x8a6a43, hay: 0xd1b34b,
  cRed: 0xb23a2f, cBlue: 0x2f5d99, cGreen: 0x3f7d4f, cYellow: 0xd2a92b, cOrange: 0xd0722a,
};

const EMISSIVE: Partial<Record<MaterialId, number>> = { glass: 0x102030, gold: 0x2a1f00, orange: 0x1a0d00 };
// Kept low: there is no environment map, so strongly metallic surfaces would render near-black.
const METALLIC: Partial<Record<MaterialId, number>> = { metal: 0.12, metalDark: 0.1, gold: 0.35, glass: 0.1 };
const ROUGH: Partial<Record<MaterialId, number>> = { glass: 0.25, gold: 0.35, metal: 0.55, marble: 0.5 };

export type MaterialSet = Record<MaterialId, THREE.MeshStandardMaterial>;

const cache = new Map<string, MaterialSet>();

/** Shared materials for a team (cached by colours so every building of a country reuses them). */
export function getMaterials(colors: CountryColors): MaterialSet {
  const key = `${colors.primary}|${colors.secondary}`;
  let set = cache.get(key);
  if (set) return set;
  const make = (id: MaterialId, hex: number | THREE.Color) => {
    const color = hex instanceof THREE.Color ? hex : new THREE.Color(hex);
    return new THREE.MeshStandardMaterial({
      color,
      flatShading: true,
      roughness: ROUGH[id] ?? 0.85,
      metalness: METALLIC[id] ?? 0.05,
      emissive: EMISSIVE[id] !== undefined ? new THREE.Color(EMISSIVE[id]) : new THREE.Color(0x000000),
    });
  };
  const primary = new THREE.Color(colors.primary);
  const partial: Partial<MaterialSet> = {};
  for (const id of Object.keys(PALETTE) as Array<keyof typeof PALETTE>) partial[id] = make(id, PALETTE[id]);
  partial.team = make('team', primary);
  partial.teamLight = make('teamLight', primary.clone().lerp(new THREE.Color(0xffffff), 0.4));
  partial.accent = make('accent', new THREE.Color(colors.secondary));
  set = partial as MaterialSet;
  cache.set(key, set);
  return set;
}

/** Translucent tinted material for placement ghosts. */
export function makeGhostMaterial(color: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55, depthWrite: false });
}
