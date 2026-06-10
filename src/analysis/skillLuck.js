// Skill vs Luck decomposition. Answers "real edge or lucky run?" using only
// honest statistics — no invented probabilities. Pure function.

import { bootstrapMeanCI, binomialPValue, wilsonInterval } from '../engine/stats.js';
import { createRng } from '../engine/rng.js';

/**
 * @param {number[]} rSample  per-trade R-multiples (or normalized PnL)
 * @param {object}   stats    tradeStats output (wins/losses needed)
 * @param {number}   [seed=42]
 */
export function analyzeSkillVsLuck(rSample, stats, seed = 42) {
  const sample = (rSample || []).filter((v) => Number.isFinite(v));
  const n = sample.length;
  if (n === 0) {
    return {
      expectancyCI: { low: 0, high: 0, pAboveZero: 0 },
      pValueVsCoin: 1,
      winRateCI: [0, 0],
      extraLossesToBreakeven: 0,
      verdict: 'insufficient_data',
      sampleSize: 0,
    };
  }
  const rng = createRng(seed >>> 0);

  // 1. Bootstrap mean CI on R-multiples: "is expectancy significantly > 0?"
  const ci = bootstrapMeanCI(sample, rng, { iterations: 2000, alpha: 0.05 });

  // 2. Binomial p-value for win rate vs a 0.5 coin (use real counts).
  const decided = stats.wins + stats.losses;
  const pValueVsCoin = binomialPValue(stats.wins, decided, 0.5);

  // 3. Wilson interval for the true win rate.
  const winRateCI = wilsonInterval(stats.wins, decided, 1.96);

  // 4. Fragility: how many additional 1R losses would push expectancy to zero?
  const grossProfit = sample.filter((r) => r > 0).reduce((a, b) => a + b, 0);
  const lossSum = sample.filter((r) => r < 0).reduce((a, b) => a + b, 0);
  const avgLoss = stats.losses > 0 ? Math.abs(lossSum / stats.losses) || 1 : 1;
  const netSum = sample.reduce((a, b) => a + b, 0);
  // Only meaningful when the system is currently profitable.
  const extraLossesToBreakeven = netSum > 0 ? Math.ceil(netSum / avgLoss) : 0;

  // 5. Verdict from thresholds only — never a fabricated percentage.
  const verdict = n < 30 ? 'insufficient_data'
    : ci.pAboveZero >= 0.95 && pValueVsCoin < 0.05 ? 'strong'
      : ci.pAboveZero >= 0.80 && pValueVsCoin < 0.15 ? 'probable'
        : ci.pAboveZero >= 0.65 ? 'weak'
          : 'unclear';

  return {
    expectancyCI: { low: ci.low, high: ci.high, pAboveZero: ci.pAboveZero },
    pValueVsCoin,
    winRateCI,
    extraLossesToBreakeven,
    grossProfit,
    verdict,
    sampleSize: n,
  };
}
