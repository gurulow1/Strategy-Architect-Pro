// Presentation-only number formatting. No business logic.

export const fmtPct = (v, d = 1) => `${(v * 100).toFixed(d)}%`;
export const fmtPctSigned = (v, d = 1) => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(d)}%`;
export const fmtR = (v, d = 2) => `${v >= 0 ? '+' : ''}${v.toFixed(d)}R`;
export const fmtNum = (v, d = 2) => v.toFixed(d);
export const fmtInt = (v) => Math.round(v).toLocaleString('en-US');
export const fmtMoney = (v) => `$${Math.round(v).toLocaleString('en-US')}`;

// Format a diagnostic finding variable based on its semantic key.
// Keeps the i18n templates clean (they receive ready-to-print strings).
const PCT_KEYS = new Set([
  'ruin', 'pop', 'pass', 'p', 'daily', 'max', 'retention',
  'risk', 'from', 'to', 'floor', 'current', 'ceiling', 'fStar', 'threshold', 'v',
]);
const INT_KEYS = new Set(['n', 'target', 'score']);
const R_KEYS = new Set(['expectancy', 'dd']);

export function formatVar(key, val) {
  if (typeof val !== 'number') return String(val);
  if (key === 'pf') return val === Infinity ? '∞' : val.toFixed(2);
  if (key === 'dd') return fmtPct(val); // drawdowns are fractions, show as %
  if (R_KEYS.has(key)) return fmtR(val);
  if (INT_KEYS.has(key)) return fmtInt(val);
  if (PCT_KEYS.has(key)) {
    // win-rate / reward floors that are pure ratios still read best as %
    return key === 'fStar' || key === 'ceiling' ? fmtPct(val, 2) : fmtPct(val, 1);
  }
  return String(val);
}
