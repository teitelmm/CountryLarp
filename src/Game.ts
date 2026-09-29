import type * as THREE from 'three';
import type { RTSCamera } from './camera/RTSCamera';
import { BuildingManager } from './buildings/BuildingManager';
import { Placement } from './buildings/Placement';
import { CONFIG } from './core/config';
import type { Input } from './core/Input';
import { Treasury } from './core/Treasury';
import { BuildMenu } from './ui/BuildMenu';
import { IconRenderer } from './ui/IconRenderer';
import { Toast } from './ui/Toast';
import { TopBar } from './ui/TopBar';
import { Tooltip } from './ui/Tooltip';
import type { CountryData } from './world/CountryData';
import { Territory } from './world/Territory';
import { World } from './world/World';

/** One play session on one country: the world, its buildings, placement and the UI around them. */
export class Game {
  readonly world: World;
  readonly territory: Territory;
  readonly treasury = new Treasury(CONFIG.startingFunds);
  readonly buildings: BuildingManager;
  readonly placement: Placement;
  private readonly topBar: TopBar;
  private readonly menu: BuildMenu;
  private readonly tooltip = new Tooltip();
  private readonly toast = new Toast();
  private readonly icons: IconRenderer;

  constructor(
    readonly data: CountryData,
    readonly renderer: THREE.WebGLRenderer,
    readonly rig: RTSCamera,
    readonly input: Input,
  ) {
    this.world = new World(data);
    this.territory = new Territory(data.meta.borders);
    this.buildings = new BuildingManager(this.world, data.meta.colors);
    this.placement = new Placement({
      world: this.world, rig, input, buildings: this.buildings, treasury: this.treasury,
      territory: this.territory, tooltip: this.tooltip, toast: this.toast,
    });
    this.icons = new IconRenderer(data.meta.colors);
    this.topBar = new TopBar(data.meta, this.treasury);
    this.menu = new BuildMenu(this.placement, this.treasury, this.icons, input);
  }

  update(dt: number, time: number) {
    this.placement.update();
    this.rig.update(dt, this.input);
    this.world.update(time, this.rig, this.renderer);
  }

  render() {
    this.renderer.render(this.world.scene, this.rig.camera);
  }

  dispose() {
    this.placement.dispose();
    this.menu.dispose();
    this.topBar.dispose();
    this.tooltip.dispose();
    this.toast.dispose();
    this.icons.dispose();
    this.world.dispose();
  }
}
