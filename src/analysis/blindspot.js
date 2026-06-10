// Structural bias detection. Finds hidden concentrations in a journal that
// explain the results: direction, instrument, and day-of-week skew.
// Works ONLY from journal data — no external market data. Pure functions.

import { tradeStats } from '../engine/metrics.js';
import { parseTradeDate } from './temporal.js';

const valueOf = (t) => (Number.isFinite(t.r) ? t.r : t.pnl);
const MIN_GROUP = 5;

// Full English weekday names, Sunday-indexed to match Date.getDay().
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * Long vs short skew. Only meaningful for imports that carry `direction`.
 */
export function analyzeDirectionBias(trades) {
  const rows = (trades || []).filter((t) => Number.isFinite(valueOf(t)) && t.direction);
  const longs = rows.filter((t) => t.direction === 'long').map(valueOf);
  const shorts = rows.filter((t) => t.direction === 'short').map(valueOf);
  if (longs.length === 0 && shorts.length === 0) return { available: false };

  const longStats = tradeStats(longs);
  const shortStats = tradeStats(shorts);
  const longProfit = longs.reduce((a, b) => a + b, 0);
  const shortProfit = shorts.reduce((a, b) => a + b, 0);

  const dominantDirection = longProfit >= shortProfit ? 'long' : 'short';
  // Concentration = the dominant side's share of total POSITIVE directional
  // profit. Always in [0,1] (never null), so the UI/finding can show it safely.
  const posLong = Math.max(0, longProfit);
  const posShort = Math.max(0, shortProfit);
  const posTotal = posLong + posShort;
  const dominantProfitShare = posTotal > 0 ? Math.max(posLong, posShort) / posTotal : 0;

  // A blind spot is a side that is BOTH well-sampled and unprofitable.
  let losingDirection = null;
  if (shorts.length >= MIN_GROUP && shortStats.expectancy < 0) losingDirection = 'short';
  else if (longs.length >= MIN_GROUP && longStats.expectancy < 0) losingDirection = 'long';

  return {
    available: longs.length >= MIN_GROUP && shorts.length >= MIN_GROUP,
    long: { stats: longStats, count: longs.length, insufficient: longs.length < MIN_GROUP },
    short: { stats: shortStats, count: shorts.length, insufficient: shorts.length < MIN_GROUP },
    dominantDirection,
    dominantProfitShare,
    losingDirection,
  };
}

/**
 * Per-instrument concentration. Only meaningful for imports carrying `symbol`.
 */
export function analyzeInstrumentBias(trades) {
  const rows = (trades || []).filter((t) => Number.isFinite(valueOf(t)) && t.symbol);
  if (rows.length === 0) return { available: false };

  const groups = new Map();
  for (const t of rows) {
    const arr = groups.get(t.symbol) || [];
    arr.push(valueOf(t));
    groups.set(t.symbol, arr);
  }

  // Only symbols with enough trades to compute trustworthy stats.
  const sized = [...groups.entries()].filter(([, vals]) => vals.length >= MIN_GROUP);
  if (sized.length === 0) {
    return { available: false };
  }

  const totalGross = sized.reduce((a, [, vals]) => a + tradeStats(vals).grossProfit, 0) || 0;
  const bySymbol = sized
    .map(([symbol, vals]) => {
      const stats = tradeStats(vals);
      return {
        symbol,
        count: vals.length,
        stats,
        profitShare: totalGross > 0 ? stats.grossProfit / totalGross : 0,
      };
    })
    .sort((a, b) => b.profitShare - a.profitShare);

  const topSymbol = bySymbol[0];
  const hiddenLosers = bySymbol.filter((s) => s.stats.expectancy < 0 && s.count >= MIN_GROUP);

  return {
    available: true,
    bySymbol,
    // Concentration is only a "blind spot" when there's more than one instrument
    // to spread across — a single-symbol trader is specialized, not concentrated.
    concentrated: bySymbol.length >= 2 && topSymbol.profitShare > 0.6,
    topSymbol: topSymbol.symbol,
    topSymbolShare: topSymbol.profitShare,
    hiddenLosers,
  };
}

/**
 * Day-of-week skew. Works whenever dates are present.
 */
export function analyzeDayOfWeekBias(trades) {
  const rows = (trades || [])
    .filter((t) => Number.isFinite(valueOf(t)))
    .map((t) => ({ v: valueOf(t), d: parseTradeDate(t.date) }))
    .filter((x) => x.d != null);
  if (rows.length === 0) return { available: false };

  const groups = new Map();
  for (const r of rows) {
    const idx = r.d.getDay();
    const arr = groups.get(idx) || [];
    arr.push(r.v);
    groups.set(idx, arr);
  }

  const total = rows.length;
  // Days with enough trades, ordered Monday-first (Mon..Sun).
  const mondayFirst = (idx) => (idx + 6) % 7;
  const byDay = [...groups.entries()]
    .filter(([, vals]) => vals.length >= MIN_GROUP)
    .map(([idx, vals]) => ({
      dayIndex: idx,
      day: DAY_NAMES[idx],
      count: vals.length,
      stats: tradeStats(vals),
    }))
    .sort((a, b) => mondayFirst(a.dayIndex) - mondayFirst(b.dayIndex));

  if (byDay.length === 0) return { available: false };

  const worstDay = byDay.reduce((w, d) => (d.stats.expectancy < w.stats.expectancy ? d : w), byDay[0]);
  const bestDay = byDay.reduce((b, d) => (d.stats.expectancy > b.stats.expectancy ? d : b), byDay[0]);

  return {
    available: true,
    byDay,
    worstDay,
    bestDay,
    // Flag only when the worst day is both negative AND carries real volume.
    toxicDay: worstDay.stats.expectancy < 0 && worstDay.count / total >= 0.1,
  };
}
