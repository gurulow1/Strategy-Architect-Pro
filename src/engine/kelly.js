// Kelly position sizing. Pure.

// Full-Kelly fraction of capital for a bet that wins `rr`:1 with prob `winRate`,
// losing 1 unit on a loss. f* = winRate - (1 - winRate)/rr.
export function kellyFraction(winRate, rr) {
  if (rr <= 0) return 0;
  return winRate - (1 - winRate) / rr;
}

export const KELLY_MODES = {
  full: { label: 'Full Kelly', multiplier: 1 },
  half: { label: 'Half Kelly', multiplier: 0.5 },
  quarter: { label: 'Quarter Kelly', multiplier: 0.25 },
};

// Resolve a sizing recommendation.
// Returns fractions of capital (e.g. 0.012 = 1.2% risk per trade).
export function kellySizing(winRate, rr, mode = 'half', fixedFraction = null) {
  const fStar = kellyFraction(winRate, rr);
  const profitable = fStar > 0;
  if (mode === 'fixed' && fixedFraction != null) {
    return {
      fStar,
      profitable,
      modeLabel: 'Fixed Fractional',
      recommended: fixedFraction,
    };
  }
  const m = KELLY_MODES[mode] ?? KELLY_MODES.half;
  return {
    fStar,
    profitable,
    modeLabel: m.label,
    // Never recommend a negative size; clamp at 0 for losing systems.
    recommended: Math.max(0, fStar * m.multiplier),
  };
}
