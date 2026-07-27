// Edge degradation over time. Splits a dated trade history into an "early" and
// a "recent" half and asks: is the edge holding, improving, or dying?
// Pure — no DOM, no global state. All statistics come from the engine's
// single source of truth (tradeStats).

import { tradeStats } from '../engine/metrics.js';

// Native per-trade result: prefer explicit R, else PnL (matches analyzeJournal).
const valueOf = (t) => (Number.isFinite(t.r) ? t.r : t.pnl);
const MAX_ROLLING_POINTS = 1_000;

function decimate(values) {
  if (values.length <= MAX_ROLLING_POINTS) return values;
  const step = values.length / MAX_ROLLING_POINTS;
  return Array.from(
    { length: MAX_ROLLING_POINTS },
    (_, index) => values[Math.min(values.length - 1, Math.floor((index + 0.5) * step))],
  );
}

// Robust date parser: ISO / native first, then a fallback for MetaTrader's
// "YYYY.MM.DD HH:MM:SS" (and YYYY/MM/DD, YYYY-MM-DD) which V8 won't parse.
export function parseTradeDate(s) {
  if (s == null || s === '') return null;
  if (s instanceof Date) return Number.isNaN(s.getTime()) ? null : s;
  const native = new Date(s);
  if (!Number.isNaN(native.getTime())) return native;
  const m = String(s).match(
    /(\d{4})[.\/-](\d{1,2})[.\/-](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/,
  );
  if (m) {
    const d = new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

/**
 * @param {Array<{date, pnl, r}>} trades
 * @param {object} [opts]
 * @param {number} [opts.minPeriodTrades=10] rolling-window length
 */
export function analyzeTemporalDrift(trades, { minPeriodTrades = 10 } = {}) {
  const all = (trades || []).filter((t) => Number.isFinite(valueOf(t)));
  // 1. Need usable dates on a meaningful fraction of trades.
  const dated = all
    .map((t) => ({ v: valueOf(t), d: parseTradeDate(t.date) }))
    .filter((x) => x.d != null);
  if (all.length === 0 || dated.length / all.length < 0.2 || dated.length < 4) {
    return { available: false };
  }

  // 2. Sort by date ascending, then split by INDEX (equal trade counts), not
  //    by calendar — so a long quiet stretch can't skew the halves.
  dated.sort((a, b) => a.d - b.d);
  const vals = dated.map((x) => x.v);
  const n = vals.length;
  const half = Math.floor(n / 2);
  const earlyVals = vals.slice(0, half);
  const recentVals = vals.slice(half);
  const earlyStats = tradeStats(earlyVals);
  const recentStats = tradeStats(recentVals);

  // 3. Rolling window — only when there is enough data for it to mean anything.
  const rollingWinRate = [];
  const rollingExpectancy = [];
  const rollingPF = [];
  if (n >= 2 * minPeriodTrades) {
    for (let i = minPeriodTrades; i <= n; i++) {
      const w = tradeStats(vals.slice(i - minPeriodTrades, i));
      rollingWinRate.push(w.winRate);
      rollingExpectancy.push(w.expectancy);
      rollingPF.push(Number.isFinite(w.profitFactor) ? w.profitFactor : 0);
    }
  }

  // 4. Degradation requires BOTH expectancy AND profit factor to deteriorate —
  //    a single metric swinging is noise, not signal.
  const epf = Number.isFinite(earlyStats.profitFactor) ? earlyStats.profitFactor : 0;
  const rpf = Number.isFinite(recentStats.profitFactor) ? recentStats.profitFactor : 0;
  const degrading = earlyStats.expectancy > 0
    && recentStats.expectancy < earlyStats.expectancy * 0.75
    && rpf < epf * 0.8;

  return {
    available: true,
    earlyStats,
    recentStats,
    earlyCount: earlyVals.length,
    recentCount: recentVals.length,
    rolling: {
      winRate: decimate(rollingWinRate),
      expectancy: decimate(rollingExpectancy),
      pf: decimate(rollingPF),
      totalPoints: rollingExpectancy.length,
    },
    degrading,
    trend: {
      expectancyDelta: recentStats.expectancy - earlyStats.expectancy,
      winRateDelta: recentStats.winRate - earlyStats.winRate,
      pfDelta: rpf - epf,
    },
  };
}
