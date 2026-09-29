import * as THREE from 'three';

interface EmitOptions {
  /** Horizontal speed of the puff, units/s. */
  spread?: number;
  /** Initial upward speed. */
  up?: number;
  /** Starting radius of each particle (world units). */
  size?: number;
  life?: number;
}

/**
 * A pooled soft-dust particle system (one draw call). Puffs are emitted where pieces land, when a
 * site breaks ground and when a building tops out. Particles grow and fade; the pool is a ring buffer
 * so emitting never allocates.
 */
export class Dust {
  readonly points: THREE.Points;
  private readonly n: number;
  private readonly pos: Float32Array;
  private readonly vel: Float32Array;
  private readonly age: Float32Array;
  private readonly life: Float32Array;
  private readonly size0: Float32Array;
  private readonly sizeAttr: THREE.BufferAttribute;
  private readonly alphaAttr: THREE.BufferAttribute;
  private readonly posAttr: THREE.BufferAttribute;
  private readonly material: THREE.ShaderMaterial;
  private cursor = 0;
  private live = 0;

  constructor(capacity = 900, color = 0xd9cdb4) {
    this.n = capacity;
    this.pos = new Float32Array(capacity * 3);
    this.vel = new Float32Array(capacity * 3);
    this.age = new Float32Array(capacity).fill(Infinity);
    this.life = new Float32Array(capacity).fill(1);
    this.size0 = new Float32Array(capacity);
    const geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.sizeAttr = new THREE.BufferAttribute(new Float32Array(capacity), 1).setUsage(THREE.DynamicDrawUsage);
    this.alphaAttr = new THREE.BufferAttribute(new Float32Array(capacity), 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.posAttr);
    geo.setAttribute('aSize', this.sizeAttr);
    geo.setAttribute('aAlpha', this.alphaAttr);
    this.material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { uScale: { value: 500 }, uColor: { value: new THREE.Color(color) } },
      vertexShader: /* glsl */ `
        attribute float aSize;
        attribute float aAlpha;
        uniform float uScale;
        varying float vAlpha;
        void main() {
          vAlpha = aAlpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * uScale / max(0.001, -mv.z);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        varying float vAlpha;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.05, d) * vAlpha;
          if (a < 0.01) discard;
          gl_FragColor = vec4(uColor, a);
        }
      `,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 4;
  }

  /** Pixel scale so particle sizes are world units: viewport height / (2 tan(fov / 2)). */
  setPixelScale(viewportHeightPx: number, fovDeg: number) {
    this.material.uniforms.uScale.value = viewportHeightPx / (2 * Math.tan(THREE.MathUtils.degToRad(fovDeg) / 2));
  }

  get liveCount() {
    return this.live;
  }

  emit(x: number, y: number, z: number, count: number, o: EmitOptions = {}) {
    const spread = o.spread ?? 0.6;
    const up = o.up ?? 0.5;
    const size = o.size ?? 0.16;
    const life = o.life ?? 1.1;
    for (let k = 0; k < count; k++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % this.n;
      const a = Math.random() * Math.PI * 2;
      const s = spread * (0.35 + Math.random() * 0.65);
      this.pos[i * 3] = x + (Math.random() - 0.5) * size;
      this.pos[i * 3 + 1] = y;
      this.pos[i * 3 + 2] = z + (Math.random() - 0.5) * size;
      this.vel[i * 3] = Math.cos(a) * s;
      this.vel[i * 3 + 1] = up * (0.4 + Math.random() * 0.8);
      this.vel[i * 3 + 2] = Math.sin(a) * s;
      this.age[i] = 0;
      this.life[i] = life * (0.7 + Math.random() * 0.6);
      this.size0[i] = size * (0.7 + Math.random() * 0.6);
    }
  }

  /** A ring of dust spreading outward (site breaking ground / topping out). */
  ring(x: number, y: number, z: number, radius: number, count: number, size = 0.22) {
    for (let k = 0; k < count; k++) {
      const a = (k / count) * Math.PI * 2 + Math.random() * 0.2;
      this.emit(x + Math.cos(a) * radius, y, z + Math.sin(a) * radius, 1, { spread: 0.9, up: 0.35, size, life: 1.6 });
      const i = (this.cursor + this.n - 1) % this.n;
      // Send it outward from the centre rather than in a random direction.
      this.vel[i * 3] = Math.cos(a) * 0.9;
      this.vel[i * 3 + 2] = Math.sin(a) * 0.9;
    }
  }

  /** Discard every live particle. */
  clear() {
    this.age.fill(Infinity);
    this.live = 0;
  }

  update(dt: number) {
    const sizes = this.sizeAttr.array as Float32Array;
    const alphas = this.alphaAttr.array as Float32Array;
    let live = 0;
    for (let i = 0; i < this.n; i++) {
      const age = this.age[i];
      if (age >= this.life[i]) {
        alphas[i] = 0;
        sizes[i] = 0;
        continue;
      }
      live++;
      const a = age + dt;
      this.age[i] = a;
      const drag = Math.max(0, 1 - dt * 1.8);
      this.vel[i * 3] *= drag;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * drag + 0.25 * dt; // warm dust drifts up
      this.vel[i * 3 + 2] *= drag;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      const t = a / this.life[i];
      sizes[i] = this.size0[i] * (1 + 2.2 * t);
      alphas[i] = 0.55 * (1 - t) * (1 - t);
    }
    this.live = live;
    this.posAttr.needsUpdate = true;
    this.sizeAttr.needsUpdate = true;
    this.alphaAttr.needsUpdate = true;
  }

  dispose() {
    this.points.geometry.dispose();
    this.material.dispose();
  }
}
