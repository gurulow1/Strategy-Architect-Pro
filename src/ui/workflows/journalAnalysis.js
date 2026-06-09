// Journal Analysis: upload real trades → real stats → Monte Carlo from YOUR data.
import { t } from '../i18n.js';
import { slider, wireSliders, num } from '../controls.js';
import { state, setStrategy } from '../state.js';
import { analyzeJournal } from '../../analysis/journal.js';
import { buildReport } from '../../analysis/report.js';
import { renderReport } from '../results.js';
import { createAIJournalParser } from '../aiComponents.js';

export function mountJournal(container) {
  container.innerHTML = `
    <div class="workflow">
      <div class="wf-head"><h2 data-i18n="jr_title"></h2><p class="muted" data-i18n="jr_desc"></p></div>
      <div class="wf-body">
        <aside class="inputs card">
          <div id="jr-ai-parser"></div>
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
  const runBtn = container.querySelector('#jr-run');
  let analysis = null;

  createAIJournalParser(container.querySelector('#jr-ai-parser'), (aiTrades) => {
    // Number.isFinite (not `typeof === 'number'`) — the latter is TRUE for NaN
    // and would let a malformed value through and break the whole calculation.
    const mapped = (aiTrades || []).map((tr) => ({
      date: tr.date || null,
      pnl:  Number.isFinite(tr.pnl) ? tr.pnl : null,
      r:    Number.isFinite(tr.r_multiple) ? tr.r_multiple : null,
    }));
    const trades = mapped.filter((tr) => tr.pnl !== null || tr.r !== null);
    const dropped = mapped.length - trades.length;

    if (trades.length < 5) {
      container.querySelector('#jr-results').innerHTML =
        `<div class="empty muted bad">${t('jr_err_too_few_trades') || 'Not enough trades (need at least 5).'}</div>`;
      return;
    }

    analysis = analyzeJournal({ trades });
    runBtn.disabled = false;
    run(dropped);
  });

  runBtn.addEventListener('click', run);

  function run(dropped = 0) {
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
      if (dropped > 0) {
        const note = document.createElement('div');
        note.className = 'small muted';
        note.style.margin = '0 0 12px';
        note.textContent = `Note: ${dropped} row${dropped === 1 ? '' : 's'} skipped (missing or invalid values).`;
        results.insertBefore(note, results.firstChild);
      }
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
