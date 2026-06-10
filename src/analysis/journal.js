// Journal parsing + analysis. Turns a raw CSV trade history into:
//   - real trade statistics (via the engine's single source of truth)
//   - a normalized R-multiple sample the simulator can bootstrap from
//
// Accepted columns (case-insensitive, any order):
//   pnl         required — per-trade profit/loss (currency or R)
//   r / r_multiple   optional — per-trade result in R; preferred for sampling
//   date        optional — used only for ordering if present

import { tradeStats, equityCurve, maxDrawdown, streaks } from '../engine/metrics.js';

// Column-name hints (EN + RU) used to (a) locate the real header row when an
// export has title/preamble lines before it, and (b) skip repeated header rows.
const HEADER_HINTS = [
  'instrument', 'инструмент', 'symbol', 'ticker', 'pair',
  'date', 'дата', 'time', 'время', 'open', 'close',
  'pnl', 'p/l', 'p&l', 'profit', 'прибыль', 'loss', 'результат',
  'direction', 'type', 'side', 'order', 'ticket',
  'volume', 'size', 'lot', 'lots', 'qty', 'quantity',
  'r_multiple', 'rmultiple', 'r-multiple',
];

// A row "looks like a header" if any cell is (or contains) a known column name.
// Used to skip repeated header blocks mid-file without counting them as errors.
function isHeaderLike(cells) {
  const lc = cells.map((c) => c.trim().toLowerCase()).filter(Boolean);
  if (!lc.length) return false;
  return lc.some((c) => HEADER_HINTS.includes(c)
    || HEADER_HINTS.some((h) => h.length > 2 && c.includes(h)));
}

// Find the row that defines the data columns: the first row naming a
// pnl/profit OR r-multiple column (date is a weaker fallback). Scans the first
// 20 lines so leading title/preamble rows (MT4/MT5, ATAS) are skipped.
function findHeaderRow(rows) {
  const limit = Math.min(rows.length, 20);
  for (let i = 0; i < limit; i++) {
    const lc = rows[i].map((c) => c.trim().toLowerCase());
    const hasPnl = lc.some((c) =>
      c === 'pnl' || c === 'profit' || c === 'p/l' || c === 'p&l'
      || c.includes('profit') || c.includes('прибыль'));
    const hasR = lc.some((c) =>
      c === 'r' || c === 'r_multiple' || c === 'rmultiple' || c === 'r-multiple');
    const hasDate = lc.some((c) =>
      c === 'date' || c.includes('дата') || c.includes('time') || c.includes('время'));
    if (hasPnl || hasR || (hasDate && lc.length > 1)) return i;
  }
  return 0;
}

// Robust numeric parser: tolerates currency symbols, unit suffixes, spaces,
// thousands separators, European decimal commas, and (parenthesised) negatives.
// Returns NaN for anything non-numeric so callers can skip the row.
function toNum(raw) {
  if (raw == null) return NaN;
  let s = String(raw).trim();
  if (!s) return NaN;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); } // (123) → -123
  s = s.replace(/[^\d.,+\-eE]/g, '');                         // drop $, %, lots, spaces
  if (s.includes(',') && s.includes('.')) {
    s = s.replace(/,/g, '');                                  // 1,234.56 → 1234.56
  } else if (s.includes(',')) {
    const parts = s.split(',');
    s = (parts.length === 2 && parts[1].length <= 2)
      ? `${parts[0]}.${parts[1]}`                             // 12,5 → 12.5 (decimal comma)
      : s.replace(/,/g, '');                                  // 1,234 → 1234 (thousands)
  }
  const n = parseFloat(s);
  if (!Number.isFinite(n)) return NaN;
  return neg ? -n : n;
}

// Detect the field delimiter from the busiest of the first few lines.
// Supports comma (default), semicolon (European exports) and tab (TSV).
function detectDelimiter(lines) {
  const sample = lines.slice(0, 5).join('\n');
  const counts = { ',': 0, ';': 0, '\t': 0 };
  for (const ch of sample) if (ch in counts) counts[ch]++;
  let best = ',';
  for (const d of [';', '\t']) if (counts[d] > counts[best]) best = d;
  return best;
}

export function parseCsv(text) {
  const lines = (text ?? '').split(/\r?\n/).filter((l) => l.trim().length);
  if (lines.length < 2) {
    return { error: 'csv_too_short', trades: [], warnings: [], skipped: 0 };
  }

  const delim = detectDelimiter(lines);
  const rows = lines.map((l) => splitRow(l, delim));
  const headerIdx = findHeaderRow(rows);
  const headers = rows[headerIdx].map((h) => h.trim().toLowerCase());

  const pnlIdx = headers.indexOf('pnl') >= 0
    ? headers.indexOf('pnl')
    : headers.findIndex((h) =>
        h === 'profit' || h === 'p/l' || h === 'p&l' || h.includes('profit') || h.includes('прибыль'));
  const rIdx = headers.findIndex((h) =>
    h === 'r' || h === 'r_multiple' || h === 'rmultiple' || h === 'r-multiple');
  const dateIdx = headers.indexOf('date') >= 0
    ? headers.indexOf('date')
    : headers.findIndex((h) => h.includes('дата') || h.includes('time') || h.includes('время'));

  if (pnlIdx < 0 && rIdx < 0) {
    return { error: 'no_pnl_column', trades: [], warnings: [], skipped: 0 };
  }

  const trades = [];
  let skipped = 0;
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const cols = rows[i];
    if (!cols.length || cols.every((c) => !c.trim())) continue;   // blank row
    if (isHeaderLike(cols)) continue;                             // repeated header — skip silently

    const pnl = pnlIdx >= 0 ? toNum(cols[pnlIdx]) : NaN;
    const r = rIdx >= 0 ? toNum(cols[rIdx]) : NaN;
    const date = dateIdx >= 0 ? (cols[dateIdx] || '').trim() : null;

    // Critical fields missing/non-numeric → skip the row, don't crash the run.
    if (!Number.isFinite(pnl) && !Number.isFinite(r)) { skipped++; continue; }

    trades.push({
      date,
      pnl: Number.isFinite(pnl) ? pnl : null,
      r: Number.isFinite(r) ? r : null,
    });
  }

  const warnings = skipped > 0 ? [{ id: 'skipped_rows', vars: { n: skipped } }] : [];
  if (trades.length < 5) return { error: 'too_few_trades', trades, warnings, skipped };
  return { error: null, trades, hasR: rIdx >= 0, hasDate: dateIdx >= 0, warnings, skipped };
}

// Minimal CSV row splitter: tolerates quoted fields, a configurable delimiter,
// and a leading UTF-8 BOM. Defaults to comma for backward compatibility.
function splitRow(line, delim = ',') {
  const out = [];
  let cur = '', inQ = false;
  const src = line.charCodeAt(0) === 0xFEFF ? line.slice(1) : line; // strip UTF-8 BOM
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch === '"') inQ = !inQ;
    else if (ch === delim && !inQ) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// MetaTrader 4/5 history reports
//
// MT4/MT5 "trade history" exports (XLSX, or HTML saved as XLSX) stack up to three
// tables in a single sheet, each introduced by a one-cell section label:
//   Позиции / Positions — one row per CLOSED position, PnL already aggregated
//   Ордера  / Orders    — individual orders (duplicate the same fills)
//   Сделки  / Deals     — in/out deal legs (also duplicate the same fills)
// We parse ONLY the Positions table, so a position filled by several orders is
// still counted as ONE trade — matching the broker's own "total trades" figure.
// Orders/Deals are intentionally ignored to avoid double-counting, which is what
// made the generic CSV path report a different (and wrong) trade count each run.

const MT_SECTIONS = {
  positions: ['позиции', 'positions'],
  orders: ['ордера', 'orders'],
  deals: ['сделки', 'deals'],
};

const cellStr = (v) => (v == null ? '' : String(v).trim());
const cellLow = (v) => cellStr(v).toLowerCase();

// A "section label" row is a single non-empty cell whose text is a known heading.
function matchesSection(cells, keys) {
  if (!Array.isArray(cells)) return false;
  const nonEmpty = cells.map(cellLow).filter(Boolean);
  return nonEmpty.length === 1 && keys.includes(nonEmpty[0]);
}

// Quick detector so the UI can pick the deterministic MT path over the AI path.
export function looksLikeMetaTrader(rows) {
  return Array.isArray(rows)
    && rows.some((r) => matchesSection(r, MT_SECTIONS.positions));
}

// Split raw delimited text into a 2D array (blank lines preserved so single-cell
// section labels stay detectable). Mirrors parseCsv's own row splitting.
export function rowsFromCsv(text) {
  const lines = (text ?? '').split(/\r?\n/);
  const delim = detectDelimiter(lines.filter((l) => l.trim().length));
  return lines.map((l) => splitRow(l, delim));
}

const headerHasAny = (h, keys) => keys.some((k) => h.includes(k));

// Map the Positions header to column indices (RU + EN headers supported).
// "Время"/"Time" and "Цена"/"Price" each appear twice — first = open, second = close.
function mapPositionColumns(header) {
  const col = {
    id: -1, openTime: -1, closeTime: -1, symbol: -1, type: -1,
    size: -1, entry: -1, exit: -1, commission: -1, swap: -1, pnl: -1,
  };
  let times = 0;
  let prices = 0;
  header.forEach((raw, i) => {
    const h = cellLow(raw);
    if (!h) return;
    if (headerHasAny(h, ['время', 'time'])) {
      if (times++ === 0) col.openTime = i; else if (col.closeTime < 0) col.closeTime = i;
    } else if (headerHasAny(h, ['позиция', 'position', 'тикет', 'ticket'])) col.id = i;
    else if (headerHasAny(h, ['символ', 'symbol'])) col.symbol = i;
    else if (headerHasAny(h, ['тип', 'type'])) col.type = i;
    else if (headerHasAny(h, ['объем', 'объём', 'volume', 'lot'])) col.size = i;
    else if (headerHasAny(h, ['цена', 'price'])) {
      if (prices++ === 0) col.entry = i; else if (col.exit < 0) col.exit = i;
    } else if (headerHasAny(h, ['комисси', 'commission'])) col.commission = i;
    else if (headerHasAny(h, ['своп', 'swap'])) col.swap = i;
    else if (headerHasAny(h, ['прибыль', 'profit', 'p/l', 'p&l'])) col.pnl = i;
  });
  return col;
}

function tradeDirection(v) {
  const s = cellLow(v);
  if (!s) return null;
  if (s.includes('buy') || s.includes('long') || s.includes('покуп')) return 'long';
  if (s.includes('sell') || s.includes('short') || s.includes('прод')) return 'short';
  return null;
}

/**
 * Parse a MetaTrader 4/5 history report from a 2D array of cells (rows).
 * Returns the same shape as parseCsv plus a `format` tag. Reads the ENTIRE
 * Positions table — no row limit — and ignores the Orders/Deals tables.
 */
export function parseMetaTrader(rows) {
  if (!Array.isArray(rows)) return { error: 'not_metatrader', trades: [], warnings: [], skipped: 0 };

  const secIdx = rows.findIndex((r) => matchesSection(r, MT_SECTIONS.positions));
  if (secIdx < 0) return { error: 'not_metatrader', trades: [], warnings: [], skipped: 0 };

  // Header = first non-empty row after the "Позиции / Positions" label.
  let headIdx = -1;
  for (let i = secIdx + 1; i < rows.length; i++) {
    if (Array.isArray(rows[i]) && rows[i].some((c) => cellStr(c))) { headIdx = i; break; }
  }
  if (headIdx < 0) return { error: 'mt_no_data', trades: [], warnings: [], skipped: 0 };

  const col = mapPositionColumns(rows[headIdx]);
  if (col.pnl < 0) return { error: 'mt_no_data', trades: [], warnings: [], skipped: 0 };

  // The Positions table ends where the next table (Orders/Deals) begins.
  const stopAt = [...MT_SECTIONS.orders, ...MT_SECTIONS.deals];
  const order = [];
  const byKey = new Map();
  let skipped = 0;
  let grouped = false;

  for (let i = headIdx + 1; i < rows.length; i++) {
    const cells = rows[i];
    if (!Array.isArray(cells) || cells.every((c) => !cellStr(c))) continue; // blank row
    if (matchesSection(cells, stopAt)) break;                               // next table → stop

    const pnl = toNum(cells[col.pnl]);
    const dir = tradeDirection(cells[col.type]);
    const symbol = col.symbol >= 0 ? cellStr(cells[col.symbol]) : '';
    // A real position row has a numeric PnL, a symbol, and a buy/sell type.
    // Totals/summary rows fail this and are skipped silently (not errors).
    if (!Number.isFinite(pnl) || !symbol || !dir) { skipped++; continue; }

    const swap = col.swap >= 0 ? toNum(cells[col.swap]) : NaN;
    const commission = col.commission >= 0 ? toNum(cells[col.commission]) : NaN;
    // Per-trade P&L = profit + swap + commission (the broker's net for the position).
    const net = pnl + (Number.isFinite(swap) ? swap : 0) + (Number.isFinite(commission) ? commission : 0);

    const id = col.id >= 0 ? cellStr(cells[col.id]) : '';
    const key = id || `row${i}`;                  // no id column → each row is its own trade
    const open = col.openTime >= 0 ? cellStr(cells[col.openTime]) : null;
    const close = col.closeTime >= 0 ? cellStr(cells[col.closeTime]) : null;
    const size = col.size >= 0 ? toNum(cells[col.size]) : NaN;

    const existing = byKey.get(key);
    if (existing) {
      // Same position id again → several fills of ONE position: aggregate them.
      existing.pnl += net;
      if (Number.isFinite(size)) existing.size = (existing.size ?? 0) + size;
      if (close) existing.closeDate = close;      // rows are chronological → keep latest close
      grouped = true;
    } else {
      byKey.set(key, {
        date: open, closeDate: close, symbol, direction: dir,
        size: Number.isFinite(size) ? size : null, pnl: net, r: null,
      });
      order.push(key);
    }
  }

  const trades = order.map((k) => byKey.get(k));
  const warnings = [];
  if (skipped > 0) warnings.push({ id: 'mt_skipped', vars: { n: skipped } });
  if (grouped) warnings.push({ id: 'mt_grouped', vars: {} });

  if (trades.length < 5) {
    return { error: 'too_few_trades', format: 'MetaTrader', trades, warnings, skipped };
  }
  return {
    error: null, format: 'MetaTrader', trades,
    hasR: false, hasDate: col.openTime >= 0, warnings, skipped, count: trades.length,
  };
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
  // Defensive: keep only trades with at least one finite metric so a stray
  // NaN/Infinity from upstream parsing can never poison the engine's stats.
  const trades = (parsed.trades || []).filter(
    (t) => Number.isFinite(t.r) || Number.isFinite(t.pnl),
  );
  // Native per-trade series: prefer explicit R, else PnL.
  const native = trades.map((t) => (Number.isFinite(t.r) ? t.r : t.pnl));
  const stats = tradeStats(native);

  // Build the R-multiple sample for the simulator.
  let rSample;
  let rBasis;
  const explicitR = trades.length > 0 && trades.every((t) => Number.isFinite(t.r));
  if (explicitR) {
    rSample = trades.map((t) => t.r);
    rBasis = 'explicit';
  } else {
    const losses = native.filter((v) => v < 0).map((v) => Math.abs(v));
    const avgLoss = losses.length ? losses.reduce((a, b) => a + b, 0) / losses.length : 1;
    const unit = avgLoss > 0 ? avgLoss : 1;
    rSample = native.map((v) => v / unit);
    rBasis = 'normalized';

    // Clip normalized R to a realistic range. When 1R = avgLoss, legitimate
    // strategies rarely exceed ±10R per trade. Without this, a single outsized win
    // (e.g. BTC short ×37R) compounds to trillions in Monte Carlo equity curves.
    const MAX_R_NORM = 10;
    rSample = rSample.map((v) => Math.max(-MAX_R_NORM, Math.min(MAX_R_NORM, v)));
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
