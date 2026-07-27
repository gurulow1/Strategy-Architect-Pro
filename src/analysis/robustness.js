// Robustness analysis — the product's flagship answer to "how fragile is it?"
//
// We take the strategy's baseline (winRate, rr, risk, cost) and deliberately
// make execution WORSE along the axes a trader actually decays on: lower win
// rate, worse reward, higher fees/slippage. Then we measure how much edge
// survives and where it breaks.
//
// Scoring uses NET expectancy in R (closed form, fast and stable); the per-
// scenario return/drawdown shown to the user come from real simulations.

import { expectancyR } from '../engine/metrics.js';
import { simulate } from '../engine/simulate.js';
import { median } from '../engine/stats.js';

// Net expectancy per trade, in R, after execution costs.
// cost is a fraction of equity per trade; risk is a fraction of equity per trade,
// so cost expressed in R = cost / risk.
function netExpectancyR(winRate, rr, risk, costPerTrade) {
  const gross = expectancyR(winRate, rr);
  const costR = risk > 0 ? costPerTrade / risk : 0;
  return gross - costR;
}

// The stress battery. Each scenario degrades the baseline.
function buildScenarios(base) {
  const { winRate, rr, costPerTrade } = base;
  return [
    { id: 'wr_down_3', winRate: winRate - 0.03, rr, costPerTrade },
    { id: 'wr_down_5', winRate: winRate - 0.05, rr, costPerTrade },
    { id: 'rr_down_15', winRate, rr: rr * 0.85, costPerTrade },
    { id: 'fees_up', winRate, rr, costPerTrade: costPerTrade + 0.001 },
    { id: 'slippage_2x', winRate, rr, costPerTrade: costPerTrade * 2 + 0.0005 },
    {
      id: 'bad_day',
      winRate: winRate - 0.05,
      rr: rr * 0.85,
      costPerTrade: costPerTrade * 2 + 0.0005,
    },
  ];
}

export function runRobustness(base, rng, { scenarioSims = 400 } = {}) {
  const baseNet = netExpectancyR(base.winRate, base.rr, base.risk, base.costPerTrade);
  const baseProfitable = baseNet > 0;

  const scenarios = buildScenarios(base).map((sc) => {
    const spec = {
      capital: base.capital,
      trades: base.trades,
      sims: scenarioSims,
      risk: base.risk,
      costPerTrade: Math.max(0, sc.costPerTrade),
      winRate: Math.max(0.01, Math.min(0.99, sc.winRate)),
      rr: Math.max(0.1, sc.rr),
      collectRealizedR: false,
      collectBandCurves: false,
    };
    const res = simulate(spec, rng);
    const meanReturn = res.returns.reduce((a, b) => a + b, 0) / res.returns.length;
    const netE = netExpectancyR(spec.winRate, spec.rr, spec.risk, spec.costPerTrade);
    return {
      id: sc.id,
      winRate: spec.winRate,
      rr: spec.rr,
      costPerTrade: spec.costPerTrade,
      meanReturn,
      medianDrawdown: median(res.maxDDs),
      netExpectancyR: netE,
      stillProfitable: netE > 0,
    };
  });

  // --- Breaking points (closed form, costs included) ---
  // Win-rate floor: WR where net expectancy hits 0 at current rr & cost.
  const costR = base.risk > 0 ? base.costPerTrade / base.risk : 0;
  // wr*rr - (1-wr) - costR = 0  ->  wr = (1 + costR) / (1 + rr)
  const winRateFloor = (1 + costR) / (1 + base.rr);
  // RR floor: rr where net expectancy hits 0 at current WR & cost.
  // wr*rr - (1-wr) - costR = 0 -> rr = (1 - wr + costR) / wr
  const rrFloor = base.winRate > 0 ? (1 - base.winRate + costR) / base.winRate : Infinity;
  // Cost ceiling: cost (as fraction of equity) at which edge vanishes.
  const costCeiling = Math.max(0, expectancyR(base.winRate, base.rr) * base.risk);

  // --- Score ---
  const survived = scenarios.filter((s) => s.stillProfitable).length / scenarios.length;
  const retention = baseProfitable
    ? Math.max(0, Math.min(1,
        scenarios.reduce((a, s) => a + Math.max(0, s.netExpectancyR), 0) /
        (scenarios.length * baseNet)))
    : 0;
  const wrMargin = base.winRate > 0 ? Math.max(0, Math.min(1, (base.winRate - winRateFloor) / base.winRate)) : 0;
  const rrMargin = base.rr > 0 ? Math.max(0, Math.min(1, (base.rr - rrFloor) / base.rr)) : 0;
  const marginComponent = (wrMargin + rrMargin) / 2;

  const score = baseProfitable
    ? Math.round(100 * (0.5 * survived + 0.3 * retention + 0.2 * marginComponent))
    : 0;

  const worstCase = scenarios.reduce((w, s) => (s.meanReturn < w.meanReturn ? s : w), scenarios[0]);

  return {
    baseline: { netExpectancyR: baseNet, profitable: baseProfitable },
    scenarios,
    breakingPoints: { winRateFloor, rrFloor, costCeiling },
    margins: { winRate: base.winRate - winRateFloor, rr: base.rr - rrFloor },
    score,
    grade: gradeFor(score, baseProfitable),
    worstCase,
  };
}

function gradeFor(score, profitable) {
  if (!profitable) return 'fragile';
  if (score >= 75) return 'robust';
  if (score >= 50) return 'moderate';
  if (score >= 30) return 'thin';
  return 'fragile';
}
