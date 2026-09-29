import type { Building } from '../buildings/Building';

/** One saved building. `complete` false means construction was under way; `elapsed` is how far it had got. */
export interface SavedBuilding {
  def: string;
  x: number;
  z: number;
  rot: number;
  padY: number;
  complete: boolean;
  elapsed: number;
}

export interface SaveData {
  v: 1;
  iso: string;
  funds: number;
  buildings: SavedBuilding[];
}

export const saveKey = (iso: string) => `countrylarp.save.v2.${iso.toUpperCase()}`;

/** Snapshot the parts of the game worth keeping. */
export function encode(iso: string, funds: number, buildings: Building[]): SaveData {
  return {
    v: 1,
    iso,
    funds,
    buildings: buildings
      .filter((b) => b.state !== 'demolishing')
      .map((b) => ({
        def: b.def.id,
        x: b.x,
        z: b.z,
        rot: b.rot,
        padY: b.padY,
        complete: b.state === 'complete',
        elapsed: b.site ? b.site.totalTime : 0,
      })),
  };
}

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/** Parse and validate saved JSON. Returns null for anything malformed or from another country/version. */
export function parse(json: string | null, iso: string, knownDef: (id: string) => boolean): SaveData | null {
  if (!json) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  const d = raw as Partial<SaveData> | null;
  if (!d || d.v !== 1 || d.iso !== iso || !finite(d.funds) || !Array.isArray(d.buildings)) return null;
  const buildings: SavedBuilding[] = [];
  for (const b of d.buildings) {
    if (!b || typeof b.def !== 'string' || !knownDef(b.def)) continue; // skip unknown buildings rather than fail the whole save
    if (![b.x, b.z, b.rot, b.padY, b.elapsed].every(finite) || typeof b.complete !== 'boolean') continue;
    buildings.push({ def: b.def, x: b.x, z: b.z, rot: b.rot, padY: b.padY, complete: b.complete, elapsed: Math.max(0, b.elapsed) });
  }
  return { v: 1, iso, funds: d.funds, buildings };
}

export function readSave(iso: string, knownDef: (id: string) => boolean): SaveData | null {
  try {
    return parse(localStorage.getItem(saveKey(iso)), iso, knownDef);
  } catch {
    return null; // storage unavailable (private mode, blocked)
  }
}

export function writeSave(data: SaveData): boolean {
  try {
    localStorage.setItem(saveKey(data.iso), JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

export function clearSave(iso: string) {
  try {
    localStorage.removeItem(saveKey(iso));
  } catch {
    /* ignore */
  }
}
