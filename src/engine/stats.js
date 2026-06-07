// Pure statistical primitives. No DOM, no trading semantics.

export function mean(arr) {
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
}

export function std(arr) {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / (arr.length - 1));
}

// Percentile via linear position on the sorted array. p in [0,1].
export function percentile(arr, p) {
  if (!arr.length) return 0;
  const a = [...arr].sort((x, y) => x - y);
  const idx = Math.min(a.length - 1, Math.max(0, Math.round((a.length - 1) * p)));
  return a[idx];
}

export function median(arr) {
  return percentile(arr, 0.5);
}

// Error function (Abramowitz & Stegun 7.1.26) — for the normal CDF below.
export function erf(x) {
  const sign = x >= 0 ? 1 : -1;
  x = Math.abs(x);
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741,
    a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const t = 1 / (1 + p * x);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return sign * y;
}

export function normalCdf(x) {
  return 0.5 * (1 + erf(x / Math.SQRT2));
}

// Wilson score interval for a binomial proportion (e.g. win rate).
// Returns [low, high] in [0,1].
export function wilsonInterval(successes, total, z = 1.96) {
  if (total === 0) return [0, 0];
  const p = successes / total;
  const denom = 1 + (z * z) / total;
  const centre = (p + (z * z) / (2 * total)) / denom;
  const width = (z * Math.sqrt((p * (1 - p)) / total + (z * z) / (4 * total * total))) / denom;
  return [Math.max(0, centre - width), Math.min(1, centre + width)];
}

// Two-tailed p-value for an observed proportion vs a baseline (normal approx).
export function binomialPValue(successes, total, baseline = 0.5) {
  if (total === 0) return 1;
  const p = successes / total;
  const se = Math.sqrt((baseline * (1 - baseline)) / total);
  if (se === 0) return 1;
  const z = (p - baseline) / se;
  return Math.max(0, Math.min(1, 2 * (1 - normalCdf(Math.abs(z)))));
}

// Bootstrap confidence interval for the mean of a sample.
// Used to ask "is expectancy significantly above zero?" from REAL trade data.
export function bootstrapMeanCI(sample, rng, { iterations = 2000, alpha = 0.05 } = {}) {
  if (sample.length === 0) return { low: 0, high: 0, pAboveZero: 0 };
  const n = sample.length;
  const means = new Array(iterations);
  let aboveZero = 0;
  for (let i = 0; i < iterations; i++) {
    let sum = 0;
    for (let j = 0; j < n; j++) sum += sample[(rng() * n) | 0];
    const m = sum / n;
    means[i] = m;
    if (m > 0) aboveZero++;
  }
  return {
    low: percentile(means, alpha / 2),
    high: percentile(means, 1 - alpha / 2),
    pAboveZero: aboveZero / iterations,
  };
}
