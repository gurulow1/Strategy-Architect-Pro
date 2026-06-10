// Presentation-only number formatting. No business logic.
//
// All formatters are hardened against bad inputs:
//   - NaN / Infinity / non-numbers  → em dash "—" (never raw "NaN"/"Infinity")
//   - |magnitude| > 999,999         → compact exponential with 2 decimals,
//                                      so a runaway value can't overflow its card.

export const DASH = '—';

const isBad = (v) => typeof v !== 'number' || !Number.isFinite(v);

// Render a finite number with `d` decimals, but switch huge magnitudes to a
// bounded exponential string (max 2 decimals) so card layouts never break.
function magnitude(n, d) {
  return Math.abs(n) > 999999 ? n.toExponential(2) : n.toFixed(d);
}

export const fmtPct = (v, d = 1) => (isBad(v) ? DASH : `${magnitude(v * 100, d)}%`);

export const fmtPctSigned = (v, d = 1) => {
  if (isBad(v)) return DASH;
  const p = v * 100;
  return `${p >= 0 ? '+' : ''}${magnitude(p, d)}%`;
};

export const fmtR = (v, d = 2) => {
  if (isBad(v)) return DASH;
  return `${v >= 0 ? '+' : ''}${magnitude(v, d)}R`;
};

export const fmtNum = (v, d = 2) => (isBad(v) ? DASH : magnitude(v, d));

// Render a per-trade value either as an R-multiple (default) or in account
// currency. Used when a MetaTrader journal has no R column and PnL was
// normalized — currency reads far more honestly than "+6627R".
export const fmtValue = (v, unit, symbol = '$') => {
  if (unit !== 'currency') return fmtR(v);
  if (isBad(v)) return DASH;
  const sign = v >= 0 ? '+' : '−';
  const abs = Math.abs(v);
  const body = abs > 999999
    ? abs.toExponential(2)
    : abs.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${sign}${symbol}${body}`;
};

export const fmtInt = (v) => {
  if (isBad(v)) return DASH;
  return Math.abs(v) > 999999 ? v.toExponential(2) : Math.round(v).toLocaleString('en-US');
};

export const fmtMoney = (v) => {
  if (isBad(v)) return DASH;
  return Math.abs(v) > 999999999
    ? `$${v.toExponential(2)}`
    : `$${Math.round(v).toLocaleString('en-US')}`;
};

// Format a diagnostic finding variable based on its semantic key.
// Keeps the i18n templates clean (they receive ready-to-print strings).
const PCT_KEYS = new Set([
  'ruin', 'pop', 'pass', 'p', 'daily', 'max', 'retention',
  'risk', 'from', 'to', 'floor', 'current', 'ceiling', 'fStar', 'threshold', 'v',
  'pAboveZero', 'share', 'dominantShare', 'baseWR', 'nextWR',
]);
const INT_KEYS = new Set(['n', 'target', 'score']);
const R_KEYS = new Set(['expectancy', 'dd', 'earlyExpectancy', 'recentExpectancy', 'delta']);

export function formatVar(key, val) {
  if (typeof val !== 'number') return String(val);
  if (key === 'pf') {
    if (!Number.isFinite(val)) return val === Infinity ? '∞' : DASH;
    return magnitude(val, 2);
  }
  if (!Number.isFinite(val)) return DASH;
  if (key === 'dd') return fmtPct(val); // drawdowns are fractions, show as %
  if (R_KEYS.has(key)) return fmtR(val);
  if (INT_KEYS.has(key)) return fmtInt(val);
  if (PCT_KEYS.has(key)) {
    // win-rate / reward floors that are pure ratios still read best as %
    return key === 'fStar' || key === 'ceiling' ? fmtPct(val, 2) : fmtPct(val, 1);
  }
  return magnitude(val, 2);
}
