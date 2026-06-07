import { describe, it, expect } from 'vitest';
import { kellyFraction, kellySizing } from '../src/engine/kelly.js';

describe('kellyFraction', () => {
  it('matches the closed form for a known case', () => {
    // winRate 0.6, rr 1 => 0.6 - 0.4/1 = 0.2
    expect(kellyFraction(0.6, 1)).toBeCloseTo(0.2, 10);
    // winRate 0.5, rr 2 => 0.5 - 0.5/2 = 0.25
    expect(kellyFraction(0.5, 2)).toBeCloseTo(0.25, 10);
  });
  it('is negative for a losing system', () => {
    expect(kellyFraction(0.4, 1)).toBeLessThan(0);
  });
});

describe('kellySizing', () => {
  it('half kelly is half of full', () => {
    const s = kellySizing(0.5, 2, 'half');
    expect(s.recommended).toBeCloseTo(0.125, 10);
    expect(s.profitable).toBe(true);
  });
  it('never recommends negative size for a losing system', () => {
    const s = kellySizing(0.3, 1, 'half');
    expect(s.profitable).toBe(false);
    expect(s.recommended).toBe(0);
  });
  it('respects a fixed fraction override', () => {
    const s = kellySizing(0.6, 2, 'fixed', 0.01);
    expect(s.recommended).toBe(0.01);
  });
});
