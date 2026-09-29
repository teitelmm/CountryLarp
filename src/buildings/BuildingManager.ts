import * as THREE from 'three';
import { SpatialHash } from '../core/SpatialHash';
import { obbAabb, obbOverlap, type Obb } from '../core/obb';
import type { CountryColors } from '../world/CountryData';
import type { World } from '../world/World';
import { Building } from './Building';
import { createBuildingGroup, mergeBuilding } from './PieceFactory';
import { getMaterials, type MaterialSet } from './materials';
import type { BuildingDef } from './types';
import { footprintObb, type PlacementEnv } from './Validation';

/** Owns every placed building: scene graph, spatial index and terrain grading. */
export class BuildingManager {
  readonly root = new THREE.Group();
  private readonly items = new Map<number, Building>();
  private readonly hash = new SpatialHash(8);
  private readonly mats: MaterialSet;
  private nextId = 1;

  constructor(private readonly world: World, colors: CountryColors) {
    this.mats = getMaterials(colors);
    this.root.name = 'buildings';
    world.scene.add(this.root);
  }

  get materials() {
    return this.mats;
  }

  get all(): Building[] {
    return [...this.items.values()];
  }

  get(id: number) {
    return this.items.get(id);
  }

  /** Buildings whose footprint comes within `margin` of `obb`. */
  overlapping(obb: Obb, margin: number): Array<{ id: number; name: string }> {
    const out: Array<{ id: number; name: string }> = [];
    for (const id of this.hash.query(obbAabb(obb, margin))) {
      const b = this.items.get(id)!;
      if (obbOverlap(obb, b.obb, margin)) out.push({ id, name: b.def.name });
    }
    return out;
  }

  /** Validation environment bound to this world and its buildings. */
  env(territory: PlacementEnv['territory']): PlacementEnv {
    return { hf: this.world.hf, territory, overlapping: (o, m) => this.overlapping(o, m) };
  }

  /** Place a building whose position has already been validated. */
  place(def: BuildingDef, x: number, z: number, rot: number, padY: number): Building {
    const id = this.nextId++;
    const building = new Building(id, def, x, z, rot, padY, footprintObb(def, x, z, rot));

    // Flatten the ground under the footprint.
    const { hf } = this.world;
    const plan = hf.planGrade({ cx: x, cz: z, halfW: def.footprint.w / 2, halfD: def.footprint.d / 2, rot, targetY: padY, margin: 1.6 });
    hf.applyGrade(plan, 1);

    const merged = mergeBuilding(createBuildingGroup(def, this.mats), this.mats);
    building.root.add(merged);
    this.root.add(building.root);
    this.items.set(id, building);
    this.hash.insert(id, obbAabb(building.obb));
    return building;
  }

  remove(id: number): void {
    const b = this.items.get(id);
    if (!b) return;
    this.root.remove(b.root);
    b.root.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose();
    });
    this.hash.remove(id);
    this.items.delete(id);
  }
}
