import * as THREE from 'three';
import type { IconRenderer } from '../ui/IconRenderer';
import type { Building } from './Building';
import type { BuildingManager } from './BuildingManager';

/** Camera distance where markers start to fade in, and where they are fully shown. */
export const MARKER_FADE_IN = 70;
export const MARKER_FULL = 120;
/** On-screen height of a marker as a fraction of the viewport. */
const SCREEN_HEIGHT = 0.085;

/**
 * Map markers for zoomed-out play: at country scale a building is a few pixels, so each one gets a
 * constant-size billboard of its own icon, fading in as the camera pulls away (like Hearts of Iron).
 */
export class StrategicMarkers {
  private readonly sprites = new Map<number, THREE.Sprite>();
  private readonly textures = new Map<string, THREE.Texture>();
  private lastVersion = -1;

  constructor(
    private readonly scene: THREE.Object3D,
    private readonly buildings: BuildingManager,
    private readonly icons: IconRenderer,
  ) {}

  /** Opacity for a camera distance: 0 close up, 1 zoomed out. */
  static opacityAt(distance: number) {
    return THREE.MathUtils.smoothstep(distance, MARKER_FADE_IN, MARKER_FULL);
  }

  get count() {
    return this.sprites.size;
  }

  private texture(b: Building) {
    let t = this.textures.get(b.def.id);
    if (!t) {
      t = new THREE.TextureLoader().load(this.icons.icon(b.def));
      t.colorSpace = THREE.SRGBColorSpace;
      this.textures.set(b.def.id, t);
    }
    return t;
  }

  private sync() {
    const live = new Set<number>();
    for (const b of this.buildings.all) {
      live.add(b.id);
      if (this.sprites.has(b.id)) continue;
      const mat = new THREE.SpriteMaterial({ map: this.texture(b), transparent: true, depthTest: false, sizeAttenuation: false });
      const s = new THREE.Sprite(mat);
      s.renderOrder = 15;
      s.userData.buildingId = b.id;
      s.position.set(b.x, b.padY + b.def.height + 0.6, b.z);
      s.visible = false;
      this.scene.add(s);
      this.sprites.set(b.id, s);
    }
    for (const [id, s] of this.sprites) {
      if (live.has(id)) continue;
      this.scene.remove(s);
      s.material.dispose();
      this.sprites.delete(id);
    }
  }

  update(cameraDistance: number, aspect: number) {
    if (this.buildings.version !== this.lastVersion) {
      this.lastVersion = this.buildings.version;
      this.sync();
    }
    const opacity = StrategicMarkers.opacityAt(cameraDistance);
    for (const [id, s] of this.sprites) {
      const b = this.buildings.get(id);
      s.visible = opacity > 0.02;
      if (!s.visible || !b) continue;
      s.material.opacity = opacity * (b.state === 'complete' ? 1 : 0.6);
      s.scale.set(SCREEN_HEIGHT * (4 / 3), SCREEN_HEIGHT, 1);
      void aspect;
    }
  }

  dispose() {
    for (const s of this.sprites.values()) {
      this.scene.remove(s);
      s.material.dispose();
    }
    this.sprites.clear();
    for (const t of this.textures.values()) t.dispose();
    this.textures.clear();
  }
}
