// Easing and spring helpers for the placement / construction animations. All take t in [0, 1] unless noted.

export const clamp01 = (t: number) => Math.min(1, Math.max(0, t));

export const easeOutCubic = (t: number) => 1 - (1 - clamp01(t)) ** 3;

export const easeInOutCubic = (t: number) => {
  const x = clamp01(t);
  return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;
};

/** Ease-out with overshoot: rises past 1 and settles back. `s` sets the overshoot (1.70158 is ~10%). */
export const easeOutBack = (t: number, s = 1.70158) => {
  const x = clamp01(t) - 1;
  return 1 + (s + 1) * x * x * x + s * x * x;
};

/**
 * Response of a damped spring to a unit step at time `t` seconds: 0 at t = 0, settling to 1.
 * With damping ratio zeta < 1 it overshoots and rings; zeta >= 1 approaches without overshoot.
 * `freq` is the undamped frequency in Hz.
 */
export function springStep(t: number, freq = 2, zeta = 0.45): number {
  if (t <= 0) return 0;
  const w = 2 * Math.PI * freq;
  if (zeta >= 1) {
    // Critically (or over-) damped: use the critical solution, which is monotone.
    return 1 - Math.exp(-w * t) * (1 + w * t);
  }
  const wd = w * Math.sqrt(1 - zeta * zeta);
  const decay = Math.exp(-zeta * w * t);
  return 1 - decay * (Math.cos(wd * t) + ((zeta * w) / wd) * Math.sin(wd * t));
}

/**
 * Squash-and-settle for a finished building: [scaleXZ, scaleY] over `t` seconds. Starts by squashing,
 * stretches past 1, then rings down to exactly (1, 1) (volume roughly preserved).
 */
export function squashSettle(t: number): [number, number] {
  if (t <= 0) return [1, 1];
  const ring = Math.exp(-5.5 * t) * Math.cos(15 * t + 3.14159); // starts at -1 (squashed)
  const sy = 1 + 0.07 * ring;
  const sxz = 1 - 0.035 * ring;
  return [sxz, sy];
}
