// Skill vs Luck decomposition. Answers "real edge or lucky run?" using only
// honest statistics — no invented probabilities. Pure function.

import { bootstrapMeanCI, mean, wilsonInterval } from '../engine/stats.js';
import { createRng } from '../engine/rng.js';

// One-sided bootstrap test under H0: expectancy = 0. Centering preserves the
// observed payoff distribution while removing its mean.
function expectancyPValue(sample, seed, iterations = 2000) {
  const observed = mean(sample);
  if (observed <= 0) return 1;
  const centered = sample.map((v) => v - observed);
  const rng = createRng(seed >>> 0);
  let atLeastObserved = 0;
  for (let i = 0; i < iterations; i++) {
    let sum = 0;
    for (let j = 0; j < centered.length; j++) {
      sum += centered[(rng() * centered.length) | 0];
    }
    if (sum / centered.length >= observed) atLeastObserved++;
  }
  // Add one pseudo-observation so a finite simulation never reports p=0.
  return (atLeastObserved + 1) / (iterations + 1);
}

/**
 * @param {number[]} rSample  per-trade R-multiples (or normalized PnL)
 * @param {object}   stats    tradeStats output (wins/losses needed)
 * @param {number}   [seed=42]
 */
export function analyzeSkillVsLuck(rSample, stats, seed = 42, { reportedSampleSize } = {}) {
  const sample = (rSample || []).filter((v) => Number.isFinite(v));
  const n = sample.length;
  const fullSampleSize = Number.isInteger(reportedSampleSize) && reportedSampleSize >= n
    ? reportedSampleSize
    : n;
  if (n === 0) {
    return {
      expectancyCI: { low: 0, high: 0, pAboveZero: 0 },
      pValueExpectancy: 1,
      pValueVsCoin: 1,
      winRateCI: [0, 0],
      extraLossesToBreakeven: 0,
      verdict: 'insufficient_data',
      sampleSize: 0,
    };
  }
  // 1. Bootstrap mean CI on R-multiples: "is expectancy significantly > 0?"
  const ci = bootstrapMeanCI(sample, createRng(seed >>> 0), { iterations: 2000, alpha: 0.05 });

  // 2. Evidence against non-positive expectancy. Win rate alone is not an edge:
  // payoff sizes and losses are part of the null test.
  const pValueExpectancy = expectancyPValue(sample, (seed >>> 0) + 0x9e3779b9);

  // 3. Wilson interval remains descriptive; it is not used to test the edge.
  const decided = stats.wins + stats.losses;
  const winRateCI = wilsonInterval(stats.wins, decided, 1.96);

  // 4. Fragility: how many additional average losses would push expectancy to zero?
  const grossProfit = sample.filter((r) => r > 0).reduce((a, b) => a + b, 0);
  const lossSum = sample.filter((r) => r < 0).reduce((a, b) => a + b, 0);
  const sampledLosses = sample.filter((r) => r < 0).length;
  const avgLoss = sampledLosses > 0 ? Math.abs(lossSum / sampledLosses) || 1 : 1;
  const netSum = sample.reduce((a, b) => a + b, 0);
  const scale = n > 0 ? fullSampleSize / n : 1;
  // Only meaningful when the system is currently profitable.
  const extraLossesToBreakeven = netSum > 0 ? Math.ceil((netSum / avgLoss) * scale) : 0;

  // 5. Verdict from thresholds only — never a fabricated percentage.
  const verdict = fullSampleSize < 30 ? 'insufficient_data'
    : ci.pAboveZero >= 0.95 && pValueExpectancy < 0.05 ? 'strong'
      : ci.pAboveZero >= 0.80 && pValueExpectancy < 0.20 ? 'probable'
        : ci.pAboveZero >= 0.65 ? 'weak'
          : 'unclear';

  return {
    expectancyCI: { low: ci.low, high: ci.high, pAboveZero: ci.pAboveZero },
    pValueExpectancy,
    // Deprecated compatibility alias; this now measures expectancy, not WR vs 50%.
    pValueVsCoin: pValueExpectancy,
    winRateCI,
    extraLossesToBreakeven,
    grossProfit: grossProfit * scale,
    verdict,
    sampleSize: fullSampleSize,
  };
}
