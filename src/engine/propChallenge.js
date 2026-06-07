// Prop-firm challenge evaluation. Correct daily-drawdown model:
// daily loss is measured from the START-OF-DAY balance (how real firms do it),
// not from a running intraday peak as the original tool did.
//
// `dailyCurves` is an array of per-sim daily equity arrays:
//   [startBalance, endOfDay1, endOfDay2, ...]  (from simulate with tradesPerDay).
// We only have end-of-day equity, so intraday lows are not captured — this is a
// conservative-but-honest approximation, and far better than running-peak DD.

/**
 * @param {number[][]} dailyCurves
 * @param {object} rules
 * @param {number} rules.capital          starting balance
 * @param {number} rules.dailyLossLimit   max daily loss as fraction (e.g. 0.05)
 * @param {number} rules.maxLossLimit      max overall loss as fraction (e.g. 0.10)
 * @param {number} rules.profitTarget      profit target as fraction (e.g. 0.10)
 * @param {boolean} [rules.trailing]       max DD trails the peak (default false = static from start)
 */
export function evaluatePropChallenge(dailyCurves, rules) {
  const { capital, dailyLossLimit, maxLossLimit, profitTarget, trailing = false } = rules;
  let passed = 0, dailyViol = 0, maxViol = 0, timeout = 0;

  for (const daily of dailyCurves) {
    let peak = capital;
    let outcome = 'timeout';
    for (let i = 1; i < daily.length; i++) {
      const startOfDay = daily[i - 1];
      const endOfDay = daily[i];

      const dailyLoss = startOfDay > 0 ? (startOfDay - endOfDay) / startOfDay : 0;
      if (dailyLoss >= dailyLossLimit) { outcome = 'daily'; break; }

      const refBase = trailing ? peak : capital;
      const overallLoss = refBase > 0 ? (refBase - endOfDay) / refBase : 0;
      if (overallLoss >= maxLossLimit) { outcome = 'max'; break; }

      if (endOfDay > peak) peak = endOfDay;

      const profit = (endOfDay - capital) / capital;
      if (profit >= profitTarget) { outcome = 'pass'; break; }
    }
    if (outcome === 'pass') passed++;
    else if (outcome === 'daily') dailyViol++;
    else if (outcome === 'max') maxViol++;
    else timeout++;
  }

  const n = dailyCurves.length || 1;
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

// Built-in prop firm presets (challenge rules as fractions of account).
export const PROP_PRESETS = {
  ftmo:       { label: 'FTMO',       dailyLossLimit: 0.05, maxLossLimit: 0.10, profitTarget: 0.10, trailing: false },
  the5ers:    { label: 'The5%ers',   dailyLossLimit: 0.05, maxLossLimit: 0.06, profitTarget: 0.08, trailing: false },
  fundednext: { label: 'FundedNext', dailyLossLimit: 0.05, maxLossLimit: 0.10, profitTarget: 0.10, trailing: false },
  e8:         { label: 'E8 Funding', dailyLossLimit: 0.05, maxLossLimit: 0.08, profitTarget: 0.08, trailing: true  },
};
