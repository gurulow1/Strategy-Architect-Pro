// Analysis orchestrator. Assembles raw engine output into ONE consolidated
// report consumed by both the UI and the diagnostics generator. This is where
// "run the simulations" lives — the UI never touches the engine directly.

import { simulate, equityBands } from '../engine/simulate.js';
import { tradeStats } from '../engine/metrics.js';
import { kellySizing } from '../engine/kelly.js';
import { riskOfRuin, ruinProfile } from '../engine/riskOfRuin.js';
import { evaluatePropChallenge } from '../engine/propChallenge.js';
import { mean, median, percentile, bootstrapMeanCI } from '../engine/stats.js';
import { createRng } from '../engine/rng.js';
import { runRobustness } from './robustness.js';
import { diagnose } from './diagnose.js';
import { analyzeTemporalDrift } from './temporal.js';
import { analyzeDirectionBias, analyzeInstrumentBias, analyzeDayOfWeekBias } from './blindspot.js';
import { analyzeSkillVsLuck } from './skillLuck.js';

// Summarize a finished simulation into UI-ready metrics.
function summarizeSim(res, ruinThreshold) {
  return {
    meanReturn: mean(res.returns),
    medianReturn: median(res.returns),
    p10Return: percentile(res.returns, 0.1),
    p90Return: percentile(res.returns, 0.9),
    probProfit: res.returns.filter((x) => x > 0).length / res.returns.length,
    medianDD: median(res.maxDDs),
    worstDD: Math.max(...res.maxDDs),
    riskOfRuin: riskOfRuin(res.ddFromStart, ruinThreshold),
    ruinProfile: ruinProfile(res.ddFromStart),
  };
}

/**
 * Full report from a parametric strategy spec (Quick Check) or empirical sample
 * (Journal Analysis — pass `sample`).
 */
export function buildReport(input) {
  const {
    winRate, rr, risk, capital = 10000, trades = 100, sims = 2000,
    cost = 0, kellyMode = 'half', fixedFraction = null,
    ruinThreshold = 0.5, seed = 1, sample = null,
    // Journal supplies real stats; parametric derives them from the sim.
    realStats = null,
    // Raw journal trades ({ date, pnl, r, direction?, symbol? }) — enables the
    // Edge Integrity analyses. `trades` above stays the planned trade COUNT.
    tradeRecords = null,
  } = input;

  const rng = createRng(seed >>> 0);
  const spec = {
    capital, trades, sims, risk, costPerTrade: cost,
    winRate, rr, sample,
  };
  const res = simulate(spec, rng);

  // Stats VALUES (PF, expectancy, win rate) come from the aggregate of all
  // realized trades — accurate, low-noise. But the SAMPLE SIZE must be the
  // number of trades the strategy actually has (real journal) or plans to take
  // (parametric), never sims×trades. Otherwise significance is meaningless.
  const aggStats = realStats || tradeStats(res.realizedR);
  const stats = realStats ? realStats : { ...aggStats, count: trades };

  // Effective WR/RR used for Kelly & robustness (journal-derived if present).
  const effWinRate = realStats ? realStats.winRate : winRate;
  const effRr = realStats ? realStats.payoffRatio : rr;

  const kelly = kellySizing(effWinRate, effRr, kellyMode, fixedFraction);
  const sim = summarizeSim(res, ruinThreshold);

  const robustness = runRobustness(
    { capital, trades, risk, costPerTrade: cost, winRate: effWinRate, rr: effRr },
    createRng((seed >>> 0) + 1),
  );

  // Statistical significance of the edge. For a real journal, bootstrap the
  // actual trades. For a parametric spec, bootstrap a SINGLE representative path
  // of `trades` trades — so confidence honestly reflects the planned sample size,
  // not the millions of trades simulated across all paths.
  const edgeSample = sample && sample.length ? sample : res.realizedR.slice(0, trades);
  const edge = bootstrapMeanCI(edgeSample, createRng((seed >>> 0) + 2), { iterations: 1500 });

  // ── Edge Integrity — only from a REAL journal with enough trades. ───────────
  // Pure parametric specs (Quick Check) have no per-trade records, so these stay
  // null and the UI section is skipped entirely.
  let temporal = null;
  let blindspots = null;
  let skillLuck = null;
  if (Array.isArray(tradeRecords) && tradeRecords.length >= 20) {
    temporal = analyzeTemporalDrift(tradeRecords);
    blindspots = {
      direction: analyzeDirectionBias(tradeRecords),
      instrument: analyzeInstrumentBias(tradeRecords),
      dayOfWeek: analyzeDayOfWeekBias(tradeRecords),
    };
    skillLuck = analyzeSkillVsLuck(edgeSample, stats, (seed >>> 0) + 3);
  }

  const findings = diagnose({
    stats, sim, kelly, robustness, edge,
    risk, cost, temporal, blindspots, skillLuck,
  });

  return {
    spec, stats, sim, kelly, robustness, edge, findings,
    bands: equityBands(res.bandCurves),
    streaks: res.streaks,
    returns: res.returns,
    maxDDs: res.maxDDs,
    effWinRate, effRr,
    temporal, blindspots, skillLuck,
  };
}

// Sweep risk levels for a prop challenge and recommend the best.
// Returns a ladder + the recommended risk (max pass rate, tie-break = fewer violations).
export function recommendPropRisk(base, rules, { seed = 1, sims = 1500, riskLevels } = {}) {
  const levels = riskLevels || [0.0025, 0.005, 0.0075, 0.01, 0.0125, 0.015, 0.02, 0.025, 0.03];
  const tradesPerDay = Math.max(1, Math.round(base.trades / base.propDays));

  const ladder = levels.map((risk, i) => {
    const rng = createRng((seed >>> 0) + i * 101 + 17);
    const res = simulate(
      {
        capital: rules.capital, trades: base.trades, sims, risk,
        costPerTrade: base.cost, winRate: base.winRate, rr: base.rr,
        sample: base.sample || null, tradesPerDay,
      },
      rng,
    );
    const ev = evaluatePropChallenge(res.dailyCurves, rules);
    return { risk, ...ev };
  });

  const best = ladder.reduce((b, row) => {
    if (row.passRate > b.passRate + 1e-9) return row;
    if (Math.abs(row.passRate - b.passRate) < 1e-9) {
      const rowViol = row.dailyViolationRate + row.maxViolationRate;
      const bViol = b.dailyViolationRate + b.maxViolationRate;
      if (rowViol < bViol) return row;
    }
    return b;
  }, ladder[0]);

  return { ladder, recommended: best };
}
