// Prop Challenge Mode: will the current strategy pass a funded challenge,
// and at what risk? Sweeps risk levels and recommends the best.
import { t } from '../i18n.js';
import { slider, select, checkbox, wireSliders, num, val, checked, makeInputsCollapsible, collapseInputsOnMobile } from '../controls.js';
import { state } from '../state.js';
import { fmtPct, fmtNum } from '../format.js';
import { PROP_PRESETS } from '../../engine/propChallenge.js';
import { recommendPropRisk } from '../../analysis/report.js';
import { renderPropLadder } from '../charts.js';
import { createPropCoachCard } from '../aiComponents.js';
import { callAI } from '../../services/aiClient.js';
import { diagnostics } from '../../engine/diagnostics.js';
import { completeTrial } from '../auth.js';

export function mountProp(container) {
  const presetOptions = Object.entries(PROP_PRESETS)
    .map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('')
    + `<option value="custom">${t('prop_custom')}</option>`;

  container.innerHTML = `
    <div class="workflow">
      <div class="wf-head"><h2 data-i18n="prop_title"></h2><p class="muted" data-i18n="prop_desc"></p></div>
      <div class="wf-body">
        <aside class="inputs card">
          <div class="control"><div class="control-head"><span data-i18n="prop_firm"></span></div>
            <select id="pp-firm" class="select">${presetOptions}</select></div>
          ${slider({ id: 'pp-daily', labelKey: 'prop_daily', min: 1, max: 10, step: 0.5, value: 5, suffix: '%', decimals: 1 })}
          ${slider({ id: 'pp-max', labelKey: 'prop_max', min: 3, max: 20, step: 0.5, value: 10, suffix: '%', decimals: 1 })}
          ${slider({ id: 'pp-target', labelKey: 'prop_target', min: 4, max: 20, step: 0.5, value: 10, suffix: '%', decimals: 1 })}
          ${slider({ id: 'pp-days', labelKey: 'prop_days', min: 5, max: 60, step: 1, value: 30, suffix: '' })}
          ${checkbox({ id: 'pp-trailing', labelKey: 'prop_trailing' })}
          <button class="btn-primary" id="pp-run" data-i18n="prop_eval"></button>
        </aside>
        <div class="results" id="pp-results">
          <div class="empty-state card pad">
            <div class="empty-state-icon">🏆</div>
            <div class="empty-state-title" data-i18n="prop_empty_title"></div>
            <div class="empty-state-sub muted" data-i18n="prop_empty_sub"></div>
          </div>
        </div>
      </div>
    </div>`;

  const inputs = container.querySelector('.inputs');
  wireSliders(inputs);
  makeInputsCollapsible(container);
  const firmSel = container.querySelector('#pp-firm');
  firmSel.addEventListener('change', () => applyPreset(container, firmSel.value));
  applyPreset(container, firmSel.value);
  container.querySelector('#pp-run').addEventListener('click', () => run(container));

  return { rerender: () => {} };
}

function applyPreset(container, key) {
  const p = PROP_PRESETS[key];
  if (!p) return; // custom: leave as-is
  setSlider(container, 'pp-daily', p.dailyLossLimit * 100);
  setSlider(container, 'pp-max', p.maxLossLimit * 100);
  setSlider(container, 'pp-target', p.profitTarget * 100);
  container.querySelector('#pp-trailing').checked = !!p.trailing;
}

function setSlider(container, id, value) {
  const el = container.querySelector(`#${id}`);
  el.value = value;
  el.dispatchEvent(new Event('input'));
}

function run(container) {
  const results = container.querySelector('#pp-results');
  const strat = state.strategy;
  if (!strat) {
    results.innerHTML = `
      <div class="empty-state card pad">
        <div class="empty-state-icon">🏆</div>
        <div class="empty-state-title">${t('prop_empty_title')}</div>
        <div class="empty-state-sub muted">${t('prop_empty_sub')}</div>
      </div>`;
    return;
  }

  const rules = {
    capital: strat.capital,
    dailyLossLimit: num('pp-daily') / 100,
    maxLossLimit: num('pp-max') / 100,
    profitTarget: num('pp-target') / 100,
    trailing: checked('pp-trailing'),
  };
  const base = {
    trades: strat.trades,
    propDays: num('pp-days'),
    cost: strat.cost,
    winRate: strat.winRate,
    rr: strat.rr,
    sample: strat.sample || null,
  };

  results.innerHTML = `<div class="empty muted">${t('loading')}</div>`;
  setTimeout(() => {
    const { ladder, recommended } = recommendPropRisk(base, rules, { seed: state.seed, sims: 1500 });
    const rec = recommended;
    const passCls = rec.passRate >= 0.4 ? 'good' : rec.passRate >= 0.2 ? 'warn' : 'bad';
    results.innerHTML = `
      <div class="verdict card ${passCls}">
        <div class="verdict-main">
          <div class="verdict-score">${fmtPct(rec.passRate, 0)}</div>
          <div><div class="verdict-grade ${passCls}">${t('prop_pass')}</div>
          <div class="verdict-sub">${t('prop_rec_desc', { risk: fmtPct(rec.risk, 2), pass: fmtPct(rec.passRate, 0) })}</div></div>
        </div>
      </div>
      <div class="kpi-grid">
        ${kpiCard(t('prop_rec_risk'), fmtPct(rec.risk, 2), t('per_trade'), 'good')}
        ${kpiCard(t('prop_daily_viol'), fmtPct(rec.dailyViolationRate, 0), '', rec.dailyViolationRate > 0.3 ? 'bad' : 'warn')}
        ${kpiCard(t('prop_max_viol'), fmtPct(rec.maxViolationRate, 0), '', rec.maxViolationRate > 0.3 ? 'bad' : 'warn')}
        ${kpiCard(t('prop_timeout'), fmtPct(rec.timeoutRate, 0), '', 'warn')}
        ${kpiCard(t('prop_attempts'), Number.isFinite(rec.expectedAttempts) ? fmtNum(rec.expectedAttempts, 1) : '∞', '', 'info')}
      </div>
      <section class="card panel wide"><h3 data-i18n="prop_ladder"></h3>
        <div class="chart-wrap tall"><canvas id="c-ladder"></canvas></div></section>`;
    renderPropLadder('c-ladder', ladder, rec.risk);
    completeTrial().catch(() => {});
    // re-apply data-i18n on freshly injected nodes
    results.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.getAttribute('data-i18n')); });
    collapseInputsOnMobile(container);
    if (window.innerWidth <= 768) {
      requestAnimationFrame(() => results.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    }

    // ── Prop Coach AI card ─────────────────────────────────────────────────
    const coachContainer = document.createElement('div');
    coachContainer.style.marginTop = '16px';
    results.appendChild(coachContainer);
    const coach = createPropCoachCard(coachContainer);

    const propMetrics = {
      expectancy:    strat.rr * strat.winRate - (1 - strat.winRate),
      profitFactor:  strat.winRate > 0 && strat.winRate < 1
        ? (strat.winRate * strat.rr) / (1 - strat.winRate)
        : 0,
      riskOfRuin:    rec.maxViolationRate,
      winRate:       strat.winRate,
      tradeCount:    strat.trades,
      maxDrawdown:   rec.maxViolationRate,
      prop: {
        passRate:             rec.passRate,
        dailyViolationRate:   rec.dailyViolationRate,
        maxViolationRate:     rec.maxViolationRate,
      },
    };
    const diag = diagnostics(propMetrics);

    callAI('generateSummary', { metrics: propMetrics, diagnostics: diag })
      .then((summary) => coach.renderCoach(summary))
      .catch(() => coach.renderCoach(null));
  }, 20);
}

function kpiCard(label, value, sub, cls) {
  return `<div class="kpi card"><div class="kpi-label">${label}</div>
    <div class="kpi-num ${cls}">${value}</div><div class="kpi-sub">${sub}</div></div>`;
}
