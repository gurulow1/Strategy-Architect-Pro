import { describe, it, expect } from 'vitest';
import { analyzeSkillVsLuck } from '../src/analysis/skillLuck.js';
import { tradeStats } from '../src/engine/metrics.js';

describe('skill vs luck', () => {
  it('returns insufficient_data below 30 trades', () => {
    const sample = [1, -1, 2, -1, 1, -1, 2, -1, 1, -1];
    const r = analyzeSkillVsLuck(sample, tradeStats(sample), 7);
    expect(r.verdict).toBe('insufficient_data');
    expect(r.sampleSize).toBe(10);
  });

  it('a coin-flip sample (mean 0) is not judged a real edge', () => {
    // 25 wins of +1, 25 losses of -1 → expectancy exactly 0.
    const sample = [...Array(25).fill(1), ...Array(25).fill(-1)];
    const r = analyzeSkillVsLuck(sample, tradeStats(sample), 11);
    expect(['unclear', 'insufficient_data']).toContain(r.verdict);
    expect(r.expectancyCI.pAboveZero).toBeLessThan(0.65);
  });

  it('a consistently positive system is a strong, significant edge', () => {
    const sample = Array(100).fill(0.5);
    const r = analyzeSkillVsLuck(sample, tradeStats(sample), 3);
    expect(r.verdict).toBe('strong');
    expect(r.expectancyCI.pAboveZero).toBeGreaterThanOrEqual(0.95);
    expect(r.pValueVsCoin).toBeLessThan(0.05);
  });

  it('extraLossesToBreakeven is a positive integer when expectancy > 0', () => {
    const sample = Array(100).fill(0.5);
    const r = analyzeSkillVsLuck(sample, tradeStats(sample), 3);
    expect(Number.isInteger(r.extraLossesToBreakeven)).toBe(true);
    expect(r.extraLossesToBreakeven).toBeGreaterThan(0);
  });

  it('handles an empty sample without throwing', () => {
    const r = analyzeSkillVsLuck([], tradeStats([]), 1);
    expect(r.verdict).toBe('insufficient_data');
    expect(r.sampleSize).toBe(0);
  });
});
