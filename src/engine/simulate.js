// Monte Carlo simulation core. Pure: (spec, rng) -> results. No DOM.
//
// Two sampling modes:
//   parametric — Bernoulli(winRate): win = +rr R, loss = -1 R
//   empirical  — bootstrap-resample from a real array of R-multiples (journal)
//
// Risk is compounded: each trade risks `risk` fraction of CURRENT equity.
// Costs are charged as `costPerTrade` fraction of current equity, round-trip.

import { maxDrawdown } from './metrics.js';
import { percentile } from './stats.js';

const MAX_BAND_CURVES = 800; // cap stored curves for percentile bands (perf)

/**
 * @param {object} spec
 * @param {number} spec.capital      starting equity
 * @param {number} spec.trades       trades per simulation
 * @param {number} spec.sims         number of simulations
 * @param {number} spec.risk         fraction of equity risked per trade (e.g. 0.01)
 * @param {number} spec.costPerTrade fraction lost to fees+slippage per trade (round-trip)
 * @param {number} [spec.winRate]    parametric win rate (0..1)
 * @param {number} [spec.rr]         parametric reward:risk
 * @param {number[]} [spec.sample]   empirical R-multiples to bootstrap from
 * @param {number} [spec.tradesPerDay] for prop daily-curve chunking
 * @param {() => number} rng
 */
export function simulate(spec, rng) {
  const {
    capital, trades, sims, risk, costPerTrade = 0,
    winRate, rr, sample = null, tradesPerDay = null,
  } = spec;

  const useEmpirical = Array.isArray(sample) && sample.length > 0;
  const sampleN = useEmpirical ? sample.length : 0;

  const returns = new Array(sims);
  const maxDDs = new Array(sims);
  const ddFromStart = new Array(sims); // worst loss relative to STARTING capital (for ruin)
  const finalEquities = new Array(sims);
  const longestLossStreaks = new Array(sims);
  const realizedR = []; // realized R-multiples across all sims (for PF/expectancy)
  const winStreakDist = new Array(16).fill(0);
  const lossStreakDist = new Array(16).fill(0);
  const bandCurves = [];
  const dailyCurves = [];
  const keepEvery = Math.max(1, Math.ceil(sims / MAX_BAND_CURVES));

  for (let s = 0; s < sims; s++) {
    let equity = capital;
    let peak = equity;
    let trough = equity; // lowest equity reached this sim
    let maxDD = 0;
    let winStreak = 0, lossStreak = 0, longestLoss = 0;
    const keepCurve = s % keepEvery === 0;
    const curve = keepCurve ? [equity] : null;

    let daily = null, dayTrades = 0, perDay = 0;
    if (tradesPerDay) {
      daily = [equity];
      perDay = Math.max(1, tradesPerDay);
    }

    for (let t = 0; t < trades; t++) {
      const riskAmt = equity * risk;
      const cost = equity * costPerTrade;

      let r; // result in R-multiples (before costs)
      if (useEmpirical) {
        r = sample[(rng() * sampleN) | 0];
      } else {
        r = rng() < winRate ? rr : -1;
      }

      const pnl = riskAmt * r - cost;
      equity += pnl;
      // Realized R relative to amount risked (pre-trade) — correct denominator.
      if (riskAmt > 0) realizedR.push(pnl / riskAmt);

      if (r > 0) {
        winStreak++; lossStreak = 0;
        if (winStreak <= 15) winStreakDist[winStreak]++;
      } else if (r < 0) {
        lossStreak++; winStreak = 0;
        longestLoss = Math.max(longestLoss, lossStreak);
        if (lossStreak <= 15) lossStreakDist[lossStreak]++;
      }

      if (equity > peak) peak = equity;
      if (equity < trough) trough = equity;
      const dd = (peak - equity) / peak;
      if (dd > maxDD) maxDD = dd;

      if (curve) curve.push(equity);
      if (daily) {
        if (++dayTrades >= perDay) { daily.push(equity); dayTrades = 0; }
      }
      if (equity <= 0) { equity = 0; break; }
    }
    if (daily && dayTrades > 0) daily.push(equity);

    returns[s] = (equity - capital) / capital;
    maxDDs[s] = maxDD;
    ddFromStart[s] = (capital - trough) / capital;
    finalEquities[s] = equity;
    longestLossStreaks[s] = longestLoss;
    if (curve) bandCurves.push(curve);
    if (daily) dailyCurves.push(daily);
  }

  return {
    capital,
    trades,
    sims,
    returns,
    maxDDs,
    ddFromStart,
    finalEquities,
    longestLossStreaks,
    realizedR,
    streaks: { winDist: winStreakDist, lossDist: lossStreakDist },
    bandCurves,
    dailyCurves,
  };
}

// Percentile bands (p10..p90 + median + mean) across stored equity curves,
// aligned by trade index. For the equity fan chart.
export function equityBands(bandCurves) {
  if (!bandCurves.length) return { labels: [], p10: [], p25: [], p50: [], p75: [], p90: [] };
  const maxLen = Math.max(...bandCurves.map((c) => c.length));
  const p10 = [], p25 = [], p50 = [], p75 = [], p90 = [];
  for (let i = 0; i < maxLen; i++) {
    const col = bandCurves.map((c) => c[Math.min(i, c.length - 1)]);
    p10.push(percentile(col, 0.1));
    p25.push(percentile(col, 0.25));
    p50.push(percentile(col, 0.5));
    p75.push(percentile(col, 0.75));
    p90.push(percentile(col, 0.9));
  }
  return { labels: Array.from({ length: maxLen }, (_, i) => i), p10, p25, p50, p75, p90 };
}
