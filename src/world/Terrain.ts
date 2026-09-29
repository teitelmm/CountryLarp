import * as THREE from 'three';
import { CONFIG } from '../core/config';
import type { HeightField } from './HeightField';
import { createTerrainMaterial, createTerrainUniforms, type TerrainUniforms } from './TerrainMaterial';

/** Vertex spacing per LOD, in height-grid cells. 0.5 = twice as dense as the data (bicubic). */
const LOD_STEPS = [0.5, 1, 2, 4, 8];
/** Distance thresholds (in chunk sizes) below which each LOD is used. */
const LOD_DISTANCES = [0.8, 2.2, 4.5, 9];

interface Chunk {
  mesh: THREE.Mesh;
  box: THREE.Box3;
  i0: number;
  j0: number;
  lod: number;
}

/**
 * Chunked, LOD'd terrain. Every chunk is a flat grid displaced in the vertex shader from a shared
 * float height texture, so the geometries are shared per LOD and editing terrain is a small texture
 * upload rather than a mesh rebuild.
 */
export class Terrain {
  readonly group = new THREE.Group();
  readonly uniforms: TerrainUniforms;
  private readonly dataTex: THREE.DataTexture;
  private readonly maskTex: THREE.DataTexture;
  private readonly geometries: THREE.BufferGeometry[];
  private readonly nearMaterial: THREE.MeshLambertMaterial;
  private readonly farMaterial: THREE.MeshLambertMaterial;
  private readonly chunks: Chunk[] = [];
  private readonly chunkSize: number;
  private readonly frustum = new THREE.Frustum();
  private readonly projView = new THREE.Matrix4();
  private uploadedInit = false;

  constructor(private readonly hf: HeightField) {
    const { cols, rows, cell } = hf;
    const cells = CONFIG.chunkCells;
    this.chunkSize = cells * cell;

    // --- data + mask textures ---------------------------------------------------------------
    const data = new Float32Array(cols * rows * 4);
    this.fillRegion(data, 0, 0, cols - 1, rows - 1, cols);
    this.dataTex = new THREE.DataTexture(data, cols, rows, THREE.RGBAFormat, THREE.FloatType);
    this.dataTex.minFilter = this.dataTex.magFilter = THREE.NearestFilter;
    this.dataTex.generateMipmaps = false;
    this.dataTex.needsUpdate = true;

    // The shading mask is blurred so diagonal borders and coasts do not stair-step at cell size.
    // (Gameplay border checks use the exact polygon, not this texture.)
    const mask = blurMask(hf.mask, cols, rows, 2, 2);
    this.maskTex = new THREE.DataTexture(mask, cols, rows, THREE.RedFormat, THREE.UnsignedByteType);
    this.maskTex.minFilter = this.maskTex.magFilter = THREE.LinearFilter;
    this.maskTex.generateMipmaps = false;
    this.maskTex.unpackAlignment = 1; // rows are not a multiple of 4 bytes wide
    this.maskTex.needsUpdate = true;

    this.uniforms = createTerrainUniforms(this.dataTex, this.maskTex, cols, rows, cell, hf.halfX, hf.halfZ, hf.exag);
    this.nearMaterial = createTerrainMaterial(this.uniforms, true);
    this.farMaterial = createTerrainMaterial(this.uniforms, false);
    this.geometries = LOD_STEPS.map((step) => buildChunkGeometry(cells, step, cell));

    // --- chunks -------------------------------------------------------------------------------
    const nx = Math.ceil((cols - 1) / cells);
    const nz = Math.ceil((rows - 1) / cells);
    for (let cj = 0; cj < nz; cj++) {
      for (let ci = 0; ci < nx; ci++) {
        const i0 = ci * cells;
        const j0 = cj * cells;
        const mesh = new THREE.Mesh(this.geometries[LOD_STEPS.length - 1], this.farMaterial);
        mesh.position.set(hf.nodeX(i0), 0, hf.nodeZ(j0));
        mesh.frustumCulled = false; // culled manually: the displaced surface is not in the geometry
        mesh.receiveShadow = true;
        mesh.matrixAutoUpdate = false;
        mesh.updateMatrix();
        const chunk: Chunk = { mesh, box: new THREE.Box3(), i0, j0, lod: LOD_STEPS.length - 1 };
        this.updateChunkBox(chunk);
        this.chunks.push(chunk);
        this.group.add(mesh);
      }
    }
  }

  /** World-space bounds of the whole terrain lattice. */
  get chunkCount() {
    return this.chunks.length;
  }

  /** Recompute a chunk's world box from its height nodes (skirt depth included). */
  private updateChunkBox(chunk: Chunk) {
    const { hf } = this;
    const cells = CONFIG.chunkCells;
    const i1 = Math.min(hf.cols - 1, chunk.i0 + cells);
    const j1 = Math.min(hf.rows - 1, chunk.j0 + cells);
    let lo = Infinity;
    let hi = -Infinity;
    for (let j = chunk.j0; j <= j1; j++) {
      for (let i = chunk.i0; i <= i1; i++) {
        const y = hf.h[j * hf.cols + i];
        if (y < lo) lo = y;
        if (y > hi) hi = y;
      }
    }
    // Bicubic overshoot plus the skirt hanging below.
    const pad = 0.05 * (hi - lo) + 0.05;
    chunk.box.min.set(hf.nodeX(chunk.i0), lo - this.uniforms.uSkirt.value - pad, hf.nodeZ(chunk.j0));
    chunk.box.max.set(hf.nodeX(Math.min(i1, hf.cols - 1)), hi + pad, hf.nodeZ(Math.min(j1, hf.rows - 1)));
  }

  /** Fill an RGBA32F region [i0..i1] x [j0..j1] into `out` (row stride = width of the region). */
  private fillRegion(out: Float32Array, i0: number, j0: number, i1: number, j1: number, stride: number) {
    const { hf } = this;
    const nrm: [number, number] = [0, 0];
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const n = j * hf.cols + i;
        const o = ((j - j0) * stride + (i - i0)) * 4;
        hf.nodeNormalXZ(i, j, nrm);
        out[o] = hf.h[n];
        out[o + 1] = hf.pad[n];
        out[o + 2] = nrm[0];
        out[o + 3] = nrm[1];
      }
    }
  }

  /** Push edited heights to the GPU (partial upload) and refresh affected chunk bounds. */
  applyDirty(renderer: THREE.WebGLRenderer): void {
    const rect = this.hf.takeDirty();
    if (!rect) return;
    const { hf } = this;
    // Normals depend on neighbours, so refresh one node further out.
    const i0 = Math.max(0, rect.i0 - 1);
    const j0 = Math.max(0, rect.j0 - 1);
    const i1 = Math.min(hf.cols - 1, rect.i1 + 1);
    const j1 = Math.min(hf.rows - 1, rect.j1 + 1);
    const w = i1 - i0 + 1;
    const h = j1 - j0 + 1;
    const region = new Float32Array(w * h * 4);
    this.fillRegion(region, i0, j0, i1, j1, w);

    if (!this.uploadedInit) {
      renderer.initTexture(this.dataTex);
      this.uploadedInit = true;
    }
    const src = new THREE.DataTexture(region, w, h, THREE.RGBAFormat, THREE.FloatType);
    src.minFilter = src.magFilter = THREE.NearestFilter;
    src.generateMipmaps = false;
    src.needsUpdate = true;
    renderer.copyTextureToTexture(src, this.dataTex, null, new THREE.Vector2(i0, j0));
    src.dispose();
    // Keep the CPU copy in sync so a context restore or re-upload never resurrects old heights.
    const full = this.dataTex.image.data as Float32Array;
    for (let r = 0; r < h; r++) full.set(region.subarray(r * w * 4, (r + 1) * w * 4), ((j0 + r) * hf.cols + i0) * 4);

    const cells = CONFIG.chunkCells;
    for (const chunk of this.chunks) {
      if (chunk.i0 > i1 || chunk.i0 + cells < i0 || chunk.j0 > j1 || chunk.j0 + cells < j0) continue;
      this.updateChunkBox(chunk);
    }
  }

  /** Per-frame LOD selection and frustum culling. */
  update(camera: THREE.PerspectiveCamera): void {
    this.projView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projView);
    const cam = camera.position;
    const S = this.chunkSize;
    for (const chunk of this.chunks) {
      const visible = this.frustum.intersectsBox(chunk.box);
      chunk.mesh.visible = visible;
      if (!visible) continue;
      const d = chunk.box.distanceToPoint(cam);
      let lod = LOD_DISTANCES.findIndex((k) => d < k * S);
      if (lod < 0) lod = LOD_STEPS.length - 1;
      if (lod !== chunk.lod) {
        chunk.lod = lod;
        chunk.mesh.geometry = this.geometries[lod];
        chunk.mesh.material = lod === 0 ? this.nearMaterial : this.farMaterial;
      }
    }
  }

  /** Show/hide the placement grid overlay around a world point. */
  setGrid(alpha: number, x = 0, z = 0, radius = 6, step: number = CONFIG.gridSnap): void {
    this.uniforms.uGridAlpha.value = alpha;
    this.uniforms.uCursor.value.set(x, z, radius);
    this.uniforms.uGridStep.value = step;
  }

  dispose(): void {
    this.dataTex.dispose();
    this.maskTex.dispose();
    for (const g of this.geometries) g.dispose();
    this.nearMaterial.dispose();
    this.farMaterial.dispose();
  }
}

/**
 * A (n+3) x (n+3) vertex grid over [0, size]^2 in xz. The outermost ring duplicates the edge
 * positions with position.y = 1 (skirt flag): the vertex shader drops those, hiding LOD cracks.
 * Real heights come from the height texture, so position.y is free to carry that flag.
 */
export function buildChunkGeometry(cells: number, step: number, cell: number): THREE.BufferGeometry {
  const n = Math.max(1, Math.round(cells / step));
  const size = cells * cell;
  const w = n + 3;
  const pos = new Float32Array(w * w * 3);
  const nor = new Float32Array(w * w * 3);
  for (let jy = 0; jy < w; jy++) {
    for (let ix = 0; ix < w; ix++) {
      const k = (jy * w + ix) * 3;
      const gx = Math.min(n, Math.max(0, ix - 1));
      const gz = Math.min(n, Math.max(0, jy - 1));
      const skirt = ix === 0 || jy === 0 || ix === w - 1 || jy === w - 1 ? 1 : 0;
      pos[k] = (gx / n) * size;
      pos[k + 1] = skirt;
      pos[k + 2] = (gz / n) * size;
      nor[k + 1] = 1;
    }
  }
  const index = new Uint32Array((w - 1) * (w - 1) * 6);
  let o = 0;
  for (let jy = 0; jy < w - 1; jy++) {
    for (let ix = 0; ix < w - 1; ix++) {
      const a = jy * w + ix;
      const b = a + w;
      const c = a + 1;
      const d = b + 1;
      index[o++] = a; index[o++] = b; index[o++] = c;
      index[o++] = b; index[o++] = d; index[o++] = c;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setIndex(new THREE.BufferAttribute(index, 1));
  return g;
}

/** Separable box blur of a binary mask into 0..255 bytes. */
export function blurMask(mask: Uint8Array, cols: number, rows: number, radius: number, passes: number): Uint8Array {
  let a = new Float32Array(cols * rows);
  for (let n = 0; n < a.length; n++) a[n] = mask[n] ? 1 : 0;
  let b = new Float32Array(a.length);
  const norm = 1 / (2 * radius + 1);
  for (let pass = 0; pass < passes; pass++) {
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        let sum = 0;
        for (let k = -radius; k <= radius; k++) sum += a[j * cols + Math.min(cols - 1, Math.max(0, i + k))];
        b[j * cols + i] = sum * norm;
      }
    }
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        let sum = 0;
        for (let k = -radius; k <= radius; k++) sum += b[Math.min(rows - 1, Math.max(0, j + k)) * cols + i];
        a[j * cols + i] = sum * norm;
      }
    }
  }
  const out = new Uint8Array(a.length);
  for (let n = 0; n < a.length; n++) out[n] = Math.round(Math.min(1, Math.max(0, a[n])) * 255);
  return out;
}
