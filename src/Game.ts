import * as THREE from 'three';
import type { RTSCamera } from './camera/RTSCamera';
import { BuildingManager } from './buildings/BuildingManager';
import { Placement } from './buildings/Placement';
import { FIXED_DT, GameClock } from './core/Clock';
import { CONFIG } from './core/config';
import type { Input } from './core/Input';
import { Treasury } from './core/Treasury';
import { Dust } from './fx/Dust';
import { loadRapier, PhysicsWorld } from './physics/PhysicsWorld';
import { BuildMenu } from './ui/BuildMenu';
import { ClockControls } from './ui/ClockControls';
import { IconRenderer } from './ui/IconRenderer';
import { Toast } from './ui/Toast';
import { TopBar } from './ui/TopBar';
import { Tooltip } from './ui/Tooltip';
import type { CountryData } from './world/CountryData';
import { Territory } from './world/Territory';
import { World } from './world/World';

/**
 * One play session on one country: the world, its buildings, placement and the UI around them.
 *
 * The simulation (construction timelines and physics) advances in fixed game-time steps via `simulate`,
 * independent of rendering, so it is deterministic, pausable, speed-scalable and testable.
 */
export class Game {
  readonly world: World;
  readonly territory: Territory;
  readonly clock = new GameClock();
  readonly treasury = new Treasury(CONFIG.startingFunds);
  readonly dust = new Dust();
  readonly buildings: BuildingManager;
  readonly placement: Placement;
  private readonly topBar: TopBar;
  private readonly clockControls: ClockControls;
  private readonly menu: BuildMenu;
  private readonly tooltip = new Tooltip();
  private readonly toast = new Toast();
  private readonly icons: IconRenderer;
  private readonly drawingSize = new THREE.Vector2();

  /** Create a session (loads the physics engine first). */
  static async create(data: CountryData, renderer: THREE.WebGLRenderer, rig: RTSCamera, input: Input) {
    const rapier = await loadRapier();
    return new Game(data, renderer, rig, input, new PhysicsWorld(rapier));
  }

  private constructor(
    readonly data: CountryData,
    readonly renderer: THREE.WebGLRenderer,
    readonly rig: RTSCamera,
    readonly input: Input,
    readonly physics: PhysicsWorld,
  ) {
    this.world = new World(data);
    this.world.scene.add(this.dust.points);
    this.territory = new Territory(data.meta.borders);
    this.buildings = new BuildingManager(this.world, data.meta.colors, {
      physics,
      dust: this.dust,
      cameraPosition: () => rig.camera.position,
    });
    this.placement = new Placement({
      world: this.world, rig, input, buildings: this.buildings, treasury: this.treasury,
      territory: this.territory, tooltip: this.tooltip, toast: this.toast,
    });
    this.icons = new IconRenderer(data.meta.colors);
    this.topBar = new TopBar(data.meta, this.treasury);
    this.clockControls = new ClockControls(this.clock, input);
    this.topBar.centerSlot.appendChild(this.clockControls.el);
    this.menu = new BuildMenu(this.placement, this.treasury, this.icons, input);
  }

  /** Advance the simulation by one fixed step of game time. */
  simulate(dt: number = FIXED_DT) {
    if (this.buildings.activeSites > 0) {
      this.buildings.preStep(dt);
      this.physics.step();
      this.buildings.postStep(dt);
    }
    this.dust.update(dt);
  }

  /** Fast-forward `seconds` of game time without rendering (tests and debugging). */
  advance(seconds: number) {
    const steps = this.clock.advance(seconds);
    for (let i = 0; i < steps; i++) this.simulate(FIXED_DT);
  }

  /** One rendered frame: simulate the steps the clock allows, then update camera, world and UI. */
  update(realDt: number, time: number) {
    const steps = this.clock.consume(realDt);
    for (let i = 0; i < steps; i++) this.simulate(FIXED_DT);
    this.placement.update();
    this.rig.update(realDt, this.input);
    this.world.update(time, this.rig, this.renderer);
    this.renderer.getDrawingBufferSize(this.drawingSize);
    this.dust.setPixelScale(this.drawingSize.y, this.rig.camera.fov);
    this.buildings.updateVisuals(this.rig.camera.quaternion, this.rig.distance);
    this.clockControls.tick();
  }

  render() {
    this.renderer.render(this.world.scene, this.rig.camera);
  }

  dispose() {
    this.placement.dispose();
    this.menu.dispose();
    this.clockControls.dispose();
    this.topBar.dispose();
    this.tooltip.dispose();
    this.toast.dispose();
    this.icons.dispose();
    this.dust.dispose();
    this.world.dispose();
    this.physics.dispose();
  }
}
