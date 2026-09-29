import type { Category } from '../buildings/types';

/** Line glyphs for the build-bar category tabs (20x20 grid, drawn with currentColor). */
const PATHS: Record<Category, string> = {
  medical: '<circle cx="10" cy="10" r="7.6"/><path d="M10 6.2v7.6M6.2 10h7.6"/>',
  industry: '<path d="M2.5 17.5V10l5 3v-3l5 3V4.5h3v13z"/><path d="M5 15.2h1M9.5 15.2h1M13.2 8h.8"/>',
  civic: '<path d="M2.5 8 10 3l7.5 5M4.5 8.6v7.4M8.2 8.6v7.4M11.8 8.6v7.4M15.5 8.6v7.4M2.5 17h15"/>',
  military: '<path d="M3.5 11.5 10 5l6.5 6.5M3.5 16.5 10 10l6.5 6.5"/>',
  logistics: '<path d="M3 6.6 10 3l7 3.6v6.8L10 17l-7-3.6zM3 6.6l7 3.6 7-3.6M10 10.2V17"/>',
};

export function categoryGlyph(category: Category): string {
  return `<svg class="glyph" viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[category]}</svg>`;
}
