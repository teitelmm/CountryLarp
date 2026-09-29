import * as THREE from 'three';
import type { RTSCamera } from '../camera/RTSCamera';
import { CONFIG } from '../core/config';
import type { Input } from '../core/Input';
import type { Treasury } from '../core/Treasury';
import type { Tooltip } from '../ui/Tooltip';
import type { Toast } from '../ui/Toast';
import type { Territory } from '../world/Territory';
import type { World } from '../world/World';
import type { Building } from './Building';
import type { BuildingManager } from './BuildingManager';
import { createBuildingGroup } from './PieceFactory';
import type { MaterialSet } from './materials';
import type { BuildingDef, MaterialId } from './types';
import { bestCoastRotation, validatePlacement, type PlacementResult } from './Validation';

const VALID = 0x4bd17f;
const INVALID = 0xe5604d;

export interface PlacementDeps {
  world: World;
  rig: RTSCamera;
  input: Input;
  buildings: BuildingManager;
  treasury: Treasury;
  territory: Territory;
  tooltip: Tooltip;
  toast: Toast;
}

export interface PlaceOutcome {
  ok: boolean;
  result: PlacementResult;
  building?: Building;
  /** Set when validation passed but the treasury could not cover the cost. */
  insufficientFunds?: boolean;
}

/**
 * The placement mode: pick a building type, a translucent ghost follows the cursor snapped to the
 * grid, tinted green or red by live validation, with a tooltip listing every reason it can't go there.
 *
 *   Left click  place (Shift keeps placing)      R / Shift+R  rotate 90 degrees
 *   Right click / Esc  cancel                     Alt + wheel  fine rotation
 */
export class Placement {
  private def: BuildingDef | null = null;
  private rot = 0;
  private ghost: THREE.Group | null = null;
  private outline: THREE.LineLoop | null = null;
  private readonly ghostMaterial = new THREE.MeshStandardMaterial({
    color: VALID, emissive: VALID, emissiveIntensity: 0.25, transparent: true, opacity: 0.6, depthWrite: false, flatShading: true,
  });
  private readonly outlineMaterial = new THREE.LineBasicMaterial({ color: VALID });
  private last: (PlacementResult & { affordable: boolean }) | null = null;
  private consumed = false;
  private listeners = new Set<(def: BuildingDef | null) => void>();
  private placedListeners = new Set<(b: Building) => void>();
  private readonly disposers: Array<() => void> = [];

  constructor(private readonly d: PlacementDeps) {
    this.disposers.push(
      d.input.onClick((e) => {
        if (!this.def) return;
        // Other click handlers (selection) run after this one in the same event: tell them it is spoken for.
        this.consumed = true;
        setTimeout(() => (this.consumed = false), 0);
        if (e.button === 0) this.placeAtCursor(e.shift);
        else if (e.button === 2) this.cancel();
      }),
      d.input.onKey((e) => {
        if (!this.def) return;
        if (e.code === 'Escape') this.cancel();
        else if (e.code === 'KeyR' && !e.repeat) this.rotate(e.shift ? -Math.PI / 2 : Math.PI / 2);
      }),
    );
  }

  get active(): BuildingDef | null {
    return this.def;
  }

  /** True while the current click was handled by placement (so selection must ignore it). */
  get clickConsumed() {
    return this.consumed;
  }

  get lastResult() {
    return this.last;
  }

  get rotation() {
    return this.rot;
  }

  /** Called whenever placement mode starts, changes building or ends. */
  onActiveChange(fn: (def: BuildingDef | null) => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  onPlaced(fn: (b: Building) => void) {
    this.placedListeners.add(fn);
    return () => this.placedListeners.delete(fn);
  }

  start(def: BuildingDef) {
    if (this.def?.id === def.id) return;
    this.clearGhost();
    this.def = def;
    this.last = null;
    this.buildGhost(def);
    this.emit();
  }

  cancel() {
    if (!this.def) return;
    this.def = null;
    this.last = null;
    this.clearGhost();
    this.d.tooltip.hide();
    this.d.world.terrain.setGrid(0);
    this.emit();
  }

  rotate(delta: number) {
    if (!this.def || this.def.placement.needsCoast) return; // coastal buildings auto-align to the sea
    this.rot = (this.rot + delta) % (Math.PI * 2);
  }

  private emit() {
    for (const fn of this.listeners) fn(this.def);
  }

  // --- ghost ---------------------------------------------------------------------------------

  private buildGhost(def: BuildingDef) {
    const set = {} as MaterialSet;
    for (const id of Object.keys(this.d.buildings.materials) as MaterialId[]) set[id] = this.ghostMaterial;
    const group = createBuildingGroup(def, set);
    group.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.castShadow = false;
        o.receiveShadow = false;
      }
    });
    const hw = def.footprint.w / 2;
    const hd = def.footprint.d / 2;
    const outline = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-hw, 0.06, -hd), new THREE.Vector3(hw, 0.06, -hd), new THREE.Vector3(hw, 0.06, hd), new THREE.Vector3(-hw, 0.06, hd),
      ]),
      this.outlineMaterial,
    );
    group.add(outline);
    group.visible = false;
    this.ghost = group;
    this.outline = outline;
    this.d.world.scene.add(group);
  }

  private clearGhost() {
    if (!this.ghost) return;
    this.d.world.scene.remove(this.ghost);
    this.outline?.geometry.dispose();
    this.ghost = null;
    this.outline = null;
  }

  private tint(ok: boolean) {
    const c = ok ? VALID : INVALID;
    this.ghostMaterial.color.setHex(c);
    this.ghostMaterial.emissive.setHex(c);
    this.outlineMaterial.color.setHex(c);
  }

  // --- per-frame -----------------------------------------------------------------------------

  update() {
    const { input, rig, world, tooltip } = this.d;
    const def = this.def;
    if (!def || !this.ghost) return;

    // Alt + wheel: fine rotation (consumes the wheel so the camera does not zoom).
    if (input.alt && !def.placement.needsCoast) {
      const w = input.consumeWheel();
      if (w !== 0) this.rot += Math.sign(w) * (Math.PI / 24);
    }

    if (!input.pointer.known || !input.pointer.overCanvas) {
      this.ghost.visible = false;
      tooltip.hide();
      world.terrain.setGrid(0);
      return;
    }
    const hit = rig.raycastTerrain(input.pointer.ndc);
    if (!hit) {
      this.ghost.visible = false;
      tooltip.hide();
      return;
    }

    const snap = CONFIG.gridSnap;
    const x = Math.round(hit.x / snap) * snap;
    const z = Math.round(hit.z / snap) * snap;
    if (def.placement.needsCoast) this.rot = bestCoastRotation(world.hf, def, x, z, this.rot);

    const result = validatePlacement(this.d.buildings.env(this.d.territory), def, x, z, this.rot);
    const affordable = this.d.treasury.canAfford(def.cost);
    this.last = { ...result, affordable };
    const ok = result.ok && affordable;

    this.ghost.visible = true;
    this.ghost.position.set(x, result.padY, z);
    this.ghost.rotation.y = this.rot;
    this.tint(ok);
    world.terrain.setGrid(1, x, z, Math.max(def.footprint.w, def.footprint.d) * 0.9 + 3);

    const problems = result.reasons.map((r) => r.message);
    if (!affordable) problems.push(`Not enough funds (need ${def.cost.toLocaleString('en-US')})`);
    const hint = ok
      ? `Click to place · ${def.placement.needsCoast ? 'auto-aligned to the coast' : 'R to rotate'} · Esc to cancel`
      : 'Esc or right-click to cancel';
    tooltip.show(input.pointer.x, input.pointer.y, def.name, problems, hint);
  }

  // --- placing -------------------------------------------------------------------------------

  private placeAtCursor(keep: boolean) {
    const def = this.def;
    const last = this.last;
    if (!def || !last || !this.ghost?.visible) return;
    const x = this.ghost.position.x;
    const z = this.ghost.position.z;
    const outcome = this.placeAt(def, x, z, this.rot);
    if (outcome.ok) {
      this.d.toast.show(`${def.name} placed`, 'good', 1400);
      if (!keep) this.cancel();
    } else if (outcome.insufficientFunds) {
      this.d.toast.show(`Not enough funds for ${def.name}`, 'bad');
    } else {
      this.d.toast.show(outcome.result.reasons[0]?.message ?? "Can't build here", 'bad');
    }
  }

  /** Validate a site without placing. Coastal buildings are auto-aligned to the sea when `rot` is omitted. */
  check(def: BuildingDef, x: number, z: number, rot?: number): PlacementResult & { rot: number } {
    const r = rot ?? (def.placement.needsCoast ? bestCoastRotation(this.d.world.hf, def, x, z) : 0);
    return { ...validatePlacement(this.d.buildings.env(this.d.territory), def, x, z, r), rot: r };
  }

  /** Validate, charge and place. The single path used by clicks, tests and (later) save/load. */
  placeAt(def: BuildingDef, x: number, z: number, rot: number): PlaceOutcome {
    const result = validatePlacement(this.d.buildings.env(this.d.territory), def, x, z, rot);
    if (!result.ok) return { ok: false, result };
    if (!this.d.treasury.spend(def.cost)) return { ok: false, result, insufficientFunds: true };
    const building = this.d.buildings.place(def, x, z, rot, result.padY);
    for (const fn of this.placedListeners) fn(building);
    return { ok: true, result, building };
  }

  dispose() {
    this.cancel();
    for (const d of this.disposers) d();
    this.ghostMaterial.dispose();
    this.outlineMaterial.dispose();
  }
}
