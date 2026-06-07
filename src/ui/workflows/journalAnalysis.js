// Journal Analysis: upload real trades → real stats → Monte Carlo from YOUR data.
import { t } from '../i18n.js';
import { slider, wireSliders, num } from '../controls.js';
import { state, setStrategy } from '../state.js';
import { parseCsv, analyzeJournal } from '../../analysis/journal.js';
import { buildReport } from '../../analysis/report.js';
import { renderReport } from '../results.js';

export function mountJournal(container) {
  container.innerHTML = `
    <div class="workflow">
      <div class="wf-head"><h2 data-i18n="jr_title"></h2><p class="muted" data-i18n="jr_desc"></p></div>
      <div class="wf-body">
        <aside class="inputs card">
          <div class="dropzone" id="jr-drop">
            <div data-i18n="jr_drop"></div>
            <div class="muted small" data-i18n="jr_cols"></div>
            <input type="file" id="jr-file" accept=".csv" hidden>
          </div>
          <div id="jr-status" class="jr-status muted small"></div>
          <a href="#" id="jr-sample" class="link small" data-i18n="jr_sample"></a>
          <div class="divider"></div>
          ${slider({ id: 'jr-risk', labelKey: 'in_risk', min: 0.1, max: 5, step: 0.1, value: 1, suffix: '%', tipKey: 'tip_risk', decimals: 1 })}
          ${slider({ id: 'jr-cost', labelKey: 'in_cost', min: 0, max: 1, step: 0.01, value: 0.1, suffix: '%', tipKey: 'tip_cost', decimals: 2 })}
          ${slider({ id: 'jr-capital', labelKey: 'in_capital', min: 1000, max: 200000, step: 1000, value: 10000, suffix: '$' })}
          ${slider({ id: 'jr-sims', labelKey: 'in_sims', min: 500, max: 5000, step: 250, value: 2000, suffix: '', tipKey: 'tip_sims' })}
          <button class="btn-primary" id="jr-run" data-i18n="run" disabled></button>
        </aside>
        <div class="results" id="jr-results"><div class="empty muted" data-i18n="jr_drop"></div></div>
      </div>
    </div>`;

  const inputs = container.querySelector('.inputs');
  wireSliders(inputs);
  const drop = container.querySelector('#jr-drop');
  const file = container.querySelector('#jr-file');
  const statusEl = container.querySelector('#jr-status');
  const runBtn = container.querySelector('#jr-run');
  let analysis = null;

  drop.addEventListener('click', () => file.click());
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault(); drop.classList.remove('over');
    if (e.dataTransfer.files.length) load(e.dataTransfer.files[0]);
  });
  file.addEventListener('change', (e) => { if (e.target.files.length) load(e.target.files[0]); });
  container.querySelector('#jr-sample').addEventListener('click', (e) => { e.preventDefault(); downloadSample(); });
  runBtn.addEventListener('click', run);

  function load(f) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const parsed = parseCsv(e.target.result);
      if (parsed.error) {
        statusEl.innerHTML = `<span class="bad">${t(`jr_err_${parsed.error}`)}</span>`;
        runBtn.disabled = true; analysis = null;
        return;
      }
      analysis = analyzeJournal(parsed);
      const basis = analysis.rBasis === 'explicit' ? t('jr_basis_explicit') : t('jr_basis_normalized');
      statusEl.innerHTML = `<span class="good">${t('jr_loaded', { n: analysis.count })}</span> · ${basis}`;
      runBtn.disabled = false;
    };
    reader.readAsText(f);
  }

  function run() {
    if (!analysis) return;
    const s = analysis.stats;
    const strategy = {
      winRate: s.winRate,
      rr: Number.isFinite(s.payoffRatio) ? s.payoffRatio : 3,
      risk: num('jr-risk') / 100,
      cost: num('jr-cost') / 100,
      capital: num('jr-capital'),
      trades: analysis.count,
      sims: num('jr-sims'),
      sample: analysis.rSample,
      realStats: s,
      source: 'journal',
    };
    setStrategy(strategy);
    const results = container.querySelector('#jr-results');
    results.innerHTML = `<div class="empty muted">${t('loading')}</div>`;
    setTimeout(() => {
      const report = buildReport({ ...strategy, seed: state.seed });
      state.lastReport = report;
      renderReport(report, results);
    }, 20);
  }

  return {
    rerender: () => {
      if (state.lastReport && state.strategy?.source === 'journal') {
        renderReport(state.lastReport, container.querySelector('#jr-results'));
      }
    },
  };
}

// A small, realistic sample journal (positive but imperfect edge).
function downloadSample() {
  const rows = [['date', 'pnl', 'r_multiple']];
  let day = new Date('2024-01-01');
  const seq = [2, -1, 1.5, -1, 3, -1, -1, 2, 1, -1, -1, 2.5, -1, 1, 2, -1, -1, -1, 2, 1.5,
    -1, 2, -1, 1, -1, 3, -1, -1, 2, 1, -1, 2, -1, -1, 1.5, 2, -1, 1, -1, 2];
  for (const r of seq) {
    day.setDate(day.getDate() + 1);
    rows.push([day.toISOString().slice(0, 10), (r * 100).toFixed(0), r.toString()]);
  }
  const csv = rows.map((r) => r.join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'sample_journal.csv';
  a.click();
}
