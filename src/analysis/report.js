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
import { analyzePsychology } from './psychology.js';

// Summarize a finished simulation into UI-ready metrics.
function summarizeSim(res, ruinThreshold) {
  return {
    meanReturn: mean(res.returns),
    medianReturn: median(res.returns),
    p10Return: percentile(res.returns, 0.1),
    p25Return: percentile(res.returns, 0.25),
    p75Return: percentile(res.returns, 0.75),
    p90Return: percentile(res.returns, 0.9),
    probProfit: res.returns.filter((x) => x > 0).length / res.returns.length,
    medianDD: median(res.maxDDs),
    worstDD: Math.max(...res.maxDDs),
    riskOfRuin: riskOfRuin(res.ddFromStart, ruinThreshold),
    ruinProfile: ruinProfile(res.ddFromStart),
  };
}

// When PnL was normalized to R (no explicit R column), the raw payoffRatio is
// inflated by the normalization factor. Recompute win rate / RR from the same
// clipped sample the simulation used, so Kelly stays consistent with the sim.
function clippedStats(sample) {
  if (!Array.isArray(sample) || sample.length === 0) return null;
  const wins = sample.filter((v) => v > 0);
  const losses = sample.filter((v) => v < 0);
  if (!wins.length || !losses.length) return null;
  const avgWin = wins.reduce((a, b) => a + b, 0) / wins.length;
  const avgLoss = Math.abs(losses.reduce((a, b) => a + b, 0) / losses.length);
  return {
    winRate: wins.length / sample.length,
    payoffRatio: avgLoss > 0 ? avgWin / avgLoss : 0,
  };
}

/**
 * Strategy health signal. Summarizes all analyses into one color.
 * GREEN = trade normally. YELLOW = reduce risk. RED = stop and review.
 * Handles null skillLuck / temporal / findings gracefully (Quick Check path).
 * @returns {{ color: 'green'|'yellow'|'red', textKey: string }}
 */
export function strategyStatus(report) {
  const { sim, temporal, skillLuck, findings } = report;

  // RED: objective evidence of failure
  const hasLuckFinding = findings?.risks?.some((f) => f.id === 'luck_not_skill')
    || findings?.weaknesses?.some((f) => f.id === 'luck_not_skill');
  const ruinHigh = sim?.riskOfRuin > 0.25;
  const degradingBad = temporal?.degrading && ruinHigh;
  if (hasLuckFinding || degradingBad) {
    return { color: 'red', textKey: 'status_red' };
  }

  // GREEN: strong evidence the edge is real AND stable
  const skillConfirmed = skillLuck?.verdict === 'strong';
  const stable = !temporal?.degrading;
  const ruinLow = sim?.riskOfRuin < 0.10;
  if (skillConfirmed && stable && ruinLow) {
    return { color: 'green', textKey: 'status_green' };
  }

  // YELLOW: everything else (degrading but ruin ok, or p-value borderline)
  return { color: 'yellow', textKey: 'status_yellow' };
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
    // How the journal sample was derived: 'explicit' R column vs PnL 'normalized'
    // to R. When normalized, per-trade values read more honestly in currency.
    rBasis = null,
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
  // For normalized journals (no explicit R column), realStats.payoffRatio is
  // avgWin/avgLoss in raw currency — inflated by the normalization factor and
  // inconsistent with the ±10R-clipped sample the sim actually ran on. Derive
  // Kelly's RR from the clipped sample so the recommendation matches the sim.
  const kellyStats = (rBasis === 'normalized' && sample && sample.length)
    ? clippedStats(sample)
    : null;
  const effRr = kellyStats ? kellyStats.payoffRatio : (realStats ? realStats.payoffRatio : rr);

  const kelly = kellySizing(
    kellyStats ? kellyStats.winRate : effWinRate,
    effRr,
    kellyMode,
    fixedFraction,
  );
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
  let psychology = null;
  if (Array.isArray(tradeRecords) && tradeRecords.length >= 20) {
    temporal = analyzeTemporalDrift(tradeRecords);
    blindspots = {
      direction: analyzeDirectionBias(tradeRecords),
      instrument: analyzeInstrumentBias(tradeRecords),
      dayOfWeek: analyzeDayOfWeekBias(tradeRecords),
    };
    skillLuck = analyzeSkillVsLuck(edgeSample, stats, (seed >>> 0) + 3);
    psychology = analyzePsychology(tradeRecords);
  }

  const findings = diagnose({
    stats, sim, kelly, robustness, edge,
    risk, cost, temporal, blindspots, skillLuck, psychology,
  });

  // One-glance health signal, assembled once every analysis is in hand.
  const status = strategyStatus({ sim, temporal, skillLuck, findings });

  return {
    spec, stats, sim, kelly, robustness, edge, findings, status,
    bands: equityBands(res.bandCurves),
    streaks: res.streaks,
    returns: res.returns,
    maxDDs: res.maxDDs,
    effWinRate, effRr,
    temporal, blindspots, skillLuck, psychology,
    // Per-trade values are most honest in currency when PnL was normalized to R
    // (a MetaTrader journal with no R column). Otherwise R is the native unit.
    displayUnit: sample && rBasis === 'normalized' ? 'currency' : 'R',
    currencySymbol: '$',
    // Server-side actions the client may fire (e.g. Telegram alert on degradation).
    alerts: temporal?.degrading ? ['degradation'] : [],
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
