import { CATALOG } from '../buildings/catalog';
import { CATEGORIES } from '../buildings/types';
import { IconRenderer } from '../ui/IconRenderer';
import type { CountryColors } from '../world/CountryData';

/** Dev-only contact sheet of every building (`/?sheet` or `/?sheet=ISO-colours`). */
export function showSheet(colors: CountryColors, only?: string[]) {
  document.body.innerHTML = '';
  document.body.style.overflow = 'auto';
  const wrap = document.createElement('div');
  wrap.style.cssText = 'padding:16px;display:grid;grid-template-columns:repeat(auto-fill,minmax(360px,1fr));gap:12px;background:#1a2433;min-height:100vh;box-sizing:border-box';
  document.body.appendChild(wrap);
  const icons = new IconRenderer(colors, 360, 270);
  for (const cat of CATEGORIES) {
    for (const def of CATALOG.filter((d) => d.category === cat.id && (!only || only.includes(d.id)))) {
      const card = document.createElement('figure');
      card.style.cssText = 'margin:0;background:#243248;border-radius:10px;padding:8px;color:#dfe8f5;font:13px system-ui';
      const img = new Image();
      img.src = icons.icon(def);
      img.style.cssText = 'width:100%;display:block';
      const cap = document.createElement('figcaption');
      cap.textContent = `${def.name} — ${def.footprint.w}×${def.footprint.d}, h ${def.height}, ${def.pieces.length} pieces`;
      card.append(img, cap);
      wrap.appendChild(card);
    }
  }
  (window as unknown as { __sheetDone: boolean }).__sheetDone = true;
}
