// Shared results renderer: verdict → KPIs → diagnosis → charts.
// Used by Quick Check and Journal Analysis. Presentation only.

import { t, tFinding } from './i18n.js';
import { fmtR, fmtPct, fmtPctSigned, fmtNum, fmtPct as pct } from './format.js';
import {
  renderEquity, renderHistogram, renderDrawdownHist, renderStreaks, renderRuinProfile,
} from './charts.js';
import { diagnostics } from '../engine/diagnostics.js';
import { createAISummaryCard, createAIWeaknessPanel } from './aiComponents.js';

function verdict(report) {
  const e = report.stats.expectancy;
  const score = report.robustness.score;
  if (e <= 0) return { key: 'verdict_noedge', cls: 'bad' };
  if (score >= 50) return { key: 'verdict_viable', cls: 'good' };
  return { key: 'verdict_marginal', cls: 'warn' };
}

function kpi(label, value, sub, cls = '', id = '') {
  const idAttr = id ? ` id="${id}"` : '';
  return `<div class="kpi card"${idAttr}><div class="kpi-label">${label}</div>
    <div class="kpi-num ${cls}">${value}</div><div class="kpi-sub">${sub}</div></div>`;
}

function findingList(items) {
  if (!items.length) return `<li class="muted">${t('diag_none')}</li>`;
  return items.map((it) => `<li>${tFinding(it)}</li>`).join('');
}

const gradeKey = { robust: 'grade_robust', moderate: 'grade_moderate', thin: 'grade_thin', fragile: 'grade_fragile' };

export function renderReport(report, mount, { ruinThreshold = 0.5 } = {}) {
  const v = verdict(report);
  const s = report.stats;
  const sim = report.sim;
  const k = report.kelly;
  const pf = s.profitFactor === Infinity ? '∞' : fmtNum(s.profitFactor);
  const sigPct = pct(report.edge.pAboveZero, 0);
  const sigCls = report.edge.pAboveZero >= 0.95 ? 'good' : report.edge.pAboveZero >= 0.8 ? 'warn' : 'bad';
  // Score badge must never show raw NaN — fall back to "N/A" if it failed.
  const scoreDisplay = Number.isFinite(report.robustness?.score) ? report.robustness.score : 'N/A';

  mount.innerHTML = `
    <div class="verdict card ${v.cls}">
      <div class="verdict-main">
        <div class="verdict-score">${scoreDisplay}<span>/100</span></div>
        <div>
          <div class="verdict-grade ${v.cls}">${t(v.key)}</div>
          <div class="verdict-sub">${t('robustness_score')}: ${t(gradeKey[report.robustness.grade])}</div>
        </div>
      </div>
    </div>

    <div class="kpi-grid">
      ${kpi(t('kpi_expectancy'), fmtR(s.expectancy), t('kpi_expectancy_sub'), s.expectancy >= 0 ? 'good' : 'bad', 'kpi-expectancy')}
      ${kpi(t('kpi_pf'), pf, t('kpi_pf_sub'), s.profitFactor >= 1.5 ? 'good' : s.profitFactor >= 1 ? 'warn' : 'bad', 'kpi-pf')}
      ${kpi(t('kpi_return'), fmtPctSigned(sim.meanReturn), t('kpi_return_sub', { p10: fmtPctSigned(sim.p10Return), p90: fmtPctSigned(sim.p90Return) }), sim.meanReturn >= 0 ? 'good' : 'bad')}
      ${kpi(t('kpi_median'), fmtPctSigned(sim.medianReturn), t('kpi_median_sub'), sim.medianReturn >= 0 ? 'good' : 'bad')}
      ${kpi(t('kpi_pop'), fmtPct(sim.probProfit, 0), t('kpi_pop_sub'), sim.probProfit >= 0.55 ? 'good' : sim.probProfit >= 0.45 ? 'warn' : 'bad', 'kpi-pop')}
      ${kpi(t('kpi_dd'), fmtPct(sim.medianDD), t('kpi_dd_sub', { worst: fmtPct(sim.worstDD) }), 'warn', 'kpi-dd')}
      ${kpi(t('kpi_ruin'), fmtPct(sim.riskOfRuin), t('kpi_ruin_sub', { threshold: fmtPct(ruinThreshold, 0) }), sim.riskOfRuin > 0.05 ? 'bad' : 'good', 'kpi-ruin')}
      ${kpi(t('kpi_kelly'), k.profitable ? fmtPct(k.fStar, 1) : 'N/A', k.profitable ? t('kpi_kelly_sub', { mode: k.modeLabel, rec: fmtPct(k.recommended, 2) }) : t('verdict_noedge'), k.profitable ? 'good' : 'bad', 'kpi-kelly')}
      ${kpi(t('kpi_sig'), sigPct, t('kpi_sig_sub'), sigCls, 'kpi-sig')}
    </div>

    <div class="diag card">
      <h3>${t('diag_title')}</h3>
      <div class="diag-grid">
        <div class="diag-col good"><h4>${t('diag_strengths')}</h4><ul>${findingList(report.findings.strengths)}</ul></div>
        <div class="diag-col bad"><h4>${t('diag_weaknesses')}</h4><ul>${findingList(report.findings.weaknesses)}</ul></div>
        <div class="diag-col risk"><h4>${t('diag_risks')}</h4><ul>${findingList(report.findings.risks)}</ul></div>
        <div class="diag-col action"><h4>${t('diag_actions')}</h4><ul>${findingList(report.findings.actions)}</ul></div>
      </div>
    </div>

    <div class="chart-grid">
      <section class="card panel wide"><h3>${t('chart_equity')}</h3><div class="chart-wrap tall"><canvas id="c-equity"></canvas></div></section>
      <section class="card panel"><h3>${t('chart_dist')}</h3><div class="chart-wrap"><canvas id="c-dist"></canvas></div></section>
      <section class="card panel"><h3>${t('chart_dd')}</h3><div class="chart-wrap"><canvas id="c-dd"></canvas></div></section>
      <section class="card panel"><h3>${t('chart_ruin')}</h3><div class="chart-wrap"><canvas id="c-ruin"></canvas></div></section>
      <section class="card panel"><h3>${t('chart_streaks')}</h3><div class="chart-wrap"><canvas id="c-streaks"></canvas></div></section>
    </div>
  `;

  renderEquity('c-equity', report.bands);
  renderHistogram('c-dist', report.returns);
  renderDrawdownHist('c-dd', report.maxDDs);
  renderRuinProfile('c-ruin', sim.ruinProfile);
  const streakLabels = Array.from({ length: 8 }, (_, i) => `${i + 1}`);
  renderStreaks('c-streaks', report.streaks.winDist.slice(1, 9), report.streaks.lossDist.slice(1, 9),
    streakLabels, { win: t('streak_win'), loss: t('streak_loss') });

  // ── AI cards ────────────────────────────────────────────────────────────────
  const metrics = {
    expectancy:    s.expectancy,
    profitFactor:  s.profitFactor,
    riskOfRuin:    sim.riskOfRuin,
    winRate:       report.effWinRate ?? s.winRate,
    tradeCount:    s.count ?? report.spec?.trades,
    maxDrawdown:   sim.worstDD,
  };

  const diag = diagnostics(metrics);

  window.__sap_currentAnalysis = {
    metrics,
    tradeHistory: report.spec?.sample ?? null,
    diagnostics: diag,
  };

  const aiWrap = document.createElement('div');
  aiWrap.innerHTML = `
    <div id="ai-summary-container" style="margin-top:16px;"></div>
    <div id="ai-weakness-container" style="margin-top:16px;"></div>`;
  mount.appendChild(aiWrap);

  createAISummaryCard(mount.querySelector('#ai-summary-container')).renderSummary(metrics, diag);
  createAIWeaknessPanel(mount.querySelector('#ai-weakness-container')).renderWeaknesses(diag);
}
