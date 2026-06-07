import { describe, it, expect } from 'vitest';
import {
  mean, std, percentile, median, normalCdf, wilsonInterval, binomialPValue, bootstrapMeanCI,
} from '../src/engine/stats.js';
import { createRng } from '../src/engine/rng.js';

describe('basic stats', () => {
  it('mean and std', () => {
    expect(mean([2, 4, 6])).toBeCloseTo(4, 10);
    expect(std([2, 4, 6])).toBeCloseTo(2, 10); // sample std
  });
  it('percentile and median', () => {
    const a = [1, 2, 3, 4, 5];
    expect(median(a)).toBe(3);
    expect(percentile(a, 0)).toBe(1);
    expect(percentile(a, 1)).toBe(5);
  });
});

describe('normalCdf', () => {
  it('is ~0.5 at 0 and symmetric', () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 3);
    expect(normalCdf(1.96)).toBeCloseTo(0.975, 2);
    expect(normalCdf(-1.96)).toBeCloseTo(0.025, 2);
  });
});

describe('wilsonInterval', () => {
  it('brackets the observed proportion', () => {
    const [lo, hi] = wilsonInterval(60, 100);
    expect(lo).toBeLessThan(0.6);
    expect(hi).toBeGreaterThan(0.6);
    expect(lo).toBeGreaterThan(0.49);
    expect(hi).toBeLessThan(0.71);
  });
  it('narrows as sample grows', () => {
    const w100 = wilsonInterval(60, 100);
    const w1000 = wilsonInterval(600, 1000);
    expect((w1000[1] - w1000[0])).toBeLessThan(w100[1] - w100[0]);
  });
});

describe('binomialPValue', () => {
  it('is high when proportion matches baseline, low when far', () => {
    expect(binomialPValue(50, 100, 0.5)).toBeGreaterThan(0.9);
    expect(binomialPValue(75, 100, 0.5)).toBeLessThan(0.01);
  });
});

describe('bootstrapMeanCI', () => {
  it('flags a clearly positive sample as above zero', () => {
    const rng = createRng(42);
    const sample = Array.from({ length: 200 }, (_, i) => (i % 2 ? 2 : -1)); // expectancy +0.5
    const ci = bootstrapMeanCI(sample, rng, { iterations: 1000 });
    expect(ci.pAboveZero).toBeGreaterThan(0.95);
    expect(ci.low).toBeGreaterThan(0);
  });
  it('is uncertain for a breakeven sample', () => {
    const rng = createRng(7);
    const sample = Array.from({ length: 100 }, (_, i) => (i % 2 ? 1 : -1)); // expectancy 0
    const ci = bootstrapMeanCI(sample, rng, { iterations: 1000 });
    expect(ci.pAboveZero).toBeGreaterThan(0.2);
    expect(ci.pAboveZero).toBeLessThan(0.8);
  });
});
