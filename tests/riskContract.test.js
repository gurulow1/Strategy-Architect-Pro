import { describe, expect, it } from 'vitest';
import { buildRiskContract } from '../src/analysis/riskContract.js';

function report(overrides = {}) {
  return {
    spec: { risk: 0.03, sample: Array(120).fill(1) },
    stats: { expectancy: 0.4 },
    sim: { riskOfRuin: 0.02 },
    kelly: { profitable: true, recommended: 0.05 },
    robustness: { score: 80, baseline: { profitable: true } },
    edge: { pAboveZero: 0.98 },
    skillLuck: { sampleSize: 120, verdict: 'strong' },
    temporal: { degrading: false },
    ...overrides,
  };
}

describe('buildRiskContract', () => {
  it('caps a high-confidence contract at 1% risk and fixed loss multiples', () => {
    const contract = buildRiskContract(report());
    expect(contract).toMatchObject({
      confidence: 'high',
      hardPause: false,
      maxRiskPerTrade: 0.01,
      dailyStop: 0.02,
      weeklyStop: 0.05,
      pauseAfterLosses: 4,
      drawdownReview: 0.04,
    });
  });

  it('keeps assumption-only reports low-confidence and never raises current risk', () => {
    const contract = buildRiskContract(report({
      spec: { risk: 0.001, sample: null },
      skillLuck: null,
    }));
    expect(contract.confidence).toBe('low');
    expect(contract.maxRiskPerTrade).toBe(0.001);
    expect(contract.pauseAfterLosses).toBe(2);
  });

  it('uses an observed post-loss stop signal when it is stricter', () => {
    const contract = buildRiskContract(report({
      spec: { risk: 0.02, sample: Array(50).fill(1) },
      edge: { pAboveZero: 0.85 },
      robustness: { score: 55, baseline: { profitable: true } },
      skillLuck: { sampleSize: 50, verdict: 'probable' },
      psychology: { stopSignal: { after: 1 } },
    }));
    expect(contract.confidence).toBe('medium');
    expect(contract.maxRiskPerTrade).toBe(0.005);
    expect(contract.pauseAfterLosses).toBe(1);
  });

  it.each([
    ['zero expectancy', { stats: { expectancy: 0 } }, 'non_positive_expectancy'],
    ['25% ruin probability', { sim: { riskOfRuin: 0.25 } }, 'high_ruin'],
    ['missing report data', {}, 'insufficient_data'],
  ])('hard-pauses on %s', (_label, input, reason) => {
    const contract = buildRiskContract(
      reason === 'insufficient_data' ? input : report(input),
    );
    expect(contract.hardPause).toBe(true);
    expect(contract.hardPauseReasons).toContain(reason);
    expect(contract.maxRiskPerTrade).toBe(0);
  });
});
