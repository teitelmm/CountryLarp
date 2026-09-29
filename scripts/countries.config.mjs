// Per-country baking config. Keyed by Natural Earth ADM0_A3 (NOT ISO_A3, which is "-99" for France/Norway).
//   keepBox  [minLon, minLat, maxLon, maxLat] - polygons whose centre is outside are dropped
//            (overseas territories would otherwise blow up the map extent).
//   colors   primary/secondary tint roofs and banners; optional flag: [top, bottom] sets the picker swatch.
//   source   border dataset (key of BORDER_SOURCES in bake-country.mjs); default 'ne50m'.
//            Natural Earth's default file follows a de-facto view of disputed areas, so a country
//            can opt into a point-of-view file that follows internationally recognised borders.
export const COUNTRIES = {
  POL: { keepBox: null, colors: { primary: '#dc143c', secondary: '#f2f2f2', flag: ['#f2f2f2', '#dc143c'] } },
  DEU: { keepBox: null, colors: { primary: '#3b3b3b', secondary: '#dd0000' } },
  FRA: { keepBox: [-5.5, 41.2, 9.8, 51.3], colors: { primary: '#0055a4', secondary: '#ef4135' } }, // mainland + Corsica
  GBR: { keepBox: [-8.7, 49.8, 2.0, 60.9], colors: { primary: '#012169', secondary: '#c8102e' } },
  ITA: { keepBox: null, colors: { primary: '#009246', secondary: '#ce2b37' } },
  // Internationally recognised borders (includes Crimea); NE's default file assigns it to Russia.
  UKR: { keepBox: null, source: 'ne10m_ukr', colors: { primary: '#0057b7', secondary: '#ffd700' } },
  // Bakeable extras (not shipped in the starter set):
  ESP: { keepBox: [-9.6, 35.9, 4.4, 43.9], colors: { primary: '#aa151b', secondary: '#f1bf00' } }, // drops the Canaries
  JPN: { keepBox: [122.9, 24.0, 146.0, 46.0], colors: { primary: '#bc002d', secondary: '#f2f2f2' } },
  TUR: { keepBox: null, colors: { primary: '#e30a17', secondary: '#f2f2f2' } },
};

export const DEFAULT_COLORS = { primary: '#6b7a8f', secondary: '#d9dee5' };

/** Countries baked into the repo by default. */
export const STARTER_SET = ['POL', 'DEU', 'FRA', 'GBR', 'ITA', 'UKR'];
