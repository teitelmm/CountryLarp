/** A small floating panel that follows the cursor (placement feedback). */
export class Tooltip {
  private readonly el = document.createElement('div');

  constructor() {
    this.el.className = 'tip';
    this.el.style.display = 'none';
    document.body.appendChild(this.el);
  }

  /** `problems` render as red bullets; `hints` as a muted footer. */
  show(clientX: number, clientY: number, title: string, problems: string[], hints: string) {
    const el = this.el;
    el.innerHTML = '';
    const t = document.createElement('div');
    t.className = 'tip-title';
    t.textContent = title;
    el.appendChild(t);
    for (const p of problems) {
      const row = document.createElement('div');
      row.className = 'tip-problem';
      row.textContent = p;
      el.appendChild(row);
    }
    if (hints) {
      const h = document.createElement('div');
      h.className = 'tip-hint';
      h.textContent = hints;
      el.appendChild(h);
    }
    el.classList.toggle('bad', problems.length > 0);
    el.style.display = 'block';
    // Keep it inside the window, offset from the cursor.
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const x = Math.min(clientX + 18, innerWidth - w - 8);
    const y = Math.min(clientY + 18, innerHeight - h - 8);
    el.style.transform = `translate(${Math.max(8, x)}px, ${Math.max(8, y)}px)`;
  }

  hide() {
    this.el.style.display = 'none';
  }

  dispose() {
    this.el.remove();
  }
}
