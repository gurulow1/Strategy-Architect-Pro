// Single source of UI state. The DOM is NO LONGER the source of truth —
// inputs write here, workflows read from here. One strategy, four lenses.

import { randomSeed } from '../engine/rng.js';

export const state = {
  seed: 1,
  lang: 'en',

  // The strategy currently under examination. Set by Quick Check or Journal,
  // consumed by Robustness and Prop Challenge so all four tabs agree.
  strategy: null, // { winRate, rr, risk, cost, capital, trades, sims, sample?, source }

  // Last computed report (for export / re-render on language switch).
  lastReport: null,
};

export function setStrategy(strategy) {
  state.strategy = strategy;
}

export function hasStrategy() {
  return state.strategy != null;
}

export function newSeed() {
  state.seed = randomSeed();
  return state.seed;
}
