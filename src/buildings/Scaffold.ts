import * as THREE from 'three';

/**
 * Perimeter scaffolding as one InstancedMesh: vertical poles that grow with construction progress and
 * horizontal ledgers that appear level by level. When the building is finished it is stripped: every
 * member is thrown clear, tumbles under gravity, bounces and shrinks away.
 */
export class Scaffold {
  readonly mesh: THREE.InstancedMesh;
  private readonly poleCount: number;
  private readonly levels: number;
  private readonly height: number;
  // Base (assembled) transforms.
  private readonly px: Float32Array;
  private readonly pz: Float32Array;
  private readonly ledgers: Array<{ x: number; y: number; z: number; len: number; yaw: number; level: number }> = [];
  // Strip-down state per instance.
  private collapsing = false;
  private collapseT = 0;
  private pos: Float32Array = new Float32Array(0);
  private vel: Float32Array = new Float32Array(0);
  private rot: Float32Array = new Float32Array(0);
  private spin: Float32Array = new Float32Array(0);
  private dim: Float32Array = new Float32Array(0); // sx, sy, sz per instance
  private yaw: Float32Array = new Float32Array(0);
  private progress = 0;
  private readonly tmp = new THREE.Object3D();

  static readonly LEVEL_HEIGHT = 0.45;
  static readonly STRIP_DURATION = 2.2;

  constructor(w: number, d: number, height: number, material: THREE.Material, offset = 0.24, spacing = 0.75) {
    this.height = Math.max(0.6, height * 0.95);
    const hw = w / 2 + offset;
    const hd = d / 2 + offset;
    // Pole positions around the rectangle.
    const corners: Array<[number, number]> = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]];
    const polesXZ: Array<[number, number]> = [];
    for (let i = 0; i < 4; i++) {
      const [ax, az] = corners[i];
      const [bx, bz] = corners[(i + 1) % 4];
      const steps = Math.max(1, Math.round(Math.hypot(bx - ax, bz - az) / spacing));
      for (let s = 0; s < steps; s++) polesXZ.push([ax + ((bx - ax) * s) / steps, az + ((bz - az) * s) / steps]);
    }
    this.poleCount = polesXZ.length;
    this.px = Float32Array.from(polesXZ.map((p) => p[0]));
    this.pz = Float32Array.from(polesXZ.map((p) => p[1]));
    this.levels = Math.max(1, Math.floor(this.height / Scaffold.LEVEL_HEIGHT));
    for (let lvl = 1; lvl <= this.levels; lvl++) {
      for (let i = 0; i < this.poleCount; i++) {
        const j = (i + 1) % this.poleCount;
        const dx = this.px[j] - this.px[i];
        const dz = this.pz[j] - this.pz[i];
        this.ledgers.push({
          x: (this.px[i] + this.px[j]) / 2, y: lvl * Scaffold.LEVEL_HEIGHT, z: (this.pz[i] + this.pz[j]) / 2,
          len: Math.hypot(dx, dz), yaw: Math.atan2(-dz, dx), level: lvl,
        });
      }
    }
    const total = this.poleCount + this.ledgers.length;
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), material, total);
    this.mesh.castShadow = true;
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.setProgress(0);
  }

  get instanceCount() {
    return this.poleCount + this.ledgers.length;
  }

  get isCollapsing() {
    return this.collapsing;
  }

  /** Grow with construction progress in [0, 1]. */
  setProgress(p: number) {
    if (this.collapsing) return;
    this.progress = THREE.MathUtils.clamp(p, 0, 1);
    const h = this.progress * this.height;
    const t = this.tmp;
    t.rotation.set(0, 0, 0);
    for (let i = 0; i < this.poleCount; i++) {
      t.position.set(this.px[i], Math.max(0.01, h) / 2, this.pz[i]);
      t.scale.set(0.05, Math.max(0.01, h), 0.05);
      t.updateMatrix();
      this.mesh.setMatrixAt(i, t.matrix);
    }
    let visible = 0;
    for (let k = 0; k < this.ledgers.length; k++) {
      const l = this.ledgers[k];
      if (l.y > h + 0.02) break; // ledgers are ordered by level
      t.position.set(l.x, l.y, l.z);
      t.rotation.set(0, l.yaw, 0);
      t.scale.set(l.len, 0.04, 0.04);
      t.updateMatrix();
      this.mesh.setMatrixAt(this.poleCount + k, t.matrix);
      visible++;
    }
    this.mesh.count = this.poleCount + visible;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  /** Start the strip-down: throw every member outward and let it tumble. */
  collapse() {
    if (this.collapsing) return;
    this.collapsing = true;
    this.collapseT = 0;
    const n = this.mesh.count;
    this.pos = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    this.rot = new Float32Array(n * 3);
    this.spin = new Float32Array(n * 3);
    this.dim = new Float32Array(n * 3);
    this.yaw = new Float32Array(n);
    const h = this.progress * this.height;
    for (let i = 0; i < n; i++) {
      let x: number, y: number, z: number;
      if (i < this.poleCount) {
        x = this.px[i]; y = Math.max(0.01, h) / 2; z = this.pz[i];
        this.dim.set([0.05, Math.max(0.01, h), 0.05], i * 3);
      } else {
        const l = this.ledgers[i - this.poleCount];
        x = l.x; y = l.y; z = l.z;
        this.dim.set([l.len, 0.04, 0.04], i * 3);
        this.yaw[i] = l.yaw;
      }
      this.pos.set([x, y, z], i * 3);
      const r = Math.hypot(x, z) || 1;
      const out = 0.7 + Math.random() * 1.3; // outward, away from the building
      this.vel.set([(x / r) * out + (Math.random() - 0.5), 1 + Math.random() * 1.8, (z / r) * out + (Math.random() - 0.5)], i * 3);
      this.rot.set([0, this.yaw[i], 0], i * 3);
      this.spin.set([(Math.random() - 0.5) * 6, (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 6], i * 3);
    }
  }

  /** Advance the strip-down. Returns true once every member has faded away. */
  update(dt: number): boolean {
    if (!this.collapsing) return false;
    this.collapseT += dt;
    const n = this.mesh.count;
    const t = this.tmp;
    const fade = THREE.MathUtils.clamp((this.collapseT - (Scaffold.STRIP_DURATION - 0.9)) / 0.9, 0, 1);
    for (let i = 0; i < n; i++) {
      const b = i * 3;
      this.vel[b + 1] -= 12 * dt;
      this.pos[b] += this.vel[b] * dt;
      this.pos[b + 1] += this.vel[b + 1] * dt;
      this.pos[b + 2] += this.vel[b + 2] * dt;
      if (this.pos[b + 1] < 0.03) {
        this.pos[b + 1] = 0.03;
        this.vel[b + 1] *= -0.3;
        this.vel[b] *= 0.7;
        this.vel[b + 2] *= 0.7;
        for (let k = 0; k < 3; k++) this.spin[b + k] *= 0.6;
      }
      this.rot[b] += this.spin[b] * dt;
      this.rot[b + 1] += this.spin[b + 1] * dt;
      this.rot[b + 2] += this.spin[b + 2] * dt;
      const s = 1 - fade;
      t.position.set(this.pos[b], this.pos[b + 1], this.pos[b + 2]);
      t.rotation.set(this.rot[b], this.rot[b + 1], this.rot[b + 2]);
      t.scale.set(this.dim[b] * s, this.dim[b + 1] * s, this.dim[b + 2] * s);
      t.updateMatrix();
      this.mesh.setMatrixAt(i, t.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    return this.collapseT >= Scaffold.STRIP_DURATION;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mesh.dispose();
  }
}
