import * as THREE from 'three';
import type { Obb } from '../core/obb';
import type { ConstructionSite } from './ConstructionSite';
import type { BuildingDef } from './types';

export type BuildingState = 'sizing' | 'constructing' | 'finishing' | 'complete';

/** A placed building. While under construction its `site` drives the animation and physics. */
export class Building {
  readonly root = new THREE.Group();
  state: BuildingState = 'complete';
  /** Construction progress in [0, 1]; 1 once complete. */
  progress = 1;
  site: ConstructionSite | null = null;

  constructor(
    readonly id: number,
    readonly def: BuildingDef,
    readonly x: number,
    readonly z: number,
    readonly rot: number,
    readonly padY: number,
    readonly obb: Obb,
  ) {
    this.root.name = `${def.id}#${id}`;
    this.root.position.set(x, padY, z);
    this.root.rotation.y = rot;
    this.root.userData.buildingId = id;
  }
}
