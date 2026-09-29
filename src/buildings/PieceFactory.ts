import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { MaterialSet } from './materials';
import type { BuildingDef, DetailSpec, MaterialId, PieceSpec } from './types';

const RADIAL = 14;
const geometryCache = new Map<string, THREE.BufferGeometry>();
const detailCache = new WeakMap<PieceSpec, Array<{ material: MaterialId; geometry: THREE.BufferGeometry }>>();

/** Triangular (gable) prism: triangle in the xy-plane with its apex at `ridge`, extruded along z. */
export function createWedgeGeometry(w: number, h: number, d: number, ridge = 0.5): THREE.BufferGeometry {
  const pts = wedgePoints(w, h, d, ridge);
  const [A, B, C, A2, B2, C2] = pts.map((p) => new THREE.Vector3(...p));
  const center = new THREE.Vector3();
  for (const p of [A, B, C, A2, B2, C2]) center.add(p);
  center.multiplyScalar(1 / 6);
  const positions: number[] = [];
  const tri = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) => {
    const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
    const mid = new THREE.Vector3().add(a).add(b).add(c).multiplyScalar(1 / 3).sub(center);
    // Wind so the face normal points away from the centre (the prism is convex).
    if (n.dot(mid) < 0) [b, c] = [c, b];
    positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  };
  tri(A, B, C); // front
  tri(A2, B2, C2); // back
  tri(A, B, B2); tri(A, B2, A2); // bottom
  tri(A, C, C2); tri(A, C2, A2); // left slope
  tri(B, C, C2); tri(B, C2, B2); // right slope
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.computeVertexNormals();
  return g;
}

/** The 6 vertices of the wedge, centred on the origin: front A,B,C then back A2,B2,C2. */
export function wedgePoints(w: number, h: number, d: number, ridge = 0.5): Array<[number, number, number]> {
  const ax = (ridge - 0.5) * w;
  return [
    [-w / 2, -h / 2, d / 2], [w / 2, -h / 2, d / 2], [ax, h / 2, d / 2],
    [-w / 2, -h / 2, -d / 2], [w / 2, -h / 2, -d / 2], [ax, h / 2, -d / 2],
  ];
}

/** Points for a convex-hull collider of wedge/frustum pieces (in the piece's local frame). */
export function hullPoints(spec: PieceSpec): Float32Array | null {
  if (spec.shape === 'wedge') {
    return Float32Array.from(wedgePoints(spec.size[0], spec.size[1], spec.size[2], spec.ridge ?? 0.5).flat());
  }
  if (spec.shape === 'frustum') {
    const pts: number[] = [];
    const [db, h, dt] = spec.size;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      pts.push(Math.cos(a) * (db / 2), -h / 2, Math.sin(a) * (db / 2));
      pts.push(Math.cos(a) * (dt / 2), h / 2, Math.sin(a) * (dt / 2));
    }
    return Float32Array.from(pts);
  }
  return null;
}

export function createPieceGeometry(spec: PieceSpec): THREE.BufferGeometry {
  const key = `${spec.shape}|${spec.size.join(',')}|${spec.ridge ?? 0.5}`;
  let g = geometryCache.get(key);
  if (g) return g;
  const [x, y, z] = spec.size;
  switch (spec.shape) {
    case 'box':
      g = new THREE.BoxGeometry(x, y, z);
      break;
    case 'cylinder':
      g = new THREE.CylinderGeometry(x / 2, x / 2, y, RADIAL);
      break;
    case 'cone':
      g = new THREE.ConeGeometry(x / 2, y, RADIAL);
      break;
    case 'frustum':
      g = new THREE.CylinderGeometry(z / 2, x / 2, y, RADIAL);
      break;
    case 'wedge':
      g = createWedgeGeometry(x, y, z, spec.ridge ?? 0.5);
      break;
  }
  geometryCache.set(key, g);
  return g;
}

function detailGeometry(d: DetailSpec): THREE.BufferGeometry {
  const g = d.shape === 'box' ? new THREE.BoxGeometry(...d.size) : new THREE.CylinderGeometry(d.size[0] / 2, d.size[0] / 2, d.size[1], 10);
  if (d.rot) g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...d.rot)));
  g.translate(...d.pos);
  return g;
}

/** Details merged into one geometry per material (windows on a facade become a single draw call). */
function mergedDetails(spec: PieceSpec) {
  let out = detailCache.get(spec);
  if (out) return out;
  const byMaterial = new Map<MaterialId, THREE.BufferGeometry[]>();
  for (const d of spec.details ?? []) {
    const list = byMaterial.get(d.material) ?? [];
    list.push(detailGeometry(d));
    byMaterial.set(d.material, list);
  }
  out = [];
  for (const [material, geos] of byMaterial) {
    const merged = geos.length === 1 ? geos[0] : mergeGeometries(geos, false);
    if (geos.length > 1) for (const g of geos) g.dispose();
    if (merged) out.push({ material, geometry: merged });
  }
  detailCache.set(spec, out);
  return out;
}

/** A single piece as a mesh (with merged detail children), positioned in building-local space. */
export function createPieceMesh(spec: PieceSpec, mats: MaterialSet): THREE.Mesh {
  const mesh = new THREE.Mesh(createPieceGeometry(spec), mats[spec.material]);
  mesh.position.set(...spec.pos);
  if (spec.rot) mesh.rotation.set(...spec.rot);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.piece = spec;
  for (const { material, geometry } of mergedDetails(spec)) {
    const child = new THREE.Mesh(geometry, mats[material]);
    child.castShadow = false;
    child.receiveShadow = true;
    mesh.add(child);
  }
  return mesh;
}

/** The finished building as a group of piece meshes (`upToStage` limits to earlier construction stages). */
export function createBuildingGroup(def: BuildingDef, mats: MaterialSet, upToStage = Infinity): THREE.Group {
  const group = new THREE.Group();
  group.name = def.id;
  for (const spec of def.pieces) {
    if (spec.stage <= upToStage) group.add(createPieceMesh(spec, mats));
  }
  return group;
}

/**
 * Collapse a built group into one mesh per material (so a finished building costs a few draw calls).
 * World transforms of each piece (and its details) are baked into the geometry.
 */
export function mergeBuilding(group: THREE.Group, mats: MaterialSet): THREE.Group {
  group.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(group.matrixWorld).invert();
  const buckets = new Map<THREE.Material, THREE.BufferGeometry[]>();
  group.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    const g = obj.geometry.clone();
    // Merging needs matching attribute sets: keep only position + normal, non-indexed.
    for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
    const flat = g.index ? g.toNonIndexed() : g;
    flat.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, obj.matrixWorld));
    const list = buckets.get(obj.material as THREE.Material) ?? [];
    list.push(flat);
    buckets.set(obj.material as THREE.Material, list);
  });
  const merged = new THREE.Group();
  merged.name = group.name;
  for (const [material, geos] of buckets) {
    const geometry = mergeGeometries(geos, false);
    if (!geometry) continue;
    const mesh = new THREE.Mesh(geometry, material);
    const isGlass = material === mats.glass;
    mesh.castShadow = !isGlass;
    mesh.receiveShadow = true;
    merged.add(mesh);
  }
  return merged;
}
