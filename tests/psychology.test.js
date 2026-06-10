import { describe, it, expect } from 'vitest';
import { analyzePsychology } from '../src/analysis/psychology.js';

// 10 trades: L L W W L L L W W W → after 2 losses, next is W (WR=1.0 here)
const trades = [
  { date: null, pnl: -100 }, { date: null, pnl: -80 },
  { date: null, pnl: 200 },  { date: null, pnl: 150 },
  { date: null, pnl: -50 },  { date: null, pnl: -70 }, { date: null, pnl: -60 },
  { date: null, pnl: 120 },  { date: null, pnl: 90 },  { date: null, pnl: 110 },
];

describe('analyzePsychology', () => {
  it('computes afterLoss entries', () => {
    const r = analyzePsychology(trades);
    expect(r.afterLoss).toHaveLength(3);
    expect(r.afterLoss[0].after).toBe(1);
    expect(r.afterLoss[0].sampleSize).toBeGreaterThan(0);
  });

  it('hasDatetime false when dates are null', () => {
    const r = analyzePsychology(trades);
    expect(r.hasDatetime).toBe(false);
    expect(r.heatmap).toHaveLength(0);
  });

  it('stopSignal null when sample too small or WR stable', () => {
    // All wins — no consecutive losses pattern → no stop signal
    const allWins = Array.from({ length: 20 }, () => ({ date: null, pnl: 100 }));
    const r = analyzePsychology(allWins);
    expect(r.stopSignal).toBeNull();
  });

  it('computes heatmap when valid dates present', () => {
    const withDates = [
      { date: '2024-01-10 09:30', pnl: 200 },
      { date: '2024-01-11 09:45', pnl: 150 },
      { date: '2024-01-12 14:00', pnl: -80 },
      { date: '2024-01-13 14:30', pnl: -60 },
    ];
    const r = analyzePsychology(withDates);
    expect(r.hasDatetime).toBe(true);
    expect(r.heatmap.length).toBeGreaterThan(0);
    const h9 = r.heatmap.find((h) => h.hour === 9);
    expect(h9).toBeDefined();
    expect(h9.avgPnl).toBeGreaterThan(0);
  });
});
