import { describe, it, expect } from 'vitest';
import { evaluatePropChallenge, PROP_PRESETS } from '../src/engine/propChallenge.js';

const rules = {
  capital: 100000, dailyLossLimit: 0.05, maxLossLimit: 0.10, profitTarget: 0.10, trailing: false,
};

describe('evaluatePropChallenge', () => {
  it('passes a curve that hits target without violations', () => {
    // grows steadily to +10%
    const daily = [100000, 102000, 104000, 106000, 108000, 110000];
    const r = evaluatePropChallenge([daily], rules);
    expect(r.passRate).toBe(1);
  });

  it('flags a daily-loss violation measured from start-of-day balance', () => {
    // day 2 drops from 100k to 94k = 6% daily loss > 5% limit
    const daily = [100000, 100000, 94000, 99000];
    const r = evaluatePropChallenge([daily], rules);
    expect(r.dailyViolationRate).toBe(1);
    expect(r.passRate).toBe(0);
  });

  it('flags an intraday daily breach even when equity recovers by day end', () => {
    const intraday = [[100000, 94000, 100000]];
    const r = evaluatePropChallenge([intraday], rules);
    expect(r.dailyViolationRate).toBe(1);
  });

  it('uses a fixed daily-loss amount based on initial capital by default', () => {
    const intraday = [
      [100000, 110000],
      [110000, 104900],
    ];
    const r = evaluatePropChallenge([intraday], { ...rules, profitTarget: 0.50 });
    expect(r.dailyViolationRate).toBe(1); // 5,100 > fixed 5,000

    const startOfDayRule = evaluatePropChallenge([intraday], {
      ...rules, profitTarget: 0.50, dailyLossBasis: 'startOfDay',
    });
    expect(startOfDayRule.dailyViolationRate).toBe(0); // limit is explicitly 5% of 110k
  });

  it('flags a max-loss violation from starting balance (static)', () => {
    // gradual bleed, each day < 5%, but cumulative > 10%
    const daily = [100000, 96000, 92000, 89000]; // 89k = -11% from start
    const r = evaluatePropChallenge([daily], rules);
    expect(r.maxViolationRate).toBe(1);
  });

  it('counts a no-target, no-violation run as timeout', () => {
    const daily = [100000, 101000, 100500, 101500];
    const r = evaluatePropChallenge([daily], rules);
    expect(r.timeoutRate).toBe(1);
  });

  it('supports static and fixed-amount trailing maximum loss', () => {
    const intraday = [[100000, 115000, 104000]];
    const staticResult = evaluatePropChallenge([intraday], {
      ...rules, dailyLossLimit: 0.50, profitTarget: 0.50, maxLossMode: 'static',
    });
    const trailingResult = evaluatePropChallenge([intraday], {
      ...rules, dailyLossLimit: 0.50, profitTarget: 0.50, maxLossMode: 'trailing',
    });
    expect(staticResult.timeoutRate).toBe(1);
    expect(trailingResult.maxViolationRate).toBe(1); // 104k is 11k below the 115k peak
  });

  it('honors explicit daily and maximum loss amounts', () => {
    const daily = evaluatePropChallenge([[[100000, 97900]]], {
      ...rules, dailyLossAmount: 2000, maxLossAmount: 20000,
    });
    expect(daily.dailyViolationRate).toBe(1);

    const maximum = evaluatePropChallenge([[[100000, 94900]]], {
      ...rules, dailyLossAmount: 20000, maxLossAmount: 5000,
    });
    expect(maximum.maxViolationRate).toBe(1);
  });

  it('expectedAttempts is the inverse of pass rate', () => {
    const pass = [100000, 105000, 110000];
    const fail = [100000, 100000, 94000];
    const r = evaluatePropChallenge([pass, fail], rules);
    expect(r.passRate).toBe(0.5);
    expect(r.expectedAttempts).toBe(2);
  });

  it('ships explicitly caveated custom templates under legacy keys', () => {
    expect(PROP_PRESETS.ftmo.maxLossLimit).toBe(0.10);
    expect(PROP_PRESETS.e8.trailing).toBe(true);
    for (const preset of Object.values(PROP_PRESETS)) {
      expect(preset.source).toBe('custom');
      expect(preset.label).toMatch(/^Custom /);
      expect(preset.caveat).toMatch(/verify/i);
    }
  });
});
