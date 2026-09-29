import type { Treasury } from '../core/Treasury';
import type { CountryMeta } from '../world/CountryData';

/** Country badge on the left and the treasury on the right. (Time controls join in with the game clock.) */
export class TopBar {
  readonly el = document.createElement('div');
  private readonly funds: HTMLElement;
  private readonly center: HTMLElement;
  private unsub: () => void;

  constructor(meta: CountryMeta, treasury: Treasury, onNewGame?: () => void) {
    this.el.className = 'topbar';
    const [top, bottom] = meta.colors.flag ?? [meta.colors.primary, meta.colors.secondary];
    this.el.innerHTML = `
      <div class="tb-country">
        <span class="flag" style="--c1:${top};--c2:${bottom}"><i></i><i></i></span>
        <span class="tb-name"></span>
      </div>
      <div class="tb-center"></div>
      <div class="tb-right">
        <button class="tb-new" title="Abandon this game and choose again">New game</button>
        <div class="tb-funds" title="Treasury"><span class="coin">◆</span><span class="tb-funds-value"></span></div>
      </div>`;
    (this.el.querySelector('.tb-name') as HTMLElement).textContent = meta.name;
    this.funds = this.el.querySelector('.tb-funds-value')!;
    (this.el.querySelector('.tb-new') as HTMLButtonElement).addEventListener('click', () => onNewGame?.());
    this.center = this.el.querySelector('.tb-center')!;
    const render = (v: number) => (this.funds.textContent = Math.floor(v).toLocaleString('en-US'));
    render(treasury.funds);
    this.unsub = treasury.onChange((v) => {
      render(v);
      const box = this.funds.parentElement!;
      box.classList.remove('bump');
      void box.offsetWidth; // restart the animation
      box.classList.add('bump');
    });
    document.body.appendChild(this.el);
  }

  /** Mount extra controls (e.g. the clock) in the middle of the bar. */
  get centerSlot() {
    return this.center;
  }

  dispose() {
    this.unsub();
    this.el.remove();
  }
}
