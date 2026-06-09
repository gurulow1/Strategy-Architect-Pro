// Deterministic diagnostics layer.
// Outputs English machine keys ONLY — zero human text.
// UI and AI layers are responsible for all language-specific rendering.
// Works entirely offline; no API access.

/**
 * @param {object} m  metrics snapshot
 * @param {number}  m.expectancy
 * @param {number}  m.profitFactor
 * @param {number}  m.riskOfRuin              0..1
 * @param {number}  m.winRate                 0..1
 * @param {number}  m.tradeCount
 * @param {number}  [m.kellyFraction]         full-Kelly f*
 * @param {number}  [m.maxDrawdown]           worst drawdown fraction 0..1
 * @param {number}  [m.recentPerformance]     avg return over recent window
 * @param {number}  [m.historicalPerformance] avg return over full history
 * @param {number}  [m.maxConcentrationTrade] largest single-trade share of total PnL, 0..1
 * @param {number}  [m.feesPerTrade]
 * @param {number}  [m.netExpectancy]
 * @param {object}  [m.prop]                  { passRate, dailyViolationRate, maxViolationRate }
 */
export function diagnostics(m) {
  const {
    expectancy = 0,
    profitFactor = 0,
    riskOfRuin = 0,
    winRate = 0,
    tradeCount = 0,
    kellyFraction,
    maxDrawdown,
    recentPerformance,
    historicalPerformance,
    maxConcentrationTrade,
    feesPerTrade,
    netExpectancy,
    prop,
  } = m;

  // ── Strengths ──────────────────────────────────────────────────────────────
  const strengths = [];
  if (expectancy > 0.1)
    strengths.push({ key: 'positive_expectancy', value: expectancy, threshold: 0.1 });
  if (Number.isFinite(profitFactor) && profitFactor >= 1.5)
    strengths.push({ key: 'healthy_profit_factor', value: profitFactor, threshold: 1.5 });
  if (riskOfRuin < 0.05)
    strengths.push({ key: 'low_risk_of_ruin', value: riskOfRuin, threshold: 0.05 });
  if (winRate >= 0.5)
    strengths.push({ key: 'solid_win_rate', value: winRate, threshold: 0.5 });
  if (kellyFraction != null && kellyFraction > 0)
    strengths.push({ key: 'kelly_viable', value: kellyFraction });

  // ── Weaknesses ────────────────────────────────────────────────────────────
  const weaknesses = [];
  if (expectancy <= 0)
    weaknesses.push({ key: 'negative_expectancy', value: expectancy, threshold: 0 });
  if (Number.isFinite(profitFactor) && profitFactor > 0 && profitFactor < 1.2)
    weaknesses.push({ key: 'low_profit_factor', value: profitFactor, threshold: 1.2 });
  if (riskOfRuin > 0.20)
    weaknesses.push({ key: 'high_risk_of_ruin', value: riskOfRuin, threshold: 0.20 });
  if (winRate > 0 && winRate < 0.4)
    weaknesses.push({ key: 'low_win_rate', value: winRate, threshold: 0.4 });
  if (maxDrawdown != null && maxDrawdown > 0.35)
    weaknesses.push({ key: 'severe_drawdown', value: maxDrawdown, threshold: 0.35 });

  // ── Breakpoints ───────────────────────────────────────────────────────────
  const breakpoints = [];
  if (riskOfRuin > 0.10)
    breakpoints.push({ key: 'ruin_exceeds_10pct', params: { riskOfRuin } });
  if (kellyFraction != null && kellyFraction > 0.25)
    breakpoints.push({ key: 'kelly_exceeds_limit', params: { kellyFraction } });
  if (prop && prop.maxViolationRate > 0.20)
    breakpoints.push({ key: 'drawdown_near_prop_limit', params: { maxViolationRate: prop.maxViolationRate } });

  // ── Edge Decay ────────────────────────────────────────────────────────────
  let edgeDecay = { detected: false };
  if (recentPerformance != null && historicalPerformance != null && historicalPerformance !== 0) {
    const ratio = recentPerformance / historicalPerformance;
    edgeDecay = ratio < 0.7
      ? { detected: true, reasonKey: 'last_20pct_underperform', ratio }
      : { detected: false, ratio };
  }

  // ── Concentration Risk ────────────────────────────────────────────────────
  let concentrationRisk = { detected: false };
  if (maxConcentrationTrade != null) {
    concentrationRisk = maxConcentrationTrade > 0.30
      ? { detected: true, maxConcentration: maxConcentrationTrade, reasonKey: 'single_trade_over_30pct' }
      : { detected: false, maxConcentration: maxConcentrationTrade };
  }

  // ── Sample Quality ────────────────────────────────────────────────────────
  const sufficient = tradeCount >= 30;
  const sampleQuality = sufficient
    ? { tradeCount, sufficient }
    : { tradeCount, sufficient, warningKey: 'sample_size_insufficient', params: { tradeCount, required: 30 } };

  // ── Fee Sensitivity ───────────────────────────────────────────────────────
  let feeSensitivity = { detected: false };
  if (feesPerTrade != null && netExpectancy != null && netExpectancy > 0) {
    const ratio = feesPerTrade / netExpectancy;
    feeSensitivity = ratio > 0.20
      ? { detected: true, ratio, impactKey: 'fees_over_20pct' }
      : { detected: false, ratio };
  }

  // ── Risk Flags ────────────────────────────────────────────────────────────
  const riskFlags = [];
  if (prop) {
    const combinedViolation = (prop.dailyViolationRate ?? 0) + (prop.maxViolationRate ?? 0);
    if (combinedViolation > 0.30)
      riskFlags.push({
        key: 'prop_drawdown_close',
        params: { dailyViolationRate: prop.dailyViolationRate, maxViolationRate: prop.maxViolationRate },
      });
    if (prop.passRate != null && prop.passRate < 0.30)
      riskFlags.push({ key: 'prop_time_pressure', params: { passRate: prop.passRate } });
  }

  return { strengths, weaknesses, breakpoints, edgeDecay, concentrationRisk, sampleQuality, feeSensitivity, riskFlags };
}
