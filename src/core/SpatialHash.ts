import type { Aabb2 } from './obb';

/** Uniform-grid broad phase over the xz-plane: ids are stored in every cell their AABB touches. */
export class SpatialHash {
  private readonly cells = new Map<number, Set<number>>();
  private readonly extents = new Map<number, [number, number, number, number]>();

  constructor(private readonly cellSize = 8) {}

  private key(cx: number, cz: number) {
    return (cx + 32768) * 65536 + (cz + 32768);
  }

  private range(a: Aabb2): [number, number, number, number] {
    const s = this.cellSize;
    return [Math.floor(a.minX / s), Math.floor(a.minZ / s), Math.floor(a.maxX / s), Math.floor(a.maxZ / s)];
  }

  insert(id: number, aabb: Aabb2): void {
    if (this.extents.has(id)) this.remove(id);
    const r = this.range(aabb);
    this.extents.set(id, r);
    for (let cz = r[1]; cz <= r[3]; cz++) {
      for (let cx = r[0]; cx <= r[2]; cx++) {
        const k = this.key(cx, cz);
        let set = this.cells.get(k);
        if (!set) this.cells.set(k, (set = new Set()));
        set.add(id);
      }
    }
  }

  remove(id: number): void {
    const r = this.extents.get(id);
    if (!r) return;
    for (let cz = r[1]; cz <= r[3]; cz++) {
      for (let cx = r[0]; cx <= r[2]; cx++) {
        const k = this.key(cx, cz);
        const set = this.cells.get(k);
        if (set) {
          set.delete(id);
          if (set.size === 0) this.cells.delete(k);
        }
      }
    }
    this.extents.delete(id);
  }

  /** Candidate ids whose cells overlap the AABB (a superset of true overlaps). */
  query(aabb: Aabb2): number[] {
    const r = this.range(aabb);
    const out = new Set<number>();
    for (let cz = r[1]; cz <= r[3]; cz++) {
      for (let cx = r[0]; cx <= r[2]; cx++) {
        const set = this.cells.get(this.key(cx, cz));
        if (set) for (const id of set) out.add(id);
      }
    }
    return [...out];
  }

  get size() {
    return this.extents.size;
  }

  clear(): void {
    this.cells.clear();
    this.extents.clear();
  }
}
