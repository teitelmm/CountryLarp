/** Fixed simulation step, in game seconds. */
export const FIXED_DT = 1 / 60;

export type GameSpeed = 0 | 1 | 2 | 3;

/**
 * The game clock: pause and 1x/2x/3x speed (Hearts-of-Iron style). Real frame time is turned into a
 * whole number of fixed simulation steps, so physics and animations are deterministic and a slow
 * frame never makes the simulation take a giant step.
 */
export class GameClock {
  private _speed: GameSpeed = 1;
  private lastRunning: Exclude<GameSpeed, 0> = 1;
  private acc = 0;
  private _time = 0;
  private listeners = new Set<() => void>();

  /** Longest real frame time we honour (seconds); beyond this the game simply runs slow. */
  static readonly MAX_FRAME = 0.1;
  /** Hard cap on simulation steps per rendered frame. */
  static readonly MAX_STEPS = 24;

  get speed(): GameSpeed {
    return this._speed;
  }
  get paused() {
    return this._speed === 0;
  }
  /** Elapsed game time, seconds. */
  get time() {
    return this._time;
  }

  setSpeed(speed: GameSpeed) {
    if (speed === this._speed) return;
    if (speed !== 0) this.lastRunning = speed;
    this._speed = speed;
    this.emit();
  }

  togglePause() {
    this.setSpeed(this._speed === 0 ? this.lastRunning : 0);
  }

  /** Real seconds elapsed -> number of fixed steps to simulate now (0 when paused). */
  consume(realDt: number): number {
    if (this._speed === 0) return 0;
    this.acc += Math.min(realDt, GameClock.MAX_FRAME) * this._speed;
    // The epsilon keeps an exact-boundary accumulation (0.5 + 0.5 of a step) from flooring to zero.
    const steps = Math.min(GameClock.MAX_STEPS, Math.floor(this.acc / FIXED_DT + 1e-9));
    this.acc = Math.max(0, this.acc - steps * FIXED_DT);
    if (this.acc > FIXED_DT * GameClock.MAX_STEPS) this.acc = 0; // drop a backlog rather than spiral
    this._time += steps * FIXED_DT;
    return steps;
  }

  /** Advance game time by hand (tests / debug fast-forward); returns the number of steps. */
  advance(seconds: number): number {
    const steps = Math.round(seconds / FIXED_DT);
    this._time += steps * FIXED_DT;
    return steps;
  }

  onChange(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    for (const fn of this.listeners) fn();
  }
}
