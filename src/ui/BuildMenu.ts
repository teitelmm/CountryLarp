import { CATALOG } from '../buildings/catalog';
import type { Placement } from '../buildings/Placement';
import { CATEGORIES, type BuildingDef, type Category } from '../buildings/types';
import { CONFIG } from '../core/config';
import type { Input } from '../core/Input';
import type { Treasury } from '../core/Treasury';
import { categoryGlyph } from './glyphs';
import type { IconRenderer } from './IconRenderer';

const fmt = (n: number) => n.toLocaleString('en-US');
/** Footprints are authored in world units; show real kilometres so they agree with the map's scale bar. */
const realKm = (units: number) => Math.round(units * CONFIG.mapScale);
const EFFECT_LABEL: Record<string, string> = {
  health: 'Health', morale: 'Morale', industry: 'Industry', militaryIndustry: 'Arms production', jobs: 'Jobs', power: 'Power',
  pollution: 'Pollution', fuel: 'Fuel', housing: 'Housing', food: 'Food', research: 'Research', stability: 'Stability',
  recruits: 'Recruits', officers: 'Officers', doctrine: 'Doctrine', airCapacity: 'Air capacity', navalCapacity: 'Naval capacity',
  supplyHub: 'Supply hub', detection: 'Detection', defense: 'Defence', garrison: 'Garrison', supplyRange: 'Supply range',
  storage: 'Storage', tradeCapacity: 'Trade', mobile: 'Deployable',
};

/** The bottom toolbar: category tabs, building cards with icons, and an info panel on hover. */
export class BuildMenu {
  readonly el = document.createElement('div');
  private readonly tabs = document.createElement('div');
  private readonly cards = document.createElement('div');
  private readonly info = document.createElement('div');
  private category: Category = 'medical';
  private readonly cardEls = new Map<string, HTMLButtonElement>();
  private readonly disposers: Array<() => void> = [];

  constructor(
    private readonly placement: Placement,
    private readonly treasury: Treasury,
    private readonly icons: IconRenderer,
    input: Input,
  ) {
    this.el.className = 'buildbar';
    this.tabs.className = 'bb-tabs';
    this.cards.className = 'bb-cards';
    this.info.className = 'bb-info';
    this.info.style.display = 'none';
    this.el.append(this.info, this.tabs, this.cards);

    for (const c of CATEGORIES) {
      const tab = document.createElement('button');
      tab.className = 'bb-tab';
      tab.dataset.category = c.id;
      tab.innerHTML = `${categoryGlyph(c.id)}<span></span>`;
      (tab.lastElementChild as HTMLElement).textContent = c.label;
      tab.title = c.blurb;
      tab.addEventListener('click', () => this.setCategory(c.id));
      this.tabs.appendChild(tab);
    }

    this.disposers.push(
      placement.onActiveChange(() => this.refresh()),
      treasury.onChange(() => this.refresh()),
      input.onKey((e) => {
        if (e.ctrl || e.alt) return;
        if (e.code === 'BracketRight' || e.code === 'BracketLeft') {
          const i = CATEGORIES.findIndex((c) => c.id === this.category);
          this.setCategory(CATEGORIES[(i + (e.code === 'BracketRight' ? 1 : CATEGORIES.length - 1)) % CATEGORIES.length].id);
        }
        const m = /^Digit([1-9])$/.exec(e.code);
        if (m) {
          const list = CATALOG.filter((d) => d.category === this.category);
          const def = list[Number(m[1]) - 1];
          if (def) this.pick(def);
        }
      }),
    );
    this.setCategory('medical');
    document.body.appendChild(this.el);
  }

  private pick(def: BuildingDef) {
    if (this.placement.active?.id === def.id) this.placement.cancel();
    else this.placement.start(def);
  }

  setCategory(category: Category) {
    this.category = category;
    this.cards.innerHTML = '';
    this.cardEls.clear();
    const list = CATALOG.filter((d) => d.category === category);
    list.forEach((def, i) => {
      const card = document.createElement('button');
      card.className = 'bb-card';
      card.dataset.building = def.id;
      const img = new Image();
      img.alt = '';
      img.src = this.icons.icon(def);
      img.draggable = false;
      const key = document.createElement('span');
      key.className = 'bb-key';
      key.textContent = String(i + 1);
      const name = document.createElement('span');
      name.className = 'bb-name';
      name.textContent = def.name;
      const cost = document.createElement('span');
      cost.className = 'bb-cost';
      cost.textContent = `◆ ${fmt(def.cost)}`;
      card.append(key, img, name, cost);
      if (def.wartime) {
        const badge = document.createElement('span');
        badge.className = 'bb-war';
        badge.title = 'Wartime building';
        badge.textContent = 'WAR';
        card.appendChild(badge);
      }
      card.addEventListener('click', () => this.pick(def));
      card.addEventListener('mouseenter', () => this.showInfo(def));
      card.addEventListener('mouseleave', () => this.hideInfo());
      card.addEventListener('focus', () => this.showInfo(def));
      card.addEventListener('blur', () => this.hideInfo());
      this.cards.appendChild(card);
      this.cardEls.set(def.id, card);
    });
    this.refresh();
  }

  /** Reflect the active category, selected building and affordability. */
  private refresh() {
    for (const tab of this.tabs.children) tab.classList.toggle('active', (tab as HTMLElement).dataset.category === this.category);
    for (const [id, card] of this.cardEls) {
      const def = CATALOG.find((d) => d.id === id)!;
      card.classList.toggle('selected', this.placement.active?.id === id);
      card.classList.toggle('poor', !this.treasury.canAfford(def.cost));
    }
  }

  private showInfo(def: BuildingDef) {
    const p = def.placement;
    const reqs: string[] = [`Ground ≤ ${p.maxSlopeDeg}° slope`];
    if (p.needsCoast) reqs.push('Coastline');
    if (p.minElevationM) reqs.push(`≥ ${p.minElevationM} m elevation`);
    reqs.push('Inside your borders');
    const effects = Object.entries(def.effects)
      .map(([k, v]) => `<span class="chip">${EFFECT_LABEL[k] ?? k} <b>${v > 0 && k !== 'mobile' && k !== 'supplyHub' ? '+' : ''}${v}</b></span>`)
      .join('');
    this.info.innerHTML = `
      <div class="bi-head"><span class="bi-name"></span>${def.wartime ? '<span class="bb-war">WAR</span>' : ''}</div>
      <div class="bi-desc"></div>
      <div class="bi-stats">
        <span>Cost <b>◆ ${fmt(def.cost)}</b></span>
        <span>Build time <b>${def.buildTime}s</b></span>
        <span>Size <b>${realKm(def.footprint.w)} × ${realKm(def.footprint.d)} km</b></span>
      </div>
      <div class="bi-chips">${effects}</div>
      <div class="bi-req">Needs: ${reqs.join(' · ')}</div>`;
    (this.info.querySelector('.bi-name') as HTMLElement).textContent = def.name;
    (this.info.querySelector('.bi-desc') as HTMLElement).textContent = def.description;
    this.info.style.display = 'block';
  }

  private hideInfo() {
    this.info.style.display = 'none';
  }

  dispose() {
    for (const d of this.disposers) d();
    this.el.remove();
  }
}
