// Oriented rectangles on the ground plane (xz). One place defines the rotation convention so the
// building model, terrain grading, overlap tests and picking can never disagree.
//
// `rot` is THREE.Object3D.rotation.y: a positive rotation carries local +x towards world -z, so
//   local +x axis in world = ( cos rot, -sin rot )
//   local +z axis in world = ( sin rot,  cos rot )

export interface Obb {
  cx: number;
  cz: number;
  /** Half extents along the local x and z axes. */
  hw: number;
  hd: number;
  rot: number;
}

export interface Aabb2 {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/** Local -> world offset for a rotation. */
export function rotateOffset(lx: number, lz: number, rot: number): [number, number] {
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  return [c * lx + s * lz, -s * lx + c * lz];
}

/** World offset -> local (inverse of rotateOffset). */
export function unrotateOffset(dx: number, dz: number, rot: number): [number, number] {
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  return [c * dx - s * dz, s * dx + c * dz];
}

export function obbToWorld(o: Obb, lx: number, lz: number): [number, number] {
  const [dx, dz] = rotateOffset(lx, lz, o.rot);
  return [o.cx + dx, o.cz + dz];
}

export function obbToLocal(o: Obb, x: number, z: number): [number, number] {
  return unrotateOffset(x - o.cx, z - o.cz, o.rot);
}

export function obbCorners(o: Obb): Array<[number, number]> {
  return [
    obbToWorld(o, -o.hw, -o.hd),
    obbToWorld(o, o.hw, -o.hd),
    obbToWorld(o, o.hw, o.hd),
    obbToWorld(o, -o.hw, o.hd),
  ];
}

export function obbAabb(o: Obb, margin = 0): Aabb2 {
  const c = Math.abs(Math.cos(o.rot));
  const s = Math.abs(Math.sin(o.rot));
  const ex = c * o.hw + s * o.hd + margin;
  const ez = s * o.hw + c * o.hd + margin;
  return { minX: o.cx - ex, maxX: o.cx + ex, minZ: o.cz - ez, maxZ: o.cz + ez };
}

export function obbContains(o: Obb, x: number, z: number, margin = 0): boolean {
  const [lx, lz] = obbToLocal(o, x, z);
  return Math.abs(lx) <= o.hw + margin && Math.abs(lz) <= o.hd + margin;
}

/**
 * Do two oriented rectangles overlap or come within `margin` of each other? Separating-axis test
 * on the four edge normals; `margin` is the minimum clear gap required between them.
 */
export function obbOverlap(a: Obb, b: Obb, margin = 0): boolean {
  const axes: Array<[number, number]> = [
    [Math.cos(a.rot), -Math.sin(a.rot)],
    [Math.sin(a.rot), Math.cos(a.rot)],
    [Math.cos(b.rot), -Math.sin(b.rot)],
    [Math.sin(b.rot), Math.cos(b.rot)],
  ];
  const dx = b.cx - a.cx;
  const dz = b.cz - a.cz;
  for (const [nx, nz] of axes) {
    const ra =
      a.hw * Math.abs(nx * Math.cos(a.rot) + nz * -Math.sin(a.rot)) +
      a.hd * Math.abs(nx * Math.sin(a.rot) + nz * Math.cos(a.rot));
    const rb =
      b.hw * Math.abs(nx * Math.cos(b.rot) + nz * -Math.sin(b.rot)) +
      b.hd * Math.abs(nx * Math.sin(b.rot) + nz * Math.cos(b.rot));
    if (Math.abs(nx * dx + nz * dz) > ra + rb + margin) return false; // separated along this axis
  }
  return true;
}

/** Evenly spaced sample points across the rectangle (including its edges), in world space. */
export function obbSamples(o: Obb, n: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const lx = n === 1 ? 0 : (i / (n - 1) - 0.5) * 2 * o.hw;
      const lz = n === 1 ? 0 : (j / (n - 1) - 0.5) * 2 * o.hd;
      out.push(obbToWorld(o, lx, lz));
    }
  }
  return out;
}
