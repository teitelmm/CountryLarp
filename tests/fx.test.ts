import { describe, expect, it } from 'vitest';
import { FIXED_DT, GameClock } from '../src/core/Clock';
import { easeInOutCubic, easeOutBack, easeOutCubic, springStep, squashSettle } from '../src/fx/spring';

describe('easing', () => {
  it('hits 0 and 1 at the ends and clamps outside', () => {
    for (const f of [easeOutCubic, easeInOutCubic, (t: number) => easeOutBack(t)]) {
      expect(f(0)).toBeCloseTo(0, 9);
      expect(f(1)).toBeCloseTo(1, 9);
      expect(f(-3)).toBeCloseTo(0, 9);
      expect(f(5)).toBeCloseTo(1, 9);
    }
  });

  it('easeOutBack overshoots 1 before settling, the others never do', () => {
    let peak = 0;
    for (let i = 0; i <= 100; i++) peak = Math.max(peak, easeOutBack(i / 100));
    expect(peak).toBeGreaterThan(1.05);
    expect(peak).toBeLessThan(1.2);
    for (let i = 0; i <= 100; i++) {
      expect(easeOutCubic(i / 100)).toBeLessThanOrEqual(1);
      expect(easeInOutCubic(i / 100)).toBeLessThanOrEqual(1);
    }
  });

  it('easeOutCubic and easeInOutCubic are monotone', () => {
    for (let i = 1; i <= 100; i++) {
      expect(easeOutCubic(i / 100)).toBeGreaterThanOrEqual(easeOutCubic((i - 1) / 100));
      expect(easeInOutCubic(i / 100)).toBeGreaterThanOrEqual(easeInOutCubic((i - 1) / 100));
    }
  });
});

describe('springStep', () => {
  it('starts at 0, settles at 1, and an underdamped spring overshoots', () => {
    expect(springStep(0)).toBe(0);
    expect(springStep(-1)).toBe(0);
    expect(springStep(10)).toBeCloseTo(1, 4);
    let peak = 0;
    for (let t = 0; t < 2; t += 0.005) peak = Math.max(peak, springStep(t, 2, 0.4));
    expect(peak).toBeGreaterThan(1.1);
  });

  it('a critically damped spring approaches 1 monotonically without overshoot', () => {
    let prev = 0;
    for (let t = 0; t < 3; t += 0.01) {
      const v = springStep(t, 2, 1);
      expect(v).toBeGreaterThanOrEqual(prev - 1e-12);
      expect(v).toBeLessThanOrEqual(1);
      prev = v;
    }
  });
});

describe('squashSettle', () => {
  it('starts squashed, stretches, and settles to exactly (1, 1)', () => {
    const [sxz0, sy0] = squashSettle(0.0001);
    expect(sy0).toBeLessThan(1);
    expect(sxz0).toBeGreaterThan(1);
    let maxSy = 0;
    for (let t = 0; t < 1; t += 0.005) maxSy = Math.max(maxSy, squashSettle(t)[1]);
    expect(maxSy).toBeGreaterThan(1.02);
    const [a, b] = squashSettle(3);
    expect(a).toBeCloseTo(1, 4);
    expect(b).toBeCloseTo(1, 4);
    expect(squashSettle(0)).toEqual([1, 1]);
  });
});

describe('GameClock', () => {
  it('turns real time into whole fixed steps and carries the remainder', () => {
    const c = new GameClock();
    expect(c.consume(FIXED_DT * 2.5)).toBe(2);
    expect(c.consume(FIXED_DT * 0.5)).toBe(1); // 0.5 carried + 0.5 = 1 step
    expect(c.time).toBeCloseTo(3 * FIXED_DT, 9);
  });

  it('scales with speed and stops when paused', () => {
    const c = new GameClock();
    c.setSpeed(3);
    expect(c.consume(FIXED_DT)).toBe(3);
    c.setSpeed(0);
    expect(c.paused).toBe(true);
    expect(c.consume(1)).toBe(0);
    const t = c.time;
    c.togglePause();
    expect(c.speed).toBe(3); // resumes at the last running speed
    expect(c.consume(FIXED_DT)).toBe(3);
    expect(c.time).toBeGreaterThan(t);
  });

  it('caps a huge frame instead of simulating a giant jump', () => {
    const c = new GameClock();
    const steps = c.consume(10);
    expect(steps).toBeLessThanOrEqual(Math.ceil(GameClock.MAX_FRAME / FIXED_DT));
  });

  it('notifies on speed changes only', () => {
    const c = new GameClock();
    let n = 0;
    c.onChange(() => n++);
    c.setSpeed(1); // unchanged
    c.setSpeed(2);
    c.togglePause();
    expect(n).toBe(2);
  });

  it('advance moves time by whole steps', () => {
    const c = new GameClock();
    expect(c.advance(2)).toBe(120);
    expect(c.time).toBeCloseTo(2, 9);
  });
});
