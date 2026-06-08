# Strategy Architect Pro — Risk Laboratory

**Stress-test your trading strategy before risking real money.**

This is not a strategy generator, a signal service, or a market predictor. It is a
risk laboratory: you bring a strategy (as three numbers, or as a real trade journal),
and it tells you — in under a minute — whether the edge is real, how fragile it is,
what conditions destroy it, what risk to trade, and whether it can pass a prop challenge.

## The four workflows

1. **Quick Check** — enter win rate, reward:risk and risk%. Get expectancy, a Monte
   Carlo outcome range, drawdown profile, risk of ruin, and a plain-language verdict.
2. **Journal Analysis** — upload a CSV of real trades. Real WR / RR / profit factor /
   expectancy / drawdown / streaks are computed, then thousands of futures are
   bootstrapped *from your own data*.
3. **Robustness Test** — the flagship. Execution is deliberately made worse on every
   axis a strategy decays on (win rate, reward, fees, slippage). Shows what survives,
   a 0–100 robustness score, and the exact breaking points.
4. **Prop Challenge** — input firm rules (or pick a preset). Returns probability of
   passing, probability of breaching daily/max drawdown, and the risk % that maximizes
   pass rate.

Every analysis ends with the same data-driven block: **Strengths / Weaknesses /
Major Risks / Recommended Actions** — generated only from calculated metrics, never
generic prose.

## Architecture

Strict separation along four boundaries. **No business logic lives in the UI.**

```
src/
  engine/      pure math, zero DOM, fully unit-tested
    rng, stats, metrics, simulate, kelly, riskOfRuin, propChallenge
  analysis/    diagnostics built on the engine
    journal, robustness, diagnose, report
  ui/          presentation only
    state, i18n, format, controls, charts, results, workflows/
  reports/     exports
  i18n/        en + ru dictionaries (one real translation each)
tests/         vitest specs for engine + analysis (47 tests)
```

- The **engine** is a set of pure `(input) -> output` functions. They never read the
  DOM, take a seeded RNG for determinism, and are the single source of truth for every
  formula (profit factor, expectancy, drawdown, Kelly, ruin) — defined once.
- The **analysis** layer turns engine output into a consolidated report and the
  human-readable diagnosis.
- The **UI** reads from a single `state` object (the DOM is no longer the source of
  truth) and renders. One strategy flows across all four tabs.

## Develop

```bash
npm install
npm run dev      # vite dev server
npm test         # run the 47-test suite
npm run build    # production bundle in dist/
```

## What changed from v1 (audit highlights)

The previous version was a single 1,686-line HTML file behaving as a wall of ~40
sliders with no verdict. Key fixes carried into v2:

- **Risk of ruin** is now a configurable threshold (default −50% of account) instead of
  the unreachable −95% that always read ~0%.
- **Prop daily drawdown** is measured from start-of-day balance, the way real firms do.
- **Profit factor** is gross-profit ÷ gross-loss (one definition), not three conflicting ones.
- **Edge significance / sample size** reflect the *planned* number of trades, not the
  millions simulated across all paths.
- **Realized R-multiples** use the pre-trade risk denominator (the old code used
  post-trade equity, biasing PF/expectancy).
- The **Russian runtime translation** — previously an identical copy of the Russian
  dictionary mislabeled as English, so every computed string stayed Russian — is now a
  real, complete bilingual layer covering the generated diagnostics.
- Dead/decorative code removed: the no-op Monte-Carlo mode selector, the unused
  volatility multiplier, the literal `t('...')` button labels, the hidden 4% trade-skip.

The default-on, 12-knob "psychology" model was dropped from the baseline: a tool whose
job is to show reality should not silently inject speculative behavioral fudge.
"# Strategy-Architect-Pro" 
"# Strategy-Architect-Pro" 
