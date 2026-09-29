import * as THREE from 'three';
import type { RTSCamera } from './camera/RTSCamera';
import { BuildingManager } from './buildings/BuildingManager';
import { getDef, hasDef } from './buildings/catalog';
import type { Building } from './buildings/Building';
import { Placement } from './buildings/Placement';
import { PortsOverlay } from './buildings/PortsOverlay';
import { Selection } from './buildings/Selection';
import { StrategicMarkers } from './buildings/StrategicMarkers';
import { FIXED_DT, GameClock } from './core/Clock';
import { CONFIG } from './core/config';
import type { Input } from './core/Input';
import { clearSave, encode, readSave, writeSave, type SaveData } from './core/Save';
import { Treasury } from './core/Treasury';
import { Dust } from './fx/Dust';
import { loadRapier, PhysicsWorld } from './physics/PhysicsWorld';
import { BuildMenu } from './ui/BuildMenu';
import { ClockControls } from './ui/ClockControls';
import { IconRenderer } from './ui/IconRenderer';
import { MapCard } from './ui/MapCard';
import { InspectPanel, REFUND_FRACTION } from './ui/InspectPanel';
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
  readonly toast = new Toast();
  private readonly icons: IconRenderer;
  readonly selection: Selection;
  private readonly inspect: InspectPanel;
  readonly markers: StrategicMarkers;
  readonly ports: PortsOverlay;
  private readonly mapCard: MapCard;
  private readonly drawingSize = new THREE.Vector2();
  private dirty = false;
  private saveTimer = 0;
  private readonly disposers: Array<() => void> = [];

  /** Create a session (loads the physics engine first). */
  static async create(data: CountryData, renderer: THREE.WebGLRenderer, rig: RTSCamera, input: Input, opts: { fresh?: boolean } = {}) {
    const rapier = await loadRapier();
    const game = new Game(data, renderer, rig, input, new PhysicsWorld(rapier));
    if (opts.fresh) clearSave(data.meta.iso);
    else {
      const save = readSave(data.meta.iso, hasDef);
      if (save && save.buildings.length > 0) {
        game.restore(save);
        game.toast.show(`Restored ${save.buildings.length} building${save.buildings.length === 1 ? '' : 's'}`, 'info', 2500);
      }
    }
    return game;
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
    this.territory = new Territory(data.borders);
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
    this.topBar = new TopBar(data.meta, this.treasury, () => this.newGame());
    this.clockControls = new ClockControls(this.clock, input);
    this.topBar.centerSlot.appendChild(this.clockControls.el);
    this.menu = new BuildMenu(this.placement, this.treasury, this.icons, input);

    this.selection = new Selection(this.world.scene, rig, input, this.buildings, this.placement);
    this.inspect = new InspectPanel((b) => this.demolish(b));
    this.selection.onChange((b) => this.inspect.show(b));
    this.markers = new StrategicMarkers(this.world.scene, this.buildings, this.icons);
    this.ports = new PortsOverlay(this.world.scene, this.buildings);
    this.mapCard = new MapCard(data, this.world.hf, rig, this.buildings);

    this.disposers.push(
      input.onKey((e) => {
        if (e.ctrl || e.alt) return;
        if (e.code === 'KeyP') this.ports.toggle();
        else if ((e.code === 'Delete' || e.code === 'Backspace') && this.selection.selected) {
          e.preventDefault();
          this.inspect.requestDemolish();
        }
      }),
      this.buildings.onChange(() => (this.dirty = true)),
      this.buildings.onComplete(() => (this.dirty = true)),
    );
    // Persist on the way out (closing the tab, switching away).
    const flush = () => this.save();
    const onHide = () => document.visibilityState === 'hidden' && this.save();
    addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onHide);
    this.disposers.push(() => {
      removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onHide);
    });
  }

  // --- save / restore ------------------------------------------------------------------------------

  serialize(): SaveData {
    return encode(this.data.meta.iso, this.treasury.funds, this.buildings.all);
  }

  save() {
    writeSave(this.serialize());
    this.dirty = false;
  }

  /** Rebuild buildings from a save: finished ones appear at once, unfinished ones resume where they were. */
  restore(data: SaveData) {
    this.treasury.set(data.funds);
    for (const sb of data.buildings) {
      const def = getDef(sb.def);
      const b = this.buildings.place(def, sb.x, sb.z, sb.rot, sb.padY, { instant: sb.complete });
      if (!sb.complete && b.site) b.site.fastForward(sb.elapsed);
    }
    this.dust.clear(); // dust from the skipped construction time
    this.dirty = false;
  }

  /** Demolish with a partial refund. */
  demolish(b: Building) {
    const refund = Math.round(b.def.cost * REFUND_FRACTION);
    if (this.buildings.demolish(b.id)) {
      this.treasury.add(refund);
      this.toast.show(`${b.def.name} demolished (+◆ ${refund.toLocaleString('en-US')})`, 'info');
    }
  }

  private newGame() {
    if (!confirm('Abandon this game and start over? Your buildings will be lost.')) return;
    clearSave(this.data.meta.iso);
    location.href = location.pathname;
  }

  /** Advance the simulation by one fixed step of game time. */
  simulate(dt: number = FIXED_DT) {
    if (this.buildings.busy) {
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
    this.mapCard.update();
    this.world.update(time, this.rig, this.renderer);
    this.renderer.getDrawingBufferSize(this.drawingSize);
    this.dust.setPixelScale(this.drawingSize.y, this.rig.camera.fov);
    this.buildings.updateVisuals(this.rig.camera.quaternion, this.rig.distance);
    this.markers.update(this.rig.distance, this.rig.camera.aspect);
    this.ports.update(this.rig.distance);
    this.selection.update(time);
    if (this.selection.selected) this.inspect.refresh();
    this.clockControls.tick();
    // Autosave shortly after anything changes.
    this.saveTimer += realDt;
    if (this.dirty && this.saveTimer > 1.5) {
      this.saveTimer = 0;
      this.save();
    }
  }

  render() {
    this.renderer.render(this.world.scene, this.rig.camera);
  }

  dispose() {
    this.save();
    for (const d of this.disposers) d();
    this.selection.dispose();
    this.inspect.dispose();
    this.markers.dispose();
    this.ports.dispose();
    this.mapCard.dispose();
    this.placement.dispose();
    this.buildings.dispose();
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
