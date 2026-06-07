// Journal parsing + analysis. Turns a raw CSV trade history into:
//   - real trade statistics (via the engine's single source of truth)
//   - a normalized R-multiple sample the simulator can bootstrap from
//
// Accepted columns (case-insensitive, any order):
//   pnl         required — per-trade profit/loss (currency or R)
//   r / r_multiple   optional — per-trade result in R; preferred for sampling
//   date        optional — used only for ordering if present

import { tradeStats, equityCurve, maxDrawdown, streaks } from '../engine/metrics.js';

export function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length);
  if (lines.length < 2) {
    return { error: 'csv_too_short', trades: [] };
  }
  const headers = splitRow(lines[0]).map((h) => h.trim().toLowerCase());
  const pnlIdx = headers.indexOf('pnl');
  const rIdx = headers.findIndex((h) => h === 'r' || h === 'r_multiple' || h === 'rmultiple');
  const dateIdx = headers.indexOf('date');
  if (pnlIdx < 0 && rIdx < 0) {
    return { error: 'no_pnl_column', trades: [] };
  }

  const trades = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = splitRow(lines[i]);
    const pnl = pnlIdx >= 0 ? parseFloat(cols[pnlIdx]) : NaN;
    const r = rIdx >= 0 ? parseFloat(cols[rIdx]) : NaN;
    const date = dateIdx >= 0 ? (cols[dateIdx] || '').trim() : null;
    if (Number.isNaN(pnl) && Number.isNaN(r)) continue;
    trades.push({
      date,
      pnl: Number.isNaN(pnl) ? null : pnl,
      r: Number.isNaN(r) ? null : r,
    });
  }
  if (trades.length < 5) return { error: 'too_few_trades', trades };
  return { error: null, trades, hasR: rIdx >= 0, hasDate: dateIdx >= 0 };
}

// Minimal CSV row splitter that tolerates simple quoted fields.
function splitRow(line) {
  const out = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') inQ = !inQ;
    else if (ch === ',' && !inQ) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

/**
 * Analyze parsed trades. Produces stats on the native series plus a normalized
 * R-multiple sample for Monte Carlo.
 *
 * If explicit R-multiples exist, they are used directly. Otherwise R is derived
 * from PnL by normalizing so the AVERAGE LOSS equals 1R — the standard way to
 * put a currency journal onto an R footing.
 */
export function analyzeJournal(parsed) {
  const trades = parsed.trades;
  // Native per-trade series: prefer explicit R, else PnL.
  const native = trades.map((t) => (t.r != null ? t.r : t.pnl));
  const stats = tradeStats(native);

  // Build the R-multiple sample for the simulator.
  let rSample;
  let rBasis;
  const explicitR = trades.every((t) => t.r != null) && trades.some((t) => t.r != null);
  if (explicitR) {
    rSample = trades.map((t) => t.r);
    rBasis = 'explicit';
  } else {
    const losses = native.filter((v) => v < 0).map((v) => Math.abs(v));
    const avgLoss = losses.length ? losses.reduce((a, b) => a + b, 0) / losses.length : 1;
    const unit = avgLoss > 0 ? avgLoss : 1;
    rSample = native.map((v) => v / unit);
    rBasis = 'normalized';
  }

  const curve = equityCurve(native, 0);
  const dd = maxDrawdown(equityCurve(native, Math.max(1, Math.abs(stats.grossLoss) * 2 + stats.grossProfit)));
  const st = streaks(native);

  return {
    stats,
    rSample,
    rBasis,
    equity: curve,
    maxDrawdownR: dd.absolute,
    longestWinStreak: st.longestWin,
    longestLossStreak: st.longestLoss,
    streakDist: { winDist: st.winDist, lossDist: st.lossDist },
    count: trades.length,
  };
}
