// Quick Check: three numbers in → instant verdict. No business logic here;
// it gathers inputs, calls the analysis layer, and renders the shared results.
import { t } from '../i18n.js';
import { slider, select, wireSliders, num, val } from '../controls.js';
import { state, setStrategy } from '../state.js';
import { buildReport } from '../../analysis/report.js';
import { renderReport } from '../results.js';

const KELLY_OPTS = [
  { value: 'full', labelKey: 'kelly_full' },
  { value: 'half', labelKey: 'kelly_half' },
  { value: 'quarter', labelKey: 'kelly_quarter' },
];

export function mountQuickCheck(container) {
  container.innerHTML = `
    <div class="workflow">
      <div class="wf-head"><h2 data-i18n="qc_title"></h2><p class="muted" data-i18n="qc_desc"></p></div>
      <div class="wf-body">
        <aside class="inputs card">
          ${slider({ id: 'qc-winrate', labelKey: 'in_winrate', min: 1, max: 95, step: 1, value: 50, suffix: '%', tipKey: 'tip_winrate' })}
          ${slider({ id: 'qc-rr', labelKey: 'in_rr', min: 0.3, max: 5, step: 0.1, value: 2, suffix: '', tipKey: 'tip_rr', decimals: 1 })}
          ${slider({ id: 'qc-risk', labelKey: 'in_risk', min: 0.1, max: 5, step: 0.1, value: 1, suffix: '%', tipKey: 'tip_risk', decimals: 1 })}
          <details class="adv"><summary data-i18n="advanced"></summary>
            ${slider({ id: 'qc-capital', labelKey: 'in_capital', min: 1000, max: 200000, step: 1000, value: 10000, suffix: '$' })}
            ${slider({ id: 'qc-trades', labelKey: 'in_trades', min: 20, max: 500, step: 10, value: 100, suffix: '' })}
            ${slider({ id: 'qc-cost', labelKey: 'in_cost', min: 0, max: 1, step: 0.01, value: 0.16, suffix: '%', tipKey: 'tip_cost', decimals: 2 })}
            ${slider({ id: 'qc-sims', labelKey: 'in_sims', min: 500, max: 5000, step: 250, value: 2000, suffix: '', tipKey: 'tip_sims' })}
            ${select({ id: 'qc-kelly', labelKey: 'in_kellymode', options: KELLY_OPTS, value: 'half' })}
          </details>
          <button class="btn-primary" id="qc-run" data-i18n="run"></button>
        </aside>
        <div class="results" id="qc-results"><div class="empty muted" data-i18n="empty_run"></div></div>
      </div>
    </div>`;

  const inputs = container.querySelector('.inputs');
  wireSliders(inputs);
  container.querySelector('#qc-run').addEventListener('click', run);

  function readStrategy() {
    return {
      winRate: num('qc-winrate') / 100,
      rr: num('qc-rr'),
      risk: num('qc-risk') / 100,
      capital: num('qc-capital'),
      trades: num('qc-trades'),
      cost: num('qc-cost') / 100,
      sims: num('qc-sims'),
      kellyMode: val('qc-kelly'),
      source: 'quick',
    };
  }

  function run() {
    const strategy = readStrategy();
    setStrategy(strategy);
    const results = container.querySelector('#qc-results');
    results.innerHTML = `<div class="empty muted">${t('loading')}</div>`;
    // Defer so the loading state paints before the (synchronous) compute.
    setTimeout(() => {
      const report = buildReport({ ...strategy, seed: state.seed });
      state.lastReport = report;
      renderReport(report, results);
    }, 20);
  }

  return { run, rerender: () => state.lastReport && state.strategy?.source === 'quick'
    && renderReport(state.lastReport, container.querySelector('#qc-results')) };
}
