import * as THREE from 'three';
import type { RTSCamera } from '../camera/RTSCamera';
import type { Input } from '../core/Input';
import type { Building } from './Building';
import type { BuildingManager } from './BuildingManager';
import type { Placement } from './Placement';

/**
 * Click a building to select it. Picks by ray against the building meshes first (so tall buildings can
 * be clicked on their upper parts) and falls back to the terrain footprint (clicking the pad beside it).
 * Selection shows a footprint outline; the inspect panel reads `selected`.
 */
export class Selection {
  private current: Building | null = null;
  private readonly outline: THREE.Group;
  private readonly mats: THREE.LineBasicMaterial[] = [];
  private readonly raycaster = new THREE.Raycaster();
  private listeners = new Set<(b: Building | null) => void>();
  private readonly disposers: Array<() => void> = [];

  constructor(
    private readonly scene: THREE.Object3D,
    private readonly rig: RTSCamera,
    private readonly input: Input,
    private readonly buildings: BuildingManager,
    private readonly placement: Placement,
  ) {
    this.outline = new THREE.Group();
    this.outline.visible = false;
    for (const [offset, opacity] of [[0.05, 1], [0.13, 0.45]] as const) {
      const m = new THREE.LineBasicMaterial({ color: 0xffd166, transparent: true, opacity });
      this.mats.push(m);
      const loop = new THREE.LineLoop(new THREE.BufferGeometry(), m);
      loop.position.y = offset;
      loop.userData.grow = offset === 0.13 ? 0.18 : 0.06;
      this.outline.add(loop);
    }
    scene.add(this.outline);

    this.disposers.push(
      input.onClick((e) => {
        if (this.placement.active || this.placement.clickConsumed) return;
        if (e.button === 0) this.pickAtPointer();
        else if (e.button === 2) this.select(null);
      }),
      input.onKey((e) => {
        if (e.code === 'Escape' && !this.placement.active) this.select(null);
      }),
    );
  }

  get selected() {
    return this.current;
  }

  onChange(fn: (b: Building | null) => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  select(b: Building | null) {
    if (b === this.current) return;
    this.current = b;
    if (b) this.buildOutline(b);
    this.outline.visible = !!b;
    for (const fn of this.listeners) fn(b);
  }

  private pickAtPointer() {
    const { input, rig, buildings } = this;
    if (!input.pointer.known) return;
    this.raycaster.setFromCamera(input.pointer.ndc, rig.camera);
    let hit = buildings.pick(this.raycaster);
    if (!hit) {
      const p = rig.raycastTerrain(input.pointer.ndc);
      if (p) hit = buildings.at(p.x, p.z);
    }
    this.select(hit);
  }

  private buildOutline(b: Building) {
    const { w, d } = b.def.footprint;
    for (const child of this.outline.children) {
      const loop = child as THREE.LineLoop;
      const g = (loop.userData.grow as number) ?? 0;
      const hw = w / 2 + g;
      const hd = d / 2 + g;
      loop.geometry.dispose();
      loop.geometry = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-hw, 0, -hd), new THREE.Vector3(hw, 0, -hd), new THREE.Vector3(hw, 0, hd), new THREE.Vector3(-hw, 0, hd),
      ]);
    }
  }

  /** Follow the selected building; drop the selection if it has been demolished. */
  update(time: number) {
    const b = this.current;
    if (!b) return;
    if (b.state === 'demolishing' || !this.buildings.get(b.id)) {
      this.select(null);
      return;
    }
    this.outline.position.set(b.x, b.padY, b.z);
    this.outline.rotation.y = b.rot;
    this.mats[1].opacity = 0.3 + 0.2 * Math.sin(time * 4);
  }

  dispose() {
    for (const d of this.disposers) d();
    this.scene.remove(this.outline);
    for (const c of this.outline.children) (c as THREE.LineLoop).geometry.dispose();
    for (const m of this.mats) m.dispose();
  }
}
