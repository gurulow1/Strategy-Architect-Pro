// Behavioral pattern analysis from real trade records.
// Pure: no DOM, no side effects. Requires tradeRecords with date fields.
//
// Everything here is derived from the actual sequence and timestamps of trades —
// never invented. Patterns are only reported once they clear a minimum sample
// size, so a "stop signal" or hour heatmap reflects signal, not noise.

import { mean } from '../engine/stats.js';
import { tradeStats } from '../engine/metrics.js';

// Per-trade outcome in native units: prefer currency PnL, fall back to R.
// (An explicit-R journal may carry r but null pnl.)
function nativeVal(t) {
  if (Number.isFinite(t.pnl)) return t.pnl;
  if (Number.isFinite(t.r)) return t.r;
  return 0;
}

// After exactly N consecutive losing trades, how often is the NEXT trade a win?
// Walks the sequence once per N, recording the outcome that immediately follows
// a run of exactly N losses.
function winRateAfterLosses(values, n) {
  let consecutive = 0;
  const observations = [];
  for (const v of values) {
    if (consecutive === n) observations.push(v > 0 ? 1 : 0);
    if (v < 0) consecutive++;
    else consecutive = 0;
  }
  return { nextWR: mean(observations), sampleSize: observations.length };
}

/**
 * @param {Array<{date:string|null, pnl:number, r:number|null, direction?:string, symbol?:string}>} trades
 * @returns {PsychologyReport}
 */
export function analyzePsychology(trades) {
  const list = Array.isArray(trades) ? trades : [];
  const values = list.map(nativeVal);
  const base = tradeStats(values);
  const baseWR = base.winRate;

  // ── After N consecutive losses → next-trade win rate ────────────────────────
  const afterLoss = [1, 2, 3].map((n) => {
    const { nextWR, sampleSize } = winRateAfterLosses(values, n);
    return { after: n, nextWR, sampleSize };
  });

  // ── Stop signal — first N whose post-loss WR drops materially below base ─────
  // Requires a meaningful sample (>= 5) and a >15% relative WR drop.
  let stopSignal = null;
  for (const row of afterLoss) {
    if (row.sampleSize >= 5 && baseWR > 0
        && (baseWR - row.nextWR) / baseWR > 0.15) {
      stopSignal = {
        triggered: true,
        after: row.after,
        baseWR,
        nextWR: row.nextWR,
        dropPct: (baseWR - row.nextWR) / baseWR,
      };
      break;
    }
  }

  // ── Hour-of-day heatmap (only when timestamps carry a parseable hour) ────────
  const byHour = new Map();
  for (let i = 0; i < list.length; i++) {
    const raw = list[i].date;
    if (!raw) continue;
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) continue;
    const hour = d.getHours();
    if (!byHour.has(hour)) byHour.set(hour, []);
    byHour.get(hour).push(values[i]);
  }
  const hasDatetime = byHour.size > 0;
  const heatmap = [...byHour.entries()]
    .filter(([, vals]) => vals.length >= 2)
    .map(([hour, vals]) => ({
      hour,
      avgPnl: mean(vals),
      count: vals.length,
      wr: vals.filter((v) => v > 0).length / vals.length,
    }))
    .sort((a, b) => a.hour - b.hour);

  return { afterLoss, heatmap, stopSignal, hasDatetime };
}
