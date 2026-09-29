import * as THREE from 'three';
import { CONFIG } from '../core/config';
import { SpatialHash } from '../core/SpatialHash';
import { obbAabb, obbContains, obbOverlap, type Obb } from '../core/obb';
import type { Dust } from '../fx/Dust';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import type { CountryColors } from '../world/CountryData';
import type { HeightField } from '../world/HeightField';
import { Building } from './Building';
import { ConstructionSite, type SiteContext } from './ConstructionSite';
import { Demolition } from './Demolition';
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
  /** Optional override of the simulated-body cap (tests). */
  maxBodies?: number;
}

/** Owns every placed building: scene graph, spatial index, terrain grading and construction sites. */
export class BuildingManager {
  readonly root = new THREE.Group();
  private readonly items = new Map<number, Building>();
  private readonly hash = new SpatialHash(8);
  private readonly sites = new Set<ConstructionSite>();
  private readonly demolitions = new Set<Demolition>();
  private readonly mats: MaterialSet;
  private nextId = 1;
  /** Bumped whenever a building is added or removed (lets overlays know to rebuild). */
  version = 0;
  private completeListeners = new Set<(b: Building) => void>();
  private changeListeners = new Set<() => void>();

  constructor(private readonly world: SiteWorld, colors: CountryColors, private readonly deps: ManagerDeps) {
    this.mats = getMaterials(colors);
    this.root.name = 'buildings';
    world.scene.add(this.root);
  }

  /** Buildings currently under construction. */
  get activeSites() {
    return this.sites.size;
  }

  /** Demolitions in progress (rubble still settling). */
  get activeDemolitions() {
    return this.demolitions.size;
  }

  /** Something needs simulating this step. */
  get busy() {
    return this.sites.size > 0 || this.demolitions.size > 0;
  }

  /** Fired when a building finishes construction. */
  onComplete(fn: (b: Building) => void) {
    this.completeListeners.add(fn);
    return () => this.completeListeners.delete(fn);
  }

  /** Fired when buildings are added or removed. */
  onChange(fn: () => void) {
    this.changeListeners.add(fn);
    return () => this.changeListeners.delete(fn);
  }

  private changed() {
    this.version++;
    for (const fn of this.changeListeners) fn();
  }

  private context(): SiteContext {
    return {
      scene: this.world.scene,
      hf: this.world.hf,
      physics: this.deps.physics,
      dust: this.deps.dust,
      mats: this.mats,
      cameraPosition: this.deps.cameraPosition,
      maxBodies: this.deps.maxBodies,
    };
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

  /** The building whose footprint contains a world point, if any. */
  at(x: number, z: number): Building | null {
    for (const id of this.hash.query({ minX: x, maxX: x, minZ: z, maxZ: z })) {
      const b = this.items.get(id)!;
      if (obbContains(b.obb, x, z)) return b;
    }
    return null;
  }

  /** The building hit by a ray (meshes first, so tall buildings can be clicked on their upper parts). */
  pick(raycaster: THREE.Raycaster): Building | null {
    // World matrices are normally refreshed by the renderer; do it here so a ray cast before the next
    // frame (or in a test) sees buildings where they actually are.
    this.root.updateMatrixWorld(true);
    for (const hit of raycaster.intersectObject(this.root, true)) {
      let o: THREE.Object3D | null = hit.object;
      while (o && o.userData.buildingId === undefined) o = o.parent;
      if (o) return this.items.get(o.userData.buildingId as number) ?? null;
    }
    return null;
  }

  /** Buildings whose footprint comes within `margin` of `obb`. */
  overlapping(obb: Obb, margin: number): Array<{ id: number; name: string; padY: number }> {
    const out: Array<{ id: number; name: string; padY: number }> = [];
    for (const id of this.hash.query(obbAabb(obb, margin))) {
      const b = this.items.get(id)!;
      if (obbOverlap(obb, b.obb, margin)) out.push({ id, name: b.def.name, padY: b.padY });
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
      hf.applyGrade(hf.planGrade({ cx: x, cz: z, halfW: def.footprint.w / 2, halfD: def.footprint.d / 2, rot, targetY: padY, margin: CONFIG.gradeMargin }), 1);
      building.root.add(mergeBuilding(createBuildingGroup(def, this.mats), this.mats));
      building.state = 'complete';
      building.progress = 1;
    } else {
      building.state = 'sizing';
      building.progress = 0;
      const site = new ConstructionSite(building, this.context());
      building.site = site;
      this.sites.add(site);
    }
    this.changed();
    return building;
  }

  /** Construction timelines and steering forces: call before the physics step. */
  preStep(dt: number) {
    for (const s of this.sites) s.preStep(dt);
    for (const d of this.demolitions) d.preStep(dt);
  }

  /** Sync meshes, weld arrived pieces and retire finished sites: call after the physics step. */
  postStep(dt: number) {
    for (const s of this.sites) {
      s.postStep(dt);
      if (s.done) {
        const b = s.building;
        b.site = null;
        this.sites.delete(s);
        for (const fn of this.completeListeners) fn(b);
      }
    }
    for (const d of this.demolitions) {
      d.postStep(dt);
      if (d.done) this.demolitions.delete(d);
    }
  }

  /** Camera-dependent visuals (progress bars). */
  updateVisuals(cameraQuat: THREE.Quaternion, cameraDistance: number) {
    for (const s of this.sites) s.updateVisuals(cameraQuat, cameraDistance);
  }

  /**
   * Bring a building down: its pieces are thrown outward as rigid bodies and fade. The footprint is free
   * immediately. A building still under construction is simply abandoned.
   */
  demolish(id: number): boolean {
    const b = this.items.get(id);
    if (!b || b.state === 'demolishing') return false;
    if (b.site) {
      this.remove(id);
      return true;
    }
    b.state = 'demolishing';
    this.demolitions.add(new Demolition(b, this.context()));
    this.items.delete(id);
    this.hash.remove(id);
    this.root.remove(b.root);
    this.changed();
    return true;
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
    this.changed();
  }

  dispose(): void {
    for (const d of this.demolitions) d.abort();
    this.demolitions.clear();
  }
}
