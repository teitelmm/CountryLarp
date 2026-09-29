import * as THREE from 'three';
import type { BuildingManager } from '../buildings/BuildingManager';
import type { RTSCamera } from '../camera/RTSCamera';
import type { CountryData } from '../world/CountryData';
import type { HeightField } from '../world/HeightField';
import { formatLatLon, niceLength, worldToLatLon } from './geo';

const WIDTH = 216; // css px
const PAD = 6;
const BAR_TARGET = 60; // css px the scale bar aims for

type Rgb = [number, number, number];
/** Metres above sea level to a land colour. */
const RAMP: Array<[number, Rgb]> = [
  [0, [48, 76, 60]], [250, [86, 104, 66]], [600, [132, 116, 76]], [1200, [178, 167, 142]], [2200, [234, 232, 226]],
];
const WATER: Rgb = [11, 24, 33];

function ramp(h: number): Rgb {
  if (h <= RAMP[0][0]) return RAMP[0][1];
  for (let k = 1; k < RAMP.length; k++) {
    if (h <= RAMP[k][0]) {
      const [h0, c0] = RAMP[k - 1];
      const [h1, c1] = RAMP[k];
      const t = (h - h0) / (h1 - h0);
      return [c0[0] + (c1[0] - c0[0]) * t, c0[1] + (c1[1] - c0[1]) * t, c0[2] + (c1[2] - c0[2]) * t];
    }
  }
  return RAMP[RAMP.length - 1][1];
}

function compassSvg() {
  let ticks = '';
  for (let d = 15; d < 360; d += 15) {
    const major = d % 90 === 0;
    const r0 = major ? 22 : d % 45 === 0 ? 25 : 26.5;
    const a = (d * Math.PI) / 180;
    const [s, c] = [Math.sin(a), -Math.cos(a)];
    ticks += `<line x1="${(s * r0).toFixed(2)}" y1="${(c * r0).toFixed(2)}" x2="${(s * 29.5).toFixed(2)}" y2="${(c * 29.5).toFixed(2)}"/>`;
  }
  return `<svg viewBox="-32 -32 64 64" aria-hidden="true">
    <circle class="cp-disc" r="31"/>
    <g class="cp-rose">
      <g class="cp-ticks">${ticks}</g>
      <path class="cp-south" d="M0 15 L4 0 L0 2.5 L-4 0Z"/>
      <path class="cp-north" d="M0 -15 L4 0 L0 2.5 L-4 0Z"/>
      <text class="cp-n" x="0" y="-19.2" text-anchor="middle" dominant-baseline="central">N</text>
    </g>
  </svg>`;
}

/**
 * The theatre map: a hill-shaded chart of the whole country with your buildings, the ground the camera
 * sees, a north-pointing compass rose, the camera's latitude and longitude, and a real-kilometre scale bar.
 * Click or drag on the chart to fly the camera there.
 */
export class MapCard {
  readonly el = document.createElement('div');
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly base: HTMLCanvasElement;
  private readonly rose: SVGGElement;
  private readonly northLetter: SVGTextElement;
  private readonly coords: HTMLElement;
  private readonly alt: HTMLElement;
  private readonly pw: number;
  private readonly ph: number;
  /** World units to device pixels. */
  private readonly s: number;
  private readonly hf: HeightField;
  private sig = '';
  private angle = NaN;
  private readonly a = new THREE.Vector3();
  private readonly b = new THREE.Vector3();
  private readonly ray = new THREE.Vector3();
  private readonly dpr = Math.min(window.devicePixelRatio || 1, 2);

  constructor(
    private readonly data: CountryData,
    hf: HeightField,
    private readonly rig: RTSCamera,
    private readonly buildings: BuildingManager,
  ) {
    this.hf = hf;
    const cssH = Math.round(THREE.MathUtils.clamp(((WIDTH - 2 * PAD) * data.sizeZ) / data.sizeX + 2 * PAD, 130, 250));
    this.pw = Math.round(WIDTH * this.dpr);
    this.ph = Math.round(cssH * this.dpr);
    const padDev = PAD * this.dpr;
    this.s = Math.min((this.pw - 2 * padDev) / data.sizeX, (this.ph - 2 * padDev) / data.sizeZ);

    this.el.className = 'mapcard frame';
    this.el.innerHTML = `
      <div class="mc-head"><span class="mc-title">Theatre map</span><span class="mc-coords"></span></div>
      <div class="mc-map">
        <canvas></canvas>
        <button class="mc-compass" title="Face north" aria-label="Face north">${compassSvg()}</button>
      </div>
      <div class="mc-foot"><span class="mc-scale"><i></i><b></b></span><span class="mc-alt"></span></div>`;
    this.canvas = this.el.querySelector('canvas')!;
    this.canvas.width = this.pw;
    this.canvas.height = this.ph;
    this.canvas.style.width = `${WIDTH}px`;
    this.canvas.style.height = `${cssH}px`;
    this.ctx = this.canvas.getContext('2d')!;
    this.rose = this.el.querySelector('.cp-rose')!;
    this.northLetter = this.el.querySelector('.cp-n')!;
    this.coords = this.el.querySelector('.mc-coords')!;
    this.alt = this.el.querySelector('.mc-alt')!;

    // Scale bar in real kilometres (the map scale is fixed, so this is computed once).
    const kmPerDevPx = data.scale / this.s;
    const km = niceLength(BAR_TARGET * this.dpr * kmPerDevPx);
    (this.el.querySelector('.mc-scale i') as HTMLElement).style.width = `${km / kmPerDevPx / this.dpr}px`;
    (this.el.querySelector('.mc-scale b') as HTMLElement).textContent = `${km >= 1 ? km : km.toFixed(1)} km`;

    this.base = this.paintBase();

    const fly = (e: PointerEvent) => {
      const r = this.canvas.getBoundingClientRect();
      const [x, z] = this.toWorld(((e.clientX - r.left) / r.width) * this.pw, ((e.clientY - r.top) / r.height) * this.ph);
      this.rig.focusOn(x, z);
    };
    this.canvas.addEventListener('pointerdown', (e) => {
      this.canvas.setPointerCapture(e.pointerId);
      fly(e);
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (e.buttons & 1) fly(e);
    });
    (this.el.querySelector('.mc-compass') as HTMLElement).addEventListener('click', () => this.rig.setPose({ yaw: 0 }));

    document.body.appendChild(this.el);
  }

  private toWorld(u: number, v: number): [number, number] {
    return [(u - this.pw / 2) / this.s, (v - this.ph / 2) / this.s];
  }

  private toPx(x: number, z: number): [number, number] {
    return [this.pw / 2 + x * this.s, this.ph / 2 + z * this.s];
  }

  /** The static chart: hill-shaded land, dimmed foreign land, sea, graticule and the border. */
  private paintBase(): HTMLCanvasElement {
    const { cols, rows, heights, mask, cellKm } = this.data;
    const canvas = document.createElement('canvas');
    canvas.width = this.pw;
    canvas.height = this.ph;
    const ctx = canvas.getContext('2d')!;
    const img = ctx.createImageData(this.pw, this.ph);
    const px = img.data;
    const at = (i: number, j: number) => heights[Math.min(rows - 1, Math.max(0, j)) * cols + Math.min(cols - 1, Math.max(0, i))];
    for (let v = 0; v < this.ph; v++) {
      for (let u = 0; u < this.pw; u++) {
        const [x, z] = this.toWorld(u + 0.5, v + 0.5);
        const i = Math.round(x / cellKm + (cols - 1) / 2);
        const j = Math.round(z / cellKm + (rows - 1) / 2);
        const o = (v * this.pw + u) * 4;
        let c: Rgb = WATER;
        if (i >= 0 && j >= 0 && i < cols && j < rows) {
          const n = j * cols + i;
          const h = heights[n];
          const inside = mask[n] === 1;
          if (h > 0 || inside) {
            // North-west light: brighter where the ground drops away towards the south-east.
            const shade = THREE.MathUtils.clamp(1 + (at(i - 1, j - 1) - at(i + 1, j + 1)) / 700, 0.68, 1.32);
            const base = ramp(Math.max(h, 0));
            c = inside
              ? [base[0] * shade, base[1] * shade, base[2] * shade]
              : [base[0] * 0.3 + 12, base[1] * 0.3 + 15, base[2] * 0.3 + 17];
          }
        }
        px[o] = c[0];
        px[o + 1] = c[1];
        px[o + 2] = c[2];
        px[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);

    // Graticule every 100 real km.
    ctx.strokeStyle = 'rgba(200, 220, 214, 0.07)';
    ctx.lineWidth = this.dpr;
    const step = 100 / this.data.scale;
    ctx.beginPath();
    for (let x = 0; x <= this.data.sizeX / 2; x += step) {
      for (const sx of x === 0 ? [1] : [1, -1]) {
        const [u] = this.toPx(x * sx, 0);
        ctx.moveTo(u, 0);
        ctx.lineTo(u, this.ph);
      }
    }
    for (let z = 0; z <= this.data.sizeZ / 2; z += step) {
      for (const sz of z === 0 ? [1] : [1, -1]) {
        const [, v] = this.toPx(0, z * sz);
        ctx.moveTo(0, v);
        ctx.lineTo(this.pw, v);
      }
    }
    ctx.stroke();

    // The border.
    ctx.strokeStyle = 'rgba(232, 190, 96, 0.95)';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 1.2 * this.dpr;
    for (const polygon of this.data.borders) {
      for (const ring of polygon) {
        ctx.beginPath();
        ring.forEach(([x, z], k) => {
          const [u, v] = this.toPx(x, z);
          if (k === 0) ctx.moveTo(u, v);
          else ctx.lineTo(u, v);
        });
        ctx.closePath();
        ctx.stroke();
      }
    }
    return canvas;
  }

  /** The ground the camera sees, as four map-space points. */
  private viewPolygon(): Array<[number, number]> {
    const cam = this.rig.camera;
    const out: Array<[number, number]> = [];
    const maxT = this.rig.distance * 6;
    for (const [nx, ny] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
      this.ray.set(nx, ny, 0.5).unproject(cam).sub(cam.position).normalize();
      // Rays that miss the ground plane (looking above the horizon) are cut off at a distance.
      const t = this.ray.y < -0.02 ? Math.min(maxT, (this.rig.focus.y - cam.position.y) / this.ray.y) : maxT;
      out.push(this.toPx(cam.position.x + this.ray.x * t, cam.position.z + this.ray.z * t));
    }
    return out;
  }

  update() {
    const { rig } = this;
    const cam = rig.camera;
    const f = rig.focus;

    // Compass: where north points on screen, measured clockwise from "up".
    this.a.copy(f).project(cam);
    this.b.set(f.x, f.y, f.z - 1).project(cam);
    const deg = (Math.atan2((this.b.x - this.a.x) * cam.aspect, this.b.y - this.a.y) * 180) / Math.PI;
    if (!(Math.abs(deg - this.angle) < 0.05)) {
      this.angle = deg;
      this.rose.setAttribute('transform', `rotate(${deg.toFixed(2)})`);
      this.northLetter.setAttribute('transform', `rotate(${(-deg).toFixed(2)} 0 -19.2)`);
    }

    const all = this.buildings.all;
    const done = all.reduce((n, b) => n + (b.state === 'complete' ? 1 : 0), 0);
    const sig = `${f.x.toFixed(2)}|${f.z.toFixed(2)}|${rig.yaw.toFixed(3)}|${rig.pitch.toFixed(3)}|${rig.distance.toFixed(1)}|${cam.aspect.toFixed(3)}|${all.length}|${done}`;
    if (sig === this.sig) return;
    this.sig = sig;

    const { lat, lon } = worldToLatLon(this.data.meta, this.data.scale, f.x, f.z);
    const coords = formatLatLon(lat, lon);
    if (this.coords.textContent !== coords) this.coords.textContent = coords;
    const metres = Math.max(0, Math.round(((f.y / this.hf.exag) * 1000) / 10) * 10);
    const alt = `${metres.toLocaleString('en-US')} m`;
    if (this.alt.textContent !== alt) this.alt.textContent = alt;

    const { ctx, dpr } = this;
    ctx.clearRect(0, 0, this.pw, this.ph);
    ctx.drawImage(this.base, 0, 0);

    // What the camera sees.
    const poly = this.viewPolygon();
    ctx.beginPath();
    poly.forEach(([u, v], k) => (k === 0 ? ctx.moveTo(u, v) : ctx.lineTo(u, v)));
    ctx.closePath();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.07)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(245, 246, 240, 0.85)';
    ctx.lineWidth = 1.1 * dpr;
    ctx.stroke();

    // Buildings: solid when operational, outlined while under construction.
    const size = 3.4 * dpr;
    ctx.lineWidth = 1 * dpr;
    for (const b of all) {
      const [u, v] = this.toPx(b.x, b.z);
      if (b.state === 'complete') {
        ctx.fillStyle = this.data.meta.colors.primary;
        ctx.fillRect(u - size / 2, v - size / 2, size, size);
        ctx.strokeStyle = 'rgba(8, 14, 18, 0.9)';
      } else {
        ctx.strokeStyle = 'rgba(245, 246, 240, 0.95)';
      }
      ctx.strokeRect(u - size / 2, v - size / 2, size, size);
    }

    // Focus mark.
    const [fu, fv] = this.toPx(f.x, f.z);
    ctx.strokeStyle = 'rgba(232, 190, 96, 0.95)';
    ctx.lineWidth = 1.2 * dpr;
    ctx.beginPath();
    ctx.moveTo(fu - 5 * dpr, fv);
    ctx.lineTo(fu + 5 * dpr, fv);
    ctx.moveTo(fu, fv - 5 * dpr);
    ctx.lineTo(fu, fv + 5 * dpr);
    ctx.stroke();
  }

  dispose() {
    this.el.remove();
  }
}
