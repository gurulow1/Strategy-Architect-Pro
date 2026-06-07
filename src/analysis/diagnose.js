// Human-readable diagnostics. NO generic AI prose — every finding is emitted
// only when a calculated metric crosses a threshold, and carries the numbers
// that triggered it. The UI/i18n layer turns {id, vars} into localized text.
//
// Each finding: { id, vars }. `vars` holds raw numbers; formatting is the UI's job.

const f = (id, vars = {}) => ({ id, vars });

/**
 * @param {object} r consolidated report
 * @param {object} r.stats         { winRate, payoffRatio, profitFactor, expectancy, count }
 * @param {object} r.sim           { meanReturn, medianReturn, probProfit, medianDD, worstDD, riskOfRuin }
 * @param {object} r.kelly         { fStar, recommended, profitable }
 * @param {number} r.risk          current risk fraction per trade
 * @param {object} r.robustness    { score, grade, breakingPoints, margins, worstCase }
 * @param {object} [r.edge]        { pAboveZero, ciLow, ciHigh }  (real-data significance)
 * @param {object} [r.prop]        { passRate, dailyViolationRate, maxViolationRate }
 */
export function diagnose(r) {
  const strengths = [];
  const weaknesses = [];
  const risks = [];
  const actions = [];

  const { stats, sim, kelly, robustness, edge, prop, risk } = r;
  const profitable = stats.expectancy > 0;

  // ---------- STRENGTHS ----------
  if (profitable) strengths.push(f('positive_expectancy', { expectancy: stats.expectancy }));
  if (stats.profitFactor >= 1.5 && Number.isFinite(stats.profitFactor))
    strengths.push(f('strong_pf', { pf: stats.profitFactor }));
  if (robustness && robustness.score >= 60)
    strengths.push(f('robust_edge', { score: robustness.score }));
  if (edge && edge.pAboveZero >= 0.95)
    strengths.push(f('statistically_significant', { p: edge.pAboveZero }));
  if (stats.count >= 200)
    strengths.push(f('large_sample', { n: stats.count }));
  if (sim && sim.riskOfRuin < 0.01)
    strengths.push(f('low_ruin', { ruin: sim.riskOfRuin }));
  if (prop && prop.passRate >= 0.4)
    strengths.push(f('survives_prop', { pass: prop.passRate }));

  // ---------- WEAKNESSES ----------
  if (!profitable) weaknesses.push(f('negative_expectancy', { expectancy: stats.expectancy }));
  if (stats.profitFactor > 0 && stats.profitFactor < 1.3)
    weaknesses.push(f('weak_pf', { pf: stats.profitFactor }));
  if (robustness && robustness.score < 50 && profitable)
    weaknesses.push(f('thin_robustness', { score: robustness.score }));
  if (stats.count < 100)
    weaknesses.push(f('small_sample', { n: stats.count }));
  if (sim && sim.medianDD > 0.25)
    weaknesses.push(f('high_drawdown', { dd: sim.medianDD }));
  if (edge && edge.pAboveZero < 0.9 && profitable)
    weaknesses.push(f('not_significant', { p: edge.pAboveZero }));
  if (sim && sim.probProfit < 0.5)
    weaknesses.push(f('inconsistent', { pop: sim.probProfit }));

  // ---------- MAJOR RISKS ----------
  if (sim && sim.riskOfRuin >= 0.05)
    risks.push(f('ruin_risk', { ruin: sim.riskOfRuin }));
  if (kelly && kelly.profitable && risk > kelly.fStar)
    risks.push(f('overleveraged', { risk, fStar: kelly.fStar }));
  if (robustness && robustness.margins && robustness.margins.winRate < 0.05 && profitable)
    risks.push(f('wr_fragile', { floor: robustness.breakingPoints.winRateFloor, current: stats.winRate }));
  if (robustness && robustness.breakingPoints &&
      robustness.breakingPoints.costCeiling > 0 &&
      r.cost != null && r.cost > robustness.breakingPoints.costCeiling * 0.66)
    risks.push(f('cost_fragile', { ceiling: robustness.breakingPoints.costCeiling, current: r.cost }));
  if (sim && sim.worstDD > 0.4)
    risks.push(f('deep_drawdown', { dd: sim.worstDD }));
  if (prop && (prop.dailyViolationRate + prop.maxViolationRate) > 0.5)
    risks.push(f('prop_dd_risk', { daily: prop.dailyViolationRate, max: prop.maxViolationRate }));

  // ---------- RECOMMENDED ACTIONS ----------
  if (!profitable) {
    actions.push(f('do_not_trade_live', {}));
  } else {
    if (kelly && kelly.profitable && risk > kelly.recommended * 1.05)
      actions.push(f('reduce_risk', { from: risk, to: kelly.recommended }));
    if (stats.count < 100)
      actions.push(f('collect_more_data', { n: stats.count, target: 100 }));
    if (robustness && robustness.breakingPoints &&
        r.cost != null && r.cost > robustness.breakingPoints.costCeiling * 0.66)
      actions.push(f('cut_costs', {}));
    if (robustness && robustness.score < 50)
      actions.push(f('improve_edge', { score: robustness.score }));
    if (prop && prop.passRate < 0.3 && prop.passRate >= 0)
      actions.push(f('lower_risk_for_prop', { pass: prop.passRate }));
    if (actions.length === 0)
      actions.push(f('within_tolerances', {}));
  }

  return { strengths, weaknesses, risks, actions };
}
