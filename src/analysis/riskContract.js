// Deterministic, advisory guardrails derived from an analysis report.
// Percent values are fractions of account equity (0.005 = 0.5%).

const CONFIDENCE_RISK_CAP = {
  low: 0.0025,
  medium: 0.005,
  high: 0.01,
};

// Round down so formatting precision can never increase an accepted limit.
const roundRisk = (value) => Math.floor(value * 1e6 + 1e-12) / 1e6;

function dataConfidence(report) {
  const sample = report?.spec?.sample;
  if (!Array.isArray(sample) || sample.length === 0) return 'low';

  const n = report?.skillLuck?.sampleSize ?? sample.length;
  const pAboveZero = report?.edge?.pAboveZero ?? 0;
  const robustness = report?.robustness?.score ?? 0;
  const stable = !report?.temporal?.degrading;

  if (n >= 100 && pAboveZero >= 0.95 && robustness >= 70
      && report?.skillLuck?.verdict === 'strong' && stable) {
    return 'high';
  }
  if (n >= 30 && pAboveZero >= 0.8 && robustness >= 40 && stable) {
    return 'medium';
  }
  return 'low';
}

/**
 * Build a conservative Personal Risk Contract from a completed report.
 * This function only proposes limits; the UI requires explicit acceptance.
 */
export function buildRiskContract(report) {
  const confidence = dataConfidence(report);
  const expectancy = report?.stats?.expectancy;
  const ruin = report?.sim?.riskOfRuin;
  const currentRisk = report?.spec?.risk;
  const reasons = [];

  if (!Number.isFinite(expectancy) || expectancy <= 0
      || report?.kelly?.profitable !== true
      || report?.robustness?.baseline?.profitable === false) {
    reasons.push('non_positive_expectancy');
  }
  if (!Number.isFinite(ruin) || ruin >= 0.25) reasons.push('high_ruin');
  if (!Number.isFinite(currentRisk) || currentRisk <= 0) reasons.push('insufficient_data');

  const hardPause = reasons.length > 0;
  if (hardPause) {
    return {
      version: 1,
      confidence,
      hardPause: true,
      hardPauseReasons: reasons,
      maxRiskPerTrade: 0,
      dailyStop: 0,
      weeklyStop: 0,
      pauseAfterLosses: 1,
      drawdownReview: 0,
    };
  }

  const kellyRisk = Number.isFinite(report?.kelly?.recommended)
    && report.kelly.recommended > 0
    ? report.kelly.recommended / 2
    : currentRisk;
  const maxRiskPerTrade = roundRisk(Math.min(
    currentRisk,
    kellyRisk,
    CONFIDENCE_RISK_CAP[confidence],
  ));
  const observedPause = report?.psychology?.stopSignal?.after;
  const defaultPause = { low: 2, medium: 3, high: 4 }[confidence];

  return {
    version: 1,
    confidence,
    hardPause: false,
    hardPauseReasons: [],
    maxRiskPerTrade,
    dailyStop: roundRisk(maxRiskPerTrade * 2),
    weeklyStop: roundRisk(maxRiskPerTrade * 5),
    pauseAfterLosses: Number.isInteger(observedPause)
      ? Math.min(defaultPause, Math.max(1, observedPause))
      : defaultPause,
    drawdownReview: roundRisk(maxRiskPerTrade * 4),
  };
}
