import { describe, it, expect } from 'vitest';
import { simulate, equityBands } from '../src/engine/simulate.js';
import { createRng } from '../src/engine/rng.js';
import { mean } from '../src/engine/stats.js';
import { riskOfRuin } from '../src/engine/riskOfRuin.js';

const base = {
  capital: 10000, trades: 100, sims: 500, risk: 0.01, costPerTrade: 0,
};

describe('simulate (parametric)', () => {
  it('is deterministic for a fixed seed', () => {
    const a = simulate({ ...base, winRate: 0.5, rr: 2 }, createRng(123));
    const b = simulate({ ...base, winRate: 0.5, rr: 2 }, createRng(123));
    expect(a.returns).toEqual(b.returns);
  });

  it('a positive-edge system has positive mean return on average', () => {
    const r = simulate({ ...base, winRate: 0.55, rr: 2 }, createRng(1));
    expect(mean(r.returns)).toBeGreaterThan(0);
  });

  it('a negative-edge system has negative mean return on average', () => {
    const r = simulate({ ...base, winRate: 0.4, rr: 1 }, createRng(2));
    expect(mean(r.returns)).toBeLessThan(0);
  });

  it('higher costs reduce returns', () => {
    const cheap = simulate({ ...base, winRate: 0.55, rr: 2, costPerTrade: 0 }, createRng(5));
    const pricey = simulate({ ...base, winRate: 0.55, rr: 2, costPerTrade: 0.005 }, createRng(5));
    expect(mean(pricey.returns)).toBeLessThan(mean(cheap.returns));
  });

  it('realized R-multiples reflect the spec (win=+rr, loss=-1) at zero cost', () => {
    const r = simulate({ ...base, winRate: 0.5, rr: 2, costPerTrade: 0 }, createRng(9));
    // every realized R should be either +2 or -1
    const distinct = [...new Set(r.realizedR.map((x) => Math.round(x * 100) / 100))].sort();
    expect(distinct).toEqual([-1, 2]);
  });
});

describe('simulate (empirical bootstrap)', () => {
  it('reproduces the edge of the provided sample', () => {
    const sample = [2, 2, -1, -1, -1]; // expectancy -0.2 ... actually 0.0? (4-3)/5
    const r = simulate({ ...base, sample, costPerTrade: 0 }, createRng(3));
    // sample mean R = (2+2-1-1-1)/5 = 0.2 -> positive
    expect(mean(r.returns)).toBeGreaterThan(0);
  });

  it('can skip the large realized-trade buffer when only path metrics are needed', () => {
    const r = simulate(
      {
        ...base,
        sample: [2, -1],
        collectRealizedR: false,
        collectBandCurves: false,
      },
      createRng(3),
    );
    expect(r.realizedR).toEqual([]);
    expect(r.bandCurves).toEqual([]);
    expect(r.returns).toHaveLength(base.sims);
  });
});

describe('simulate (prop intraday paths)', () => {
  it('retains every intraday equity point while keeping legacy daily closes', () => {
    const draws = [0.9, 0.1]; // loss, then win
    let i = 0;
    const r = simulate(
      {
        capital: 100, trades: 2, sims: 1, risk: 0.1,
        costPerTrade: 0, winRate: 0.5, rr: 1, tradesPerDay: 2,
      },
      () => draws[i++],
    );
    expect(r.dailyCurves).toEqual([[100, 99]]);
    expect(r.intradayCurves).toEqual([[[100, 90, 99]]]);
  });
});

describe('riskOfRuin integration', () => {
  it('an over-leveraged negative system ruins often; a tiny-risk one rarely', () => {
    const reckless = simulate({ ...base, winRate: 0.45, rr: 1, risk: 0.2 }, createRng(11));
    const safe = simulate({ ...base, winRate: 0.55, rr: 2, risk: 0.005 }, createRng(11));
    expect(riskOfRuin(reckless.ddFromStart, 0.5)).toBeGreaterThan(riskOfRuin(safe.ddFromStart, 0.5));
  });
});

describe('equityBands', () => {
  it('produces ordered percentile bands p10 <= p50 <= p90', () => {
    const r = simulate({ ...base, winRate: 0.55, rr: 2 }, createRng(4));
    const b = equityBands(r.bandCurves);
    const last = b.labels.length - 1;
    expect(b.p10[last]).toBeLessThanOrEqual(b.p50[last]);
    expect(b.p50[last]).toBeLessThanOrEqual(b.p90[last]);
  });
});
