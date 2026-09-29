import * as THREE from 'three';
import { SpatialHash } from '../core/SpatialHash';
import { obbAabb, obbOverlap, type Obb } from '../core/obb';
import type { Dust } from '../fx/Dust';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import type { CountryColors } from '../world/CountryData';
import type { HeightField } from '../world/HeightField';
import { Building } from './Building';
import { ConstructionSite } from './ConstructionSite';
import { createBuildingGroup, mergeBuilding } from './PieceFactory';
import { getMaterials, type MaterialSet } from './materials';
import type { BuildingDef } from './types';
import { footprintObb, type PlacementEnv } from './Validation';

/** The parts of the world a building needs: somewhere to live in the scene, and the terrain. */
export interface SiteWorld {
  scene: THREE.Object3D;
  hf: HeightField;
}

export interface ManagerDeps {
  physics: PhysicsWorld;
  dust: Dust;
  /** Where the camera is (decides whether a site gets rigid bodies or the cheap tween path). */
  cameraPosition(): THREE.Vector3;
}

/** Owns every placed building: scene graph, spatial index, terrain grading and construction sites. */
export class BuildingManager {
  readonly root = new THREE.Group();
  private readonly items = new Map<number, Building>();
  private readonly hash = new SpatialHash(8);
  private readonly sites = new Set<ConstructionSite>();
  private readonly mats: MaterialSet;
  private nextId = 1;

  constructor(private readonly world: SiteWorld, colors: CountryColors, private readonly deps: ManagerDeps) {
    this.mats = getMaterials(colors);
    this.root.name = 'buildings';
    world.scene.add(this.root);
  }

  /** Buildings currently under construction. */
  get activeSites() {
    return this.sites.size;
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

  /**
   * Place a building whose position has already been validated. It sizes up and is constructed piece by
   * piece; pass `instant` to skip that (restoring saved games, tests).
   */
  place(def: BuildingDef, x: number, z: number, rot: number, padY: number, opts: { instant?: boolean } = {}): Building {
    const id = this.nextId++;
    const building = new Building(id, def, x, z, rot, padY, footprintObb(def, x, z, rot));
    this.root.add(building.root);
    this.items.set(id, building);
    this.hash.insert(id, obbAabb(building.obb));

    if (opts.instant) {
      const { hf } = this.world;
      hf.applyGrade(hf.planGrade({ cx: x, cz: z, halfW: def.footprint.w / 2, halfD: def.footprint.d / 2, rot, targetY: padY, margin: 1.6 }), 1);
      building.root.add(mergeBuilding(createBuildingGroup(def, this.mats), this.mats));
      building.state = 'complete';
      building.progress = 1;
    } else {
      building.state = 'sizing';
      building.progress = 0;
      const site = new ConstructionSite(building, {
        scene: this.world.scene,
        hf: this.world.hf,
        physics: this.deps.physics,
        dust: this.deps.dust,
        mats: this.mats,
        cameraPosition: this.deps.cameraPosition,
      });
      building.site = site;
      this.sites.add(site);
    }
    return building;
  }

  /** Construction timelines and steering forces: call before the physics step. */
  preStep(dt: number) {
    for (const s of this.sites) s.preStep(dt);
  }

  /** Sync meshes, weld arrived pieces and retire finished sites: call after the physics step. */
  postStep(dt: number) {
    for (const s of this.sites) {
      s.postStep(dt);
      if (s.done) {
        s.building.site = null;
        this.sites.delete(s);
      }
    }
  }

  /** Camera-dependent visuals (progress bars). */
  updateVisuals(cameraQuat: THREE.Quaternion, cameraDistance: number) {
    for (const s of this.sites) s.updateVisuals(cameraQuat, cameraDistance);
  }

  remove(id: number): void {
    const b = this.items.get(id);
    if (!b) return;
    if (b.site) {
      b.site.abort();
      this.sites.delete(b.site);
      b.site = null;
    }
    this.root.remove(b.root);
    b.root.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose();
    });
    this.hash.remove(id);
    this.items.delete(id);
  }
}
