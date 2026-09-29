import type { CountryIndexEntry } from '../world/CountryData';

/**
 * Start screen: choose a nation to command. Cards show the flag colours and the country's silhouette over
 * a chart of contour lines. (The full country-selection experience, with economy, army and
 * situation briefings, belongs to a later phase.)
 */
export function showCountryPicker(countries: CountryIndexEntry[], onPick: (iso: string) => void): () => void {
  const root = document.createElement('div');
  root.className = 'picker';
  root.innerHTML = `
    <canvas class="picker-contours" aria-hidden="true"></canvas>
    <div class="picker-inner">
      <div class="picker-kicker">Grand strategy · Building phase</div>
      <h1>Country<span>Larp</span></h1>
      <p class="picker-sub">Choose a nation to build for war.</p>
      <div class="picker-grid"></div>
      <div class="picker-foot">Terrain and borders from real elevation data</div>
    </div>`;
  const grid = root.querySelector('.picker-grid')!;
  countries.forEach((c, i) => {
    const card = document.createElement('button');
    card.className = 'picker-card frame';
    card.style.setProperty('--i', String(i));
    const [top, bottom] = c.colors.flag ?? [c.colors.primary, c.colors.secondary];
    card.style.setProperty('--c1', top);
    card.style.setProperty('--c2', bottom);
    card.innerHTML = `
      <span class="flag"><i></i><i></i></span>
      <span class="name">${escapeHtml(c.name)}</span>
      <span class="meta">${c.iso} · ${c.landKm2.toLocaleString('en-US')} km²</span>
      ${outlineSvg(c.outline)}`;
    card.addEventListener('click', () => onPick(c.iso));
    grid.appendChild(card);
  });
  document.body.appendChild(root);

  const canvas = root.querySelector('canvas') as HTMLCanvasElement;
  const paint = () => paintContours(canvas);
  paint();
  addEventListener('resize', paint);
  return () => {
    removeEventListener('resize', paint);
    root.remove();
  };
}

export function showLoading(text: string): () => void {
  const el = document.createElement('div');
  el.className = 'loading';
  el.innerHTML = '<div class="radar" aria-hidden="true"><i></i></div><span></span>';
  (el.querySelector('span') as HTMLElement).textContent = text;
  document.body.appendChild(el);
  return () => el.remove();
}

/** Silhouette as an inline SVG (north up, x east). */
export function outlineSvg(rings?: number[][][]): string {
  if (!rings || rings.length === 0) return '';
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const ring of rings) for (const [x, z] of ring) {
    x0 = Math.min(x0, x); x1 = Math.max(x1, x);
    z0 = Math.min(z0, z); z1 = Math.max(z1, z);
  }
  const pad = Math.max(x1 - x0, z1 - z0) * 0.06;
  const d = rings.map((ring) => `M${ring.map(([x, z]) => `${x},${z}`).join('L')}Z`).join('');
  return `<svg class="outline" viewBox="${x0 - pad} ${z0 - pad} ${x1 - x0 + 2 * pad} ${z1 - z0 + 2 * pad}" preserveAspectRatio="xMidYMid meet" aria-hidden="true"><path d="${d}"/></svg>`;
}

// Marching-squares segments per case (corners TL=8, TR=4, BR=2, BL=1); edges 0 top, 1 right, 2 bottom, 3 left.
const SEGMENTS: Array<Array<[number, number]>> = [
  [], [[3, 2]], [[2, 1]], [[3, 1]], [[0, 1]], [[0, 1], [3, 2]], [[0, 2]], [[0, 3]],
  [[0, 3]], [[0, 2]], [[0, 3], [2, 1]], [[0, 1]], [[3, 1]], [[2, 1]], [[3, 2]], [],
];

/** A smooth pseudo-terrain field, drawn as contour lines: pure decoration, cheap, redrawn on resize. */
function paintContours(canvas: HTMLCanvasElement) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = innerWidth;
  const h = innerHeight;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext('2d')!;
  ctx.scale(dpr, dpr);
  const cell = 14;
  const cols = Math.ceil(w / cell) + 1;
  const rows = Math.ceil(h / cell) + 1;
  const f = (x: number, y: number) => {
    const u = x / 180;
    const v = y / 180;
    return (
      Math.sin(u * 1.3 + Math.sin(v * 0.9) * 1.6) +
      Math.cos(v * 1.1 - u * 0.4 + Math.sin(u * 0.5) * 1.2) +
      0.6 * Math.sin((u + v) * 0.7 + 2) +
      0.35 * Math.sin(u * 3.1 - v * 2.3)
    );
  };
  const field = new Float32Array(cols * rows);
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) field[j * cols + i] = f(i * cell, j * cell);
  ctx.lineWidth = 1;
  for (let level = -2.6; level <= 2.6; level += 0.26) {
    const major = Math.abs(Math.round(level / 0.26) % 5) === 0;
    ctx.strokeStyle = major ? 'rgba(220, 174, 78, 0.16)' : 'rgba(160, 190, 180, 0.075)';
    ctx.beginPath();
    for (let j = 0; j < rows - 1; j++) {
      for (let i = 0; i < cols - 1; i++) {
        const a = field[j * cols + i];
        const b = field[j * cols + i + 1];
        const c = field[(j + 1) * cols + i + 1];
        const d = field[(j + 1) * cols + i];
        const k = (a > level ? 8 : 0) | (b > level ? 4 : 0) | (c > level ? 2 : 0) | (d > level ? 1 : 0);
        for (const [e0, e1] of SEGMENTS[k]) {
          const p = edgePoint(e0, i, j, a, b, c, d, level, cell);
          const q = edgePoint(e1, i, j, a, b, c, d, level, cell);
          ctx.moveTo(p[0], p[1]);
          ctx.lineTo(q[0], q[1]);
        }
      }
    }
    ctx.stroke();
  }
}

function edgePoint(e: number, i: number, j: number, a: number, b: number, c: number, d: number, level: number, cell: number): [number, number] {
  const t = (from: number, to: number) => (level - from) / (to - from);
  const x = i * cell;
  const y = j * cell;
  switch (e) {
    case 0: return [x + t(a, b) * cell, y];
    case 1: return [x + cell, y + t(b, c) * cell];
    case 2: return [x + t(d, c) * cell, y + cell];
    default: return [x, y + t(a, d) * cell];
  }
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
}
