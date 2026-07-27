// Prop-challenge evaluation. Intraday input is preferred:
//   simulations -> days -> [start-of-day equity, equity after trade 1, ...].
// Legacy [startBalance, endOfDay1, ...] curves remain supported.

function asDayPaths(curve) {
  if (!Array.isArray(curve) || curve.length === 0) return [];
  if (Array.isArray(curve[0])) return curve;
  const days = [];
  for (let i = 1; i < curve.length; i++) days.push([curve[i - 1], curve[i]]);
  return days;
}

function ruleAmount(explicitAmount, fraction, base) {
  if (Number.isFinite(explicitAmount)) return Math.max(0, explicitAmount);
  return Math.max(0, base * fraction);
}

/**
 * @param {number[][]|number[][][]} curves legacy daily closes or intraday day paths
 * @param {object} rules
 * @param {number} rules.capital          starting balance
 * @param {number} rules.dailyLossLimit   max daily loss fraction of initial capital
 * @param {number} [rules.dailyLossAmount] explicit fixed daily-loss amount
 * @param {'initial'|'startOfDay'} [rules.dailyLossBasis='initial']
 * @param {number} rules.maxLossLimit      max overall loss fraction of initial capital
 * @param {number} [rules.maxLossAmount]  explicit fixed maximum-loss amount
 * @param {number} rules.profitTarget      profit target as fraction (e.g. 0.10)
 * @param {'static'|'trailing'} [rules.maxLossMode]
 * @param {boolean} [rules.trailing] legacy alias for maxLossMode
 */
export function evaluatePropChallenge(curves, rules) {
  const {
    capital, dailyLossLimit, dailyLossAmount, dailyLossBasis = 'initial',
    maxLossLimit, maxLossAmount, profitTarget, trailing = false,
  } = rules;
  const maxLossMode = rules.maxLossMode || (trailing ? 'trailing' : 'static');
  const fixedMaxLoss = ruleAmount(maxLossAmount, maxLossLimit, capital);
  const targetEquity = capital + capital * profitTarget;
  let passed = 0, dailyViol = 0, maxViol = 0, timeout = 0;

  for (const curve of curves) {
    let peak = capital;
    let outcome = 'timeout';
    for (const rawDay of asDayPaths(curve)) {
      const day = rawDay.filter((v) => Number.isFinite(v));
      if (day.length === 0) continue;
      const startOfDay = day[0];
      const amountBase = dailyLossBasis === 'startOfDay' ? startOfDay : capital;
      const fixedDailyLoss = ruleAmount(dailyLossAmount, dailyLossLimit, amountBase);
      const dailyFloor = startOfDay - fixedDailyLoss;

      for (let i = 1; i < day.length; i++) {
        const equity = day[i];
        if (equity <= dailyFloor) { outcome = 'daily'; break; }

        if (equity > peak) peak = equity;
        const maxFloor = maxLossMode === 'trailing'
          ? peak - fixedMaxLoss
          : capital - fixedMaxLoss;
        if (equity <= maxFloor) { outcome = 'max'; break; }

        if (equity >= targetEquity) { outcome = 'pass'; break; }
      }
      if (outcome !== 'timeout') break;
    }
    if (outcome === 'pass') passed++;
    else if (outcome === 'daily') dailyViol++;
    else if (outcome === 'max') maxViol++;
    else timeout++;
  }

  const n = curves.length || 1;
  const passRate = passed / n;
  return {
    passRate,
    dailyViolationRate: dailyViol / n,
    maxViolationRate: maxViol / n,
    timeoutRate: timeout / n,
    // Expected number of paid attempts to pass once (geometric mean).
    expectedAttempts: passRate > 0 ? 1 / passRate : Infinity,
  };
}

// Illustrative templates only. Provider rules change and must be verified by
// the user; legacy keys are retained so saved selections keep working.
const PRESET_CAVEAT = 'Illustrative custom template; verify the provider’s current rules before use.';
export const PROP_PRESETS = {
  ftmo:       { label: 'Custom 5/10 static',       dailyLossLimit: 0.05, maxLossLimit: 0.10, profitTarget: 0.10, trailing: false, source: 'custom', caveat: PRESET_CAVEAT },
  the5ers:    { label: 'Custom 5/6 static',        dailyLossLimit: 0.05, maxLossLimit: 0.06, profitTarget: 0.08, trailing: false, source: 'custom', caveat: PRESET_CAVEAT },
  fundednext: { label: 'Custom 5/10 static (alt)', dailyLossLimit: 0.05, maxLossLimit: 0.10, profitTarget: 0.10, trailing: false, source: 'custom', caveat: PRESET_CAVEAT },
  e8:         { label: 'Custom 5/8 trailing',      dailyLossLimit: 0.05, maxLossLimit: 0.08, profitTarget: 0.08, trailing: true, source: 'custom', caveat: PRESET_CAVEAT },
};
