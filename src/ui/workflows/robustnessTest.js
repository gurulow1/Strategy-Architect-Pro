// Robustness Test: presents the stress battery already computed in the report.
// "What happens if you are wrong?" — degrade every axis, show what survives.
import { t } from '../i18n.js';
import { state } from '../state.js';
import { fmtPct, fmtPctSigned, fmtNum } from '../format.js';
import { renderScenarios } from '../charts.js';

const SCEN_KEY = {
  wr_down_3: 'sc_wr_down_3', wr_down_5: 'sc_wr_down_5', rr_down_15: 'sc_rr_down_15',
  fees_up: 'sc_fees_up', slippage_2x: 'sc_slippage_2x', bad_day: 'sc_bad_day',
};
const gradeKey = { robust: 'grade_robust', moderate: 'grade_moderate', thin: 'grade_thin', fragile: 'grade_fragile' };

export function mountRobustness(container) {
  container.innerHTML = `<div class="workflow"><div class="wf-head">
    <h2 data-i18n="rob_title"></h2><p class="muted" data-i18n="rob_desc"></p></div>
    <div id="rob-body"></div></div>`;
  render(container);
  return { rerender: () => render(container) };
}

function render(container) {
  const body = container.querySelector('#rob-body');
  const report = state.lastReport;
  if (!report) {
    body.innerHTML = `<div class="empty muted card pad">${t('rob_no_strategy')}</div>`;
    return;
  }
  const rob = report.robustness;
  const baseReturn = report.sim.meanReturn;
  const bp = rob.breakingPoints;

  const rows = rob.scenarios.map((s) => `
    <tr>
      <td>${t(SCEN_KEY[s.id])}</td>
      <td class="${s.meanReturn >= 0 ? 'good' : 'bad'}">${fmtPctSigned(s.meanReturn)}</td>
      <td>${fmtNum(s.netExpectancyR, 2)}R</td>
      <td>${s.stillProfitable ? `<span class="badge good">${t('rob_yes')}</span>` : `<span class="badge bad">${t('rob_no')}</span>`}</td>
    </tr>`).join('');

  body.innerHTML = `
    <div class="verdict card ${gradeClass(rob)}">
      <div class="verdict-main">
        <div class="verdict-score">${rob.score}<span>/100</span></div>
        <div><div class="verdict-grade ${gradeClass(rob)}">${t(gradeKey[rob.grade])}</div>
        <div class="verdict-sub">${t('robustness_score')}</div></div>
      </div>
    </div>

    <div class="chart-grid">
      <section class="card panel wide"><h3 data-i18n="chart_scenarios"></h3>
        <div class="chart-wrap tall"><canvas id="c-scen"></canvas></div></section>
      <section class="card panel">
        <h3 data-i18n="rob_scenario"></h3>
        <table class="data-table">
          <thead><tr><th>${t('rob_scenario')}</th><th>${t('rob_return')}</th><th>R</th><th>${t('rob_survives')}</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </section>
    </div>

    <div class="card pad">
      <h3 data-i18n="rob_breaking"></h3>
      <div class="break-grid">
        <div class="break"><b>${t('rob_wr_floor')}</b><div class="break-num">${fmtPct(bp.winRateFloor, 1)}</div>
          <span class="muted small">${t('rob_wr_floor_desc', { v: fmtPct(bp.winRateFloor, 1) })}</span></div>
        <div class="break"><b>${t('rob_rr_floor')}</b><div class="break-num">${fmtNum(bp.rrFloor, 2)}</div>
          <span class="muted small">${t('rob_rr_floor_desc', { v: fmtNum(bp.rrFloor, 2) })}</span></div>
        <div class="break"><b>${t('rob_cost_ceiling')}</b><div class="break-num">${fmtPct(bp.costCeiling, 2)}</div>
          <span class="muted small">${t('rob_cost_ceiling_desc', { v: fmtPct(bp.costCeiling, 2) })}</span></div>
      </div>
    </div>`;

  const labels = [t('rob_baseline'), ...rob.scenarios.map((s) => t(SCEN_KEY[s.id]))];
  const returns = [baseReturn, ...rob.scenarios.map((s) => s.meanReturn)];
  renderScenarios('c-scen', labels, returns);
}

function gradeClass(rob) {
  if (rob.grade === 'robust') return 'good';
  if (rob.grade === 'moderate') return 'warn';
  return 'bad';
}
