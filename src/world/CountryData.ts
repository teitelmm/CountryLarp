// Loads a baked country (see scripts/bake-country.mjs): a height/mask data image plus JSON metadata.
//
// World conventions: 1 unit = 1 km, +x east, +z south (north is -z), +y up. The height grid has
// `cols x rows` nodes `cellKm` apart, centred on the origin (node (i, j) is at
// x = (i - (cols-1)/2) * cellKm, z = (j - (rows-1)/2) * cellKm).

export interface CountryColors {
  primary: string;
  secondary: string;
}

export interface CountryMeta {
  iso: string;
  name: string;
  cols: number;
  rows: number;
  cellKm: number;
  hMin: number;
  hMax: number;
  hStep: number;
  zoom: number;
  lon0: number;
  lat0: number;
  colors: CountryColors;
  /** polygons -> rings -> [x, z] in world km. Ring 0 of each polygon is the outer boundary. */
  borders: number[][][][];
  stats: { landCells: number; landKm2: number; maxHeightM: number };
}

export interface CountryIndexEntry {
  iso: string;
  name: string;
  colors: CountryColors;
  landKm2: number;
}

export interface CountryData {
  meta: CountryMeta;
  cols: number;
  rows: number;
  cellKm: number;
  /** Elevation in metres, row-major (j * cols + i). Water is <= 0. */
  heights: Float32Array;
  /** 1 where the node is inside the country's border. */
  mask: Uint8Array;
  /** World extent of the node lattice (km). */
  sizeX: number;
  sizeZ: number;
}

/** Pure decode of the RGBA data image: R,G = 16-bit height (hStep metres above hMin), B = mask. */
export function decodeCountry(meta: CountryMeta, rgba: ArrayLike<number>): CountryData {
  const { cols, rows, hMin, hStep } = meta;
  const n = cols * rows;
  if (rgba.length < n * 4) throw new Error(`Data image too small for ${meta.iso}: ${rgba.length} < ${n * 4}`);
  const heights = new Float32Array(n);
  const mask = new Uint8Array(n);
  for (let k = 0; k < n; k++) {
    heights[k] = hMin + ((rgba[k * 4] << 8) | rgba[k * 4 + 1]) * hStep;
    mask[k] = rgba[k * 4 + 2] > 127 ? 1 : 0;
  }
  return {
    meta,
    cols,
    rows,
    cellKm: meta.cellKm,
    heights,
    mask,
    sizeX: (cols - 1) * meta.cellKm,
    sizeZ: (rows - 1) * meta.cellKm,
  };
}

const dataUrl = (file: string) => `${import.meta.env.BASE_URL}data/countries/${file}`;

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load ${url}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

export function loadCountryIndex(): Promise<CountryIndexEntry[]> {
  return fetchJson<CountryIndexEntry[]>(dataUrl('index.json'));
}

/** Fetch and decode a baked country in the browser. */
export async function loadCountry(iso: string): Promise<CountryData> {
  const id = iso.toLowerCase();
  const [meta, blob] = await Promise.all([
    fetchJson<CountryMeta>(dataUrl(`${id}.json`)),
    fetch(dataUrl(`${id}.png`)).then((r) => {
      if (!r.ok) throw new Error(`Failed to load ${id}.png: HTTP ${r.status}`);
      return r.blob();
    }),
  ]);
  // Colour management and alpha premultiplication must be off or the packed values get altered.
  const bitmap = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  if (canvas.width !== meta.cols || canvas.height !== meta.rows) {
    throw new Error(`${iso}: image is ${canvas.width}x${canvas.height}, metadata says ${meta.cols}x${meta.rows}`);
  }
  return decodeCountry(meta, ctx.getImageData(0, 0, canvas.width, canvas.height).data);
}
