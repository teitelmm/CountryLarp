import type { Building } from '../buildings/Building';
import type { PortKind } from '../buildings/types';

const fmt = (n: number) => n.toLocaleString('en-US');
export const REFUND_FRACTION = 0.5;

const PORT_COLORS: Record<PortKind, string> = {
  ground: '#f0a03c', rail: '#b9c2cc', sea: '#4aa3e0', air: '#5fe0e6', pipeline: '#e6d04a', power: '#b07cf0',
};
const PORT_LABEL: Record<PortKind, string> = { ground: 'Road', rail: 'Rail', sea: 'Sea lane', air: 'Air link', pipeline: 'Pipeline', power: 'Power line' };
export { PORT_COLORS, PORT_LABEL };

const STATUS: Record<Building['state'], string> = {
  sizing: 'Breaking ground',
  constructing: 'Under construction',
  finishing: 'Finishing touches',
  complete: 'Operational',
  demolishing: 'Being demolished',
};

/** Side panel for the selected building: status, what it provides, its supply ports, and Demolish. */
export class InspectPanel {
  readonly el = document.createElement('div');
  private building: Building | null = null;
  private armed = 0;
  private timer = 0;
  private readonly status: HTMLElement;
  private readonly bar: HTMLElement;
  private readonly button: HTMLButtonElement;
  private readonly title: HTMLElement;

  constructor(private readonly onDemolish: (b: Building) => void) {
    this.el.className = 'inspect';
    this.el.style.display = 'none';
    this.el.innerHTML = `
      <div class="in-head"><span class="in-title"></span><span class="in-cat"></span></div>
      <div class="in-status"></div>
      <div class="in-bar"><i></i></div>
      <div class="in-desc"></div>
      <div class="in-chips"></div>
      <div class="in-meta"></div>
      <div class="in-ports"></div>
      <button class="in-demolish"></button>`;
    this.title = this.el.querySelector('.in-title')!;
    this.status = this.el.querySelector('.in-status')!;
    this.bar = this.el.querySelector('.in-bar i')!;
    this.button = this.el.querySelector('.in-demolish')!;
    this.button.addEventListener('click', () => this.requestDemolish());
    document.body.appendChild(this.el);
  }

  show(b: Building | null) {
    this.building = b;
    this.disarm();
    if (!b) {
      this.el.style.display = 'none';
      return;
    }
    const { def } = b;
    this.title.textContent = def.name;
    (this.el.querySelector('.in-cat') as HTMLElement).textContent = def.category;
    (this.el.querySelector('.in-desc') as HTMLElement).textContent = def.description;
    const chips = this.el.querySelector('.in-chips') as HTMLElement;
    chips.innerHTML = '';
    for (const [k, v] of Object.entries(def.effects)) {
      const c = document.createElement('span');
      c.className = 'chip';
      c.textContent = `${k.replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase())} ${v}`;
      chips.appendChild(c);
    }
    (this.el.querySelector('.in-meta') as HTMLElement).textContent = `${def.footprint.w} × ${def.footprint.d} km · ${def.pieces.length} pieces`;
    const ports = this.el.querySelector('.in-ports') as HTMLElement;
    ports.innerHTML = '';
    const kinds = [...new Set(def.ports.map((p) => p.kind))];
    if (kinds.length) {
      const head = document.createElement('div');
      head.className = 'in-ports-head';
      head.textContent = 'Supply connections';
      ports.appendChild(head);
      for (const k of kinds) {
        const row = document.createElement('span');
        row.className = 'in-port';
        row.innerHTML = `<i style="background:${PORT_COLORS[k]}"></i>${PORT_LABEL[k]}`;
        ports.appendChild(row);
      }
    }
    this.el.style.display = 'block';
    this.refresh();
  }

  /** Update the live parts (status, progress, button label). Cheap enough to call every frame. */
  refresh() {
    const b = this.building;
    if (!b) return;
    const pct = Math.round(b.progress * 100);
    const text = b.state === 'constructing' ? `${STATUS.constructing} · ${pct}%` : STATUS[b.state];
    if (this.status.textContent !== text) this.status.textContent = text;
    this.bar.style.width = `${b.state === 'complete' ? 100 : pct}%`;
    this.el.classList.toggle('done', b.state === 'complete');
    const refund = Math.round(b.def.cost * REFUND_FRACTION);
    const label = this.armed ? `Click again to confirm (+◆ ${fmt(refund)})` : `Demolish (refund ◆ ${fmt(refund)})`;
    if (this.button.textContent !== label) this.button.textContent = label;
    this.button.classList.toggle('armed', !!this.armed);
  }

  /** First call arms the button (3 s); a second call inside that window demolishes. */
  requestDemolish() {
    const b = this.building;
    if (!b) return;
    if (!this.armed) {
      this.armed = 1;
      this.timer = window.setTimeout(() => this.disarm(), 3000);
      this.refresh();
      return;
    }
    this.disarm();
    this.onDemolish(b);
  }

  private disarm() {
    this.armed = 0;
    clearTimeout(this.timer);
    this.refresh();
  }

  dispose() {
    clearTimeout(this.timer);
    this.el.remove();
  }
}
