import * as THREE from 'three';
import type { Obb } from '../core/obb';
import type { BuildingDef } from './types';

export type BuildingState = 'complete';

/** A placed building. (Construction states arrive with the construction sequencer.) */
export class Building {
  readonly root = new THREE.Group();
  state: BuildingState = 'complete';

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
