import { describe, it, expect } from 'vitest';
import {
  tradeStats, expectancyR, equityCurve, maxDrawdown, streaks,
} from '../src/engine/metrics.js';

describe('tradeStats', () => {
  it('computes win rate, payoff, profit factor, expectancy on a known series', () => {
    // 3 wins of +2, 2 losses of -1
    const pnls = [2, -1, 2, 2, -1];
    const s = tradeStats(pnls);
    expect(s.count).toBe(5);
    expect(s.wins).toBe(3);
    expect(s.losses).toBe(2);
    expect(s.winRate).toBeCloseTo(0.6, 10);
    expect(s.avgWin).toBeCloseTo(2, 10);
    expect(s.avgLoss).toBeCloseTo(1, 10);
    expect(s.payoffRatio).toBeCloseTo(2, 10);
    // gross profit 6, gross loss 2 => PF 3
    expect(s.profitFactor).toBeCloseTo(3, 10);
    // expectancy = mean = (6 - 2)/5 = 0.8
    expect(s.expectancy).toBeCloseTo(0.8, 10);
  });

  it('handles all-wins (infinite profit factor) without dividing by zero', () => {
    const s = tradeStats([1, 2, 3]);
    expect(s.profitFactor).toBe(Infinity);
    expect(s.losses).toBe(0);
  });

  it('returns zeros for an empty series', () => {
    const s = tradeStats([]);
    expect(s.count).toBe(0);
    expect(s.profitFactor).toBe(0);
    expect(s.expectancy).toBe(0);
  });

  it('profit factor is gross-profit / gross-loss, NOT the expectancy ratio', () => {
    // Asymmetric: one big win, many small losses
    const pnls = [10, -1, -1, -1, -1];
    const s = tradeStats(pnls);
    expect(s.grossProfit).toBe(10);
    expect(s.grossLoss).toBe(4);
    expect(s.profitFactor).toBeCloseTo(2.5, 10);
  });
});

describe('expectancyR', () => {
  it('matches the textbook formula winRate*rr - (1-winRate)', () => {
    expect(expectancyR(0.5, 2)).toBeCloseTo(0.5, 10); // 0.5*2 - 0.5
    expect(expectancyR(0.4, 1)).toBeCloseTo(-0.2, 10);
    expect(expectancyR(0.33, 3)).toBeCloseTo(0.32, 10);
  });
});

describe('equityCurve & maxDrawdown', () => {
  it('builds a cumulative curve', () => {
    expect(equityCurve([1, -2, 3], 10)).toEqual([10, 11, 9, 12]);
  });

  it('finds the worst peak-to-trough drawdown', () => {
    // peak 12 -> trough 9 => 3 abs, 25% frac happens before recovery
    const curve = equityCurve([5, -3, -2, 10], 10); // 10,15,12,10,20 peak15 trough10 dd=5/15
    const dd = maxDrawdown(curve);
    expect(dd.absolute).toBeCloseTo(5, 10);
    expect(dd.fraction).toBeCloseTo(5 / 15, 10);
  });
});

describe('streaks', () => {
  it('tracks the longest win and loss streaks', () => {
    const s = streaks([1, 1, 1, -1, -1, 1, -1, -1, -1]);
    expect(s.longestWin).toBe(3);
    expect(s.longestLoss).toBe(3);
  });
});
