// THE single source of truth for trade statistics.
// Every PF / expectancy / drawdown / streak in the product comes from here.
//
// Inputs are a flat series of per-trade results (`pnls`). The series can be in
// currency or in R-multiples — ratios (win rate, payoff, profit factor) are
// scale-free; expectancy is returned in whatever unit you pass in.

import { mean } from './stats.js';

export function tradeStats(pnls) {
  const count = pnls.length;
  if (count === 0) {
    return {
      count: 0, wins: 0, losses: 0, scratches: 0,
      winRate: 0, avgWin: 0, avgLoss: 0, payoffRatio: 0,
      profitFactor: 0, expectancy: 0, grossProfit: 0, grossLoss: 0,
    };
  }
  const winVals = pnls.filter((v) => v > 0);
  const lossVals = pnls.filter((v) => v < 0);
  const wins = winVals.length;
  const losses = lossVals.length;
  const grossProfit = winVals.reduce((a, b) => a + b, 0);
  const grossLoss = Math.abs(lossVals.reduce((a, b) => a + b, 0));
  const avgWin = wins ? grossProfit / wins : 0;
  const avgLoss = losses ? grossLoss / losses : 0;

  return {
    count,
    wins,
    losses,
    scratches: count - wins - losses,
    // Win rate over decided trades (excludes exact scratches).
    winRate: wins + losses > 0 ? wins / (wins + losses) : 0,
    avgWin,
    avgLoss,
    // Payoff ratio = avg win / avg loss (the "R:R" the strategy actually realised).
    payoffRatio: avgLoss > 0 ? avgWin / avgLoss : (avgWin > 0 ? Infinity : 0),
    // TRUE profit factor = gross profit / gross loss.
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? Infinity : 0),
    // Expectancy = average result per trade, in input units.
    expectancy: mean(pnls),
    grossProfit,
    grossLoss,
  };
}

// Theoretical expectancy in R from a (winRate, rr) spec: win = +rr, loss = -1.
export function expectancyR(winRate, rr) {
  return winRate * rr - (1 - winRate);
}

// Build an equity curve (array, length n+1) from a per-trade series.
export function equityCurve(pnls, startEquity = 0) {
  const curve = [startEquity];
  let eq = startEquity;
  for (const v of pnls) {
    eq += v;
    curve.push(eq);
  }
  return curve;
}

// Max peak-to-trough drawdown of an equity curve.
// Returns { fraction, absolute } where fraction is relative to the running peak.
export function maxDrawdown(curve) {
  let peak = curve[0] ?? 0;
  let maxAbs = 0;
  let maxFrac = 0;
  for (const eq of curve) {
    if (eq > peak) peak = eq;
    const dd = peak - eq;
    if (dd > maxAbs) maxAbs = dd;
    if (peak > 0) maxFrac = Math.max(maxFrac, dd / peak);
  }
  return { fraction: maxFrac, absolute: maxAbs };
}

// Longest streaks and their distributions (index = streak length, capped).
export function streaks(pnls, cap = 15) {
  let longestWin = 0, longestLoss = 0;
  let curWin = 0, curLoss = 0;
  const winDist = new Array(cap + 1).fill(0);
  const lossDist = new Array(cap + 1).fill(0);
  for (const v of pnls) {
    if (v > 0) {
      curWin++;
      curLoss = 0;
      longestWin = Math.max(longestWin, curWin);
      if (curWin <= cap) winDist[curWin]++;
    } else if (v < 0) {
      curLoss++;
      curWin = 0;
      longestLoss = Math.max(longestLoss, curLoss);
      if (curLoss <= cap) lossDist[curLoss]++;
    }
  }
  return { longestWin, longestLoss, winDist, lossDist };
}
