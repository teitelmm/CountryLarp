import * as THREE from 'three';
import type { RTSCamera } from '../camera/RTSCamera';
import { CONFIG } from '../core/config';
import type { CountryData } from './CountryData';
import { Borders } from './Borders';
import { HeightField } from './HeightField';
import { Lighting } from './Lighting';
import { HORIZON_COLOR, Sky, SUN_DIRECTION } from './Sky';
import { Terrain } from './Terrain';
import { Water } from './Water';

/** Everything that makes up the physical map of one country: terrain, sea, border, sky, light. */
export class World {
  readonly scene = new THREE.Scene();
  readonly hf: HeightField;
  readonly terrain: Terrain;
  readonly water: Water;
  readonly borders: Borders;
  readonly sky = new Sky();
  readonly lighting = new Lighting();
  private readonly fog = new THREE.FogExp2(HORIZON_COLOR, 0.0004);

  constructor(readonly data: CountryData) {
    // World-Y per real km: the horizontal shrink applies to the vertical too, so the terrain keeps its shape.
    this.hf = new HeightField(data, CONFIG.heightExaggeration / data.scale);
    this.terrain = new Terrain(this.hf);
    this.water = new Water(this.terrain.uniforms, SUN_DIRECTION, Math.max(data.sizeX, data.sizeZ));
    this.borders = new Borders(data.borders, data.meta.colors.primary, this.hf);
    this.scene.background = HORIZON_COLOR;
    this.scene.fog = this.fog;
    this.scene.add(this.sky.mesh, this.terrain.group, this.water.mesh, this.borders.mesh, this.lighting.group);
  }

  /** Larger map dimension in world units. */
  get extent() {
    return Math.max(this.data.sizeX, this.data.sizeZ);
  }

  update(time: number, rig: RTSCamera, renderer: THREE.WebGLRenderer) {
    this.terrain.applyDirty(renderer);
    // Fog thickens with zoom-in (so the horizon hazes) and thins with zoom-out (so the country stays clear).
    this.fog.density = 0.6 / Math.max(rig.distance * 1.6, this.extent * 0.72);
    this.sky.update(rig.camera);
    this.terrain.update(rig.camera);
    this.water.update(time);
    this.borders.update(time, rig.distance);
    this.lighting.follow(rig.focus, rig.distance);
  }

  dispose() {
    this.terrain.dispose();
    this.water.dispose();
    this.borders.dispose();
    this.sky.dispose();
  }
}
