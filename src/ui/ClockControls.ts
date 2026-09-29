import type { GameClock, GameSpeed } from '../core/Clock';
import type { Input } from '../core/Input';

/** Pause and 1x / 2x / 3x buttons for the top bar. Space pauses; + and - change speed. */
export class ClockControls {
  readonly el = document.createElement('div');
  private readonly buttons = new Map<GameSpeed, HTMLButtonElement>();
  private readonly time = document.createElement('span');
  private readonly disposers: Array<() => void> = [];

  constructor(private readonly clock: GameClock, input: Input) {
    this.el.className = 'clock';
    const defs: Array<[GameSpeed, string, string]> = [
      [0, '❚❚', 'Pause (Space)'],
      [1, '▶', 'Normal speed'],
      [2, '▶▶', 'Fast (+)'],
      [3, '▶▶▶', 'Fastest (+)'],
    ];
    for (const [speed, label, title] of defs) {
      const b = document.createElement('button');
      b.className = 'clock-btn';
      b.textContent = label;
      b.title = title;
      b.dataset.speed = String(speed);
      b.addEventListener('click', () => clock.setSpeed(speed));
      this.buttons.set(speed, b);
      this.el.appendChild(b);
    }
    this.time.className = 'clock-time';
    this.el.appendChild(this.time);
    this.disposers.push(
      clock.onChange(() => this.refresh()),
      input.onKey((e) => {
        if (e.ctrl || e.alt) return;
        if (e.code === 'Space') {
          e.preventDefault();
          clock.togglePause();
        } else if (e.code === 'Equal' || e.code === 'NumpadAdd') {
          clock.setSpeed(Math.min(3, Math.max(1, clock.speed + 1)) as GameSpeed);
        } else if (e.code === 'Minus' || e.code === 'NumpadSubtract') {
          clock.setSpeed(Math.max(1, clock.speed - 1) as GameSpeed);
        }
      }),
    );
    this.refresh();
  }

  private refresh() {
    for (const [speed, b] of this.buttons) b.classList.toggle('active', speed === this.clock.speed);
  }

  /** Call every frame (cheap): shows elapsed game time as m:ss. */
  tick() {
    const t = Math.floor(this.clock.time);
    const text = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
    if (this.time.textContent !== text) this.time.textContent = text;
  }

  dispose() {
    for (const d of this.disposers) d();
    this.el.remove();
  }
}
