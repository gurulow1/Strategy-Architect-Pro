import { describe, it, expect } from 'vitest';
import { parseCsv, analyzeJournal, parseMetaTrader, looksLikeMetaTrader } from '../src/analysis/journal.js';
import { runRobustness } from '../src/analysis/robustness.js';
import { diagnose } from '../src/analysis/diagnose.js';
import { buildReport, recommendPropRisk } from '../src/analysis/report.js';
import { createRng } from '../src/engine/rng.js';
import { tradeStats } from '../src/engine/metrics.js';

describe('journal parsing', () => {
  it('parses a pnl column and computes real stats', () => {
    const csv = 'date,pnl\n2024-01-01,200\n2024-01-02,-100\n2024-01-03,200\n2024-01-04,-100\n2024-01-05,200\n2024-01-06,-100';
    const parsed = parseCsv(csv);
    expect(parsed.error).toBeNull();
    const a = analyzeJournal(parsed);
    expect(a.stats.count).toBe(6);
    expect(a.stats.winRate).toBeCloseTo(0.5, 10);
    expect(a.stats.profitFactor).toBeCloseTo(2, 10); // 600 / 300
  });

  it('uses explicit r_multiple when present', () => {
    const csv = 'pnl,r_multiple\n200,2\n-100,-1\n200,2\n-100,-1\n200,2';
    const parsed = parseCsv(csv);
    const a = analyzeJournal(parsed);
    expect(a.rBasis).toBe('explicit');
    expect(a.rSample).toEqual([2, -1, 2, -1, 2]);
  });

  it('normalizes pnl to R so average loss = 1R when no r column', () => {
    const csv = 'pnl\n200\n-100\n200\n-100\n200';
    const a = analyzeJournal(parseCsv(csv));
    expect(a.rBasis).toBe('normalized');
    // avg loss = 100 -> losses become -1, wins +2
    expect(a.rSample).toEqual([2, -1, 2, -1, 2]);
  });

  it('rejects too-short input', () => {
    expect(parseCsv('pnl').error).toBe('csv_too_short');
    expect(parseCsv('pnl\n1\n2').error).toBe('too_few_trades');
  });
});

describe('MetaTrader 4/5 parsing', () => {
  // Minimal MT5 export shape: account preamble, a Positions table, then an
  // Orders table that duplicates the same fills (and must be ignored).
  function mtRows({ ru = true } = {}) {
    const [pos, ord, time, posCol, sym, type, vol, price, comm, swap, profit] = ru
      ? ['Позиции', 'Ордера', 'Время', 'Позиция', 'Символ', 'Тип', 'Объем', 'Цена', 'Комиссия', 'Своп', 'Прибыль']
      : ['Positions', 'Orders', 'Time', 'Position', 'Symbol', 'Type', 'Volume', 'Price', 'Commission', 'Swap', 'Profit'];
    return [
      ['Отчет торговой истории'],
      ['Счет:', null, null, '52742623'],
      [pos],
      [time, posCol, sym, type, vol, price, 'S / L', 'T / P', time, price, comm, swap, profit],
      ['2026.02.14 01:53', 1001, 'BTCUSD', 'sell', '1', 68794, '', '', '2026.02.15 11:58', 70383, 0, 0, -1589.21],
      ['2026.02.21 03:01', 1002, 'BTCUSD', 'sell', '2', 67836, '', '', '2026.02.23 17:30', 65791, 0, -5, 4091.10],
      ['2026.02.25 01:53', 1003, 'BTCUSD', 'buy', '1', 64070, '', '', '2026.02.25 16:01', 66207, 0, 0, 2136.95],
      ['2026.02.28 09:43', 1004, 'BTCUSD', 'buy', '2', 64144, '', '', '2026.03.01 05:14', 67739, 0, 0, 7189.02],
      ['2026.03.01 19:00', 1005, 'BTCUSD', 'buy', '2', 66193, '', '', '2026.03.02 19:05', 69498, 0, 0, 6609.48],
      // totals/summary row — no symbol/type, must be skipped not counted:
      [null, null, null, null, null, null, null, null, -5, 0, 0, 0, 18437.34],
      [ord], // next table starts — parser must stop here
      [time, 'Ордер', sym, type, vol, price, 'S / L', 'T / P', time, 'Состояние'],
      ['2026.02.14 01:53', 9001, 'BTCUSD', 'sell', '1 / 1', 'market', '', '', '2026.02.14 01:53', 'filled'],
      ['2026.02.15 11:58', 9002, 'BTCUSD', 'buy', '1 / 1', 'market', '', '', '2026.02.15 11:58', 'filled'],
    ];
  }

  it('detects MetaTrader layout by the Positions section label (RU + EN)', () => {
    expect(looksLikeMetaTrader(mtRows({ ru: true }))).toBe(true);
    expect(looksLikeMetaTrader(mtRows({ ru: false }))).toBe(true);
    expect(looksLikeMetaTrader([['date', 'pnl'], ['2024-01-01', '10']])).toBe(false);
  });

  it('parses ONLY the Positions table and ignores Orders/Deals', () => {
    const r = parseMetaTrader(mtRows({ ru: true }));
    expect(r.error).toBeNull();
    expect(r.format).toBe('MetaTrader');
    expect(r.trades.length).toBe(5);          // 5 positions, not the order rows
    expect(r.skipped).toBe(1);                // the totals row
    // net P&L = profit + swap + commission (row 1002 had -5 swap)
    expect(r.trades[1].pnl).toBeCloseTo(4086.10, 5);
    expect(r.trades[0].direction).toBe('short');
    expect(r.trades[2].direction).toBe('long');
  });

  it('feeds analyzeJournal a clean, deterministic sample', () => {
    const r = parseMetaTrader(mtRows({ ru: false }));
    const a = analyzeJournal(r);
    expect(a.count).toBe(5);
    expect(a.stats.count).toBe(5);
  });

  it('aggregates multiple fills of the same position id into one trade', () => {
    const rows = mtRows({ ru: false });
    // duplicate position 1001 (a second fill of the same position)
    rows.splice(5, 0, ['2026.02.14 02:00', 1001, 'BTCUSD', 'sell', '1', 68800, '', '', '2026.02.15 11:58', 70383, 0, 0, -100]);
    const r = parseMetaTrader(rows);
    expect(r.trades.length).toBe(5);          // still 5 unique positions
    expect(r.trades[0].pnl).toBeCloseTo(-1689.21, 5); // -1589.21 + -100
    expect(r.warnings.some((w) => w.id === 'mt_grouped')).toBe(true);
  });
});

describe('robustness', () => {
  it('scores a strong system higher than a marginal one', () => {
    const strong = runRobustness(
      { capital: 10000, trades: 100, risk: 0.01, costPerTrade: 0.001, winRate: 0.6, rr: 2 },
      createRng(1),
    );
    const marginal = runRobustness(
      { capital: 10000, trades: 100, risk: 0.01, costPerTrade: 0.001, winRate: 0.42, rr: 1.2 },
      createRng(1),
    );
    expect(strong.score).toBeGreaterThan(marginal.score);
  });

  it('gives a losing system score 0 and grade fragile', () => {
    const losing = runRobustness(
      { capital: 10000, trades: 100, risk: 0.01, costPerTrade: 0.002, winRate: 0.4, rr: 1 },
      createRng(1),
    );
    expect(losing.score).toBe(0);
    expect(losing.grade).toBe('fragile');
  });

  it('breaking points: win-rate floor sits below the current win rate for a winner', () => {
    const r = runRobustness(
      { capital: 10000, trades: 100, risk: 0.01, costPerTrade: 0, winRate: 0.55, rr: 2 },
      createRng(1),
    );
    // floor for rr=2, no cost: 1/(1+2) = 0.333
    expect(r.breakingPoints.winRateFloor).toBeCloseTo(1 / 3, 5);
    expect(r.breakingPoints.winRateFloor).toBeLessThan(0.55);
  });
});

describe('diagnose', () => {
  it('flags an over-leveraged winning system as a risk with an action', () => {
    const findings = diagnose({
      stats: { winRate: 0.55, payoffRatio: 2, profitFactor: 1.8, expectancy: 0.4, count: 250 },
      sim: { meanReturn: 0.3, medianReturn: 0.25, probProfit: 0.7, medianDD: 0.15, worstDD: 0.3, riskOfRuin: 0.02 },
      kelly: { fStar: 0.1, recommended: 0.05, profitable: true },
      robustness: { score: 65, grade: 'moderate', breakingPoints: { winRateFloor: 0.33, costCeiling: 0.005 }, margins: { winRate: 0.2, rr: 1 } },
      edge: { pAboveZero: 0.97 },
      risk: 0.2, // way over fStar 0.1
    });
    expect(findings.risks.some((r) => r.id === 'overleveraged')).toBe(true);
    expect(findings.actions.some((a) => a.id === 'reduce_risk')).toBe(true);
    expect(findings.strengths.some((s) => s.id === 'positive_expectancy')).toBe(true);
  });

  it('tells a no-edge system not to trade live', () => {
    const findings = diagnose({
      stats: { winRate: 0.4, payoffRatio: 1, profitFactor: 0.8, expectancy: -0.2, count: 50 },
      sim: { meanReturn: -0.2, medianReturn: -0.18, probProfit: 0.3, medianDD: 0.4, worstDD: 0.6, riskOfRuin: 0.2 },
      kelly: { fStar: -0.1, recommended: 0, profitable: false },
      robustness: { score: 0, grade: 'fragile', breakingPoints: { winRateFloor: 0.5, costCeiling: 0 }, margins: { winRate: -0.1, rr: -0.5 } },
      risk: 0.01,
    });
    expect(findings.weaknesses.some((w) => w.id === 'negative_expectancy')).toBe(true);
    expect(findings.actions.some((a) => a.id === 'do_not_trade_live')).toBe(true);
  });
});

describe('buildReport', () => {
  it('produces a complete, deterministic report for a parametric spec', () => {
    const a = buildReport({ winRate: 0.55, rr: 2, risk: 0.01, seed: 7, sims: 500 });
    const b = buildReport({ winRate: 0.55, rr: 2, risk: 0.01, seed: 7, sims: 500 });
    expect(a.sim.meanReturn).toBe(b.sim.meanReturn);
    expect(a.robustness.score).toBeGreaterThan(0);
    expect(a.findings.strengths.length + a.findings.weaknesses.length).toBeGreaterThan(0);
  });

  it('sample size reflects PLANNED trades, not sims×trades (significance bug fix)', () => {
    const r = buildReport({ winRate: 0.55, rr: 2, risk: 0.01, trades: 100, sims: 2000, seed: 7 });
    // Must be 100 (the planned sample), never 200,000.
    expect(r.stats.count).toBe(100);
    // Edge confidence must not be a trivially-certain 100%.
    expect(r.edge.pAboveZero).toBeLessThan(1);
  });

  it('bounds resampling work while reporting the full journal size', () => {
    const sample = Array.from({ length: 10_000 }, (_, index) => (index % 3 ? 1 : -1));
    const stats = tradeStats(sample);
    const r = buildReport({
      sample,
      realStats: stats,
      winRate: stats.winRate,
      rr: stats.payoffRatio,
      risk: 0.005,
      trades: 500,
      observedTrades: sample.length,
      sims: 20,
      seed: 9,
    });
    expect(r.dataQuality).toMatchObject({
      observedTrades: 10_000,
      simulationTrades: 500,
      simulationHorizonCapped: true,
      statisticalSampleUsed: 2_000,
      statisticalSampleAvailable: 10_000,
    });
    expect(r.stats.count).toBe(10_000);
  });
});

describe('recommendPropRisk', () => {
  it('returns a ladder and a recommended risk within the tested levels', () => {
    const { ladder, recommended } = recommendPropRisk(
      { trades: 100, propDays: 20, cost: 0.001, winRate: 0.55, rr: 2 },
      { capital: 100000, dailyLossLimit: 0.05, maxLossLimit: 0.10, profitTarget: 0.10, trailing: false },
      { seed: 3, sims: 300 },
    );
    expect(ladder.length).toBeGreaterThan(3);
    expect(ladder.map((l) => l.risk)).toContain(recommended.risk);
    expect(recommended.passRate).toBeGreaterThanOrEqual(0);
  });
});
