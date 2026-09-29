import type { CountryIndexEntry } from '../world/CountryData';

/**
 * Minimal start screen: pick a country to command. (The full country-selection experience —
 * economy, army and situation briefings — belongs to a later phase.)
 */
export function showCountryPicker(countries: CountryIndexEntry[], onPick: (iso: string) => void): () => void {
  const root = document.createElement('div');
  root.className = 'picker';
  root.innerHTML = `
    <div class="picker-inner">
      <h1>CountryLarp</h1>
      <p class="picker-sub">Choose a nation to build for war.</p>
      <div class="picker-grid"></div>
    </div>`;
  const grid = root.querySelector('.picker-grid')!;
  for (const c of countries) {
    const card = document.createElement('button');
    card.className = 'picker-card';
    const [top, bottom] = c.colors.flag ?? [c.colors.primary, c.colors.secondary];
    card.style.setProperty('--c1', top);
    card.style.setProperty('--c2', bottom);
    card.innerHTML = `
      <span class="flag"><i></i><i></i></span>
      <span class="name">${escapeHtml(c.name)}</span>
      <span class="meta">${c.landKm2.toLocaleString('en-US')} km²</span>`;
    card.addEventListener('click', () => onPick(c.iso));
    grid.appendChild(card);
  }
  document.body.appendChild(root);
  return () => root.remove();
}

export function showLoading(text: string): () => void {
  const el = document.createElement('div');
  el.className = 'loading';
  el.textContent = text;
  document.body.appendChild(el);
  return () => el.remove();
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
}
