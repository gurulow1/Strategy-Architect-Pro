import { describe, it, expect } from 'vitest';
import { analyzeTemporalDrift, parseTradeDate } from '../src/analysis/temporal.js';

// Build dated trades from a list of PnL values, one per day from 2024-01-01.
function datedTrades(pnls, { withDates = true } = {}) {
  return pnls.map((pnl, i) => {
    const d = new Date(2024, 0, 1 + i);
    const date = withDates ? d.toISOString().slice(0, 10) : null;
    return { date, pnl, r: null };
  });
}

describe('temporal drift', () => {
  it('parses ISO and MetaTrader-style dates', () => {
    expect(parseTradeDate('2024-01-15')).toBeInstanceOf(Date);
    expect(parseTradeDate('2026.02.14 01:53:24')).toBeInstanceOf(Date);
    expect(parseTradeDate('not a date')).toBeNull();
    expect(parseTradeDate(null)).toBeNull();
  });

  it('flags degradation when recent half is worse on BOTH expectancy and PF', () => {
    const early = [2, 2, 2, -1, 2, 2, -1, 2, 2, 2];     // strong winner
    const recent = [-1, -1, 1, -1, -1, -1, 1, -1, -1, -1]; // mostly losing
    const r = analyzeTemporalDrift(datedTrades([...early, ...recent]));
    expect(r.available).toBe(true);
    expect(r.earlyStats.expectancy).toBeGreaterThan(0);
    expect(r.recentStats.expectancy).toBeLessThan(r.earlyStats.expectancy * 0.75);
    expect(r.degrading).toBe(true);
    expect(r.trend.expectancyDelta).toBeLessThan(0);
  });

  it('does NOT flag degradation when the edge holds', () => {
    const flat = Array.from({ length: 30 }, (_, i) => (i % 3 === 0 ? -1 : 2));
    const r = analyzeTemporalDrift(datedTrades(flat));
    expect(r.available).toBe(true);
    expect(r.degrading).toBe(false);
    expect(r.rolling.expectancy.length).toBeGreaterThan(0);
  });

  it('returns available:false when dates are absent', () => {
    const r = analyzeTemporalDrift(datedTrades([1, -1, 2, -1, 1, 2, -1, 1], { withDates: false }));
    expect(r.available).toBe(false);
  });

  it('still returns halves but empty rolling for fewer than 20 trades', () => {
    const r = analyzeTemporalDrift(datedTrades([2, -1, 2, -1, 2, -1, 2, -1, 2, -1, 2, -1]));
    expect(r.available).toBe(true);
    expect(r.earlyStats.count).toBeGreaterThan(0);
    expect(r.recentStats.count).toBeGreaterThan(0);
    expect(r.rolling.expectancy.length).toBe(0);
  });
});
