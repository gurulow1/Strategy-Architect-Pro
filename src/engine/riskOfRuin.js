// Risk of ruin = probability of losing at least `threshold` of STARTING capital
// at any point during the run. Threshold is configurable (default 50%), unlike
// the original tool's fixed -95% which read ~0% for any sane input.

// `ddFromStart` is the per-sim worst loss relative to starting capital (0..1+).
export function riskOfRuin(ddFromStart, threshold = 0.5) {
  if (!ddFromStart.length) return 0;
  const ruined = ddFromStart.filter((d) => d >= threshold).length;
  return ruined / ddFromStart.length;
}

// Ruin probability across a set of thresholds — for a "how deep can it go?" curve.
export function ruinProfile(ddFromStart, thresholds = [0.1, 0.2, 0.3, 0.5, 0.75, 0.9]) {
  return thresholds.map((t) => ({ threshold: t, probability: riskOfRuin(ddFromStart, t) }));
}
