// Position Size Calculator: the trader's most immediate question — "how much do
// I put on this trade?" — answered in real time. Standalone: works with no
// journal loaded. If an analysis has been run, it pre-fills the Kelly-optimal risk.
import { t } from '../i18n.js';
import { state } from '../state.js';

// $ value of 1 pip per standard lot (approximate for USD-quoted majors).
const PIP_VALUES = {
  EURUSD: 10, GBPUSD: 10, AUDUSD: 10, NZDUSD: 10,
  USDCAD: 7.7, USDCHF: 10.9, USDJPY: 9.0,
  XAUUSD: 1.0, BTCUSD: 1.0,
};

export function mountPositionCalc(container, lastReport = null) {
  container.innerHTML = `
    <div class="workflow">
      <div class="wf-head">
        <h2>${t('pos_calc_title')}</h2>
        <p class="muted">${t('pos_calc_desc')}</p>
      </div>

      <div class="pos-calc card pad">
        <div class="pos-form">
          <label>${t('pos_calc_balance')}
            <div class="input-wrap"><span class="input-prefix">$</span>
              <input id="pc-balance" type="number" min="100" step="100" value="10000">
            </div>
          </label>

          <label>${t('pos_calc_risk')}
            <div class="input-wrap">
              <input id="pc-risk" type="number" min="0.1" max="20" step="0.1" value="1">
              <span class="input-suffix">%</span>
            </div>
          </label>

          <label>${t('pos_calc_sl_mode')}
            <select id="pc-sl-mode">
              <option value="dollars">${t('pos_calc_sl_dollars')}</option>
              <option value="pips">${t('pos_calc_sl_pips')}</option>
              <option value="percent">${t('pos_calc_sl_percent')}</option>
            </select>
          </label>

          <label id="pc-sl-label">${t('pos_calc_sl_dollars')}
            <input id="pc-sl" type="number" min="1" step="1" value="100">
          </label>

          <label id="pc-instr-row" style="display:none">${t('pos_calc_instrument')}
            <select id="pc-instrument">
              <option value="EURUSD">EURUSD (0.0001 / lot)</option>
              <option value="GBPUSD">GBPUSD (0.0001 / lot)</option>
              <option value="USDJPY">USDJPY (0.01 / lot)</option>
              <option value="XAUUSD">XAUUSD (0.01 / lot)</option>
              <option value="BTCUSD">BTCUSD (1.0 / lot)</option>
              <option value="custom">${t('pos_calc_custom')}</option>
            </select>
          </label>
        </div>

        <div class="pos-result card" id="pc-result">
          <div class="pos-result-main">
            <div class="pos-line">
              <span>${t('pos_calc_risk_amount')}</span>
              <strong id="pc-out-risk">$100</strong>
            </div>
            <div class="pos-line" id="pc-lot-row">
              <span>${t('pos_calc_lotsize')}</span>
              <strong id="pc-out-lot">—</strong>
            </div>
          </div>
          <div class="pos-kelly-note muted small" id="pc-kelly-note"></div>
        </div>
      </div>
    </div>`;

  const q = (id) => container.querySelector('#' + id);

  function calculate() {
    const balance = parseFloat(q('pc-balance').value) || 0;
    const riskPct = parseFloat(q('pc-risk').value) || 0;
    const slMode = q('pc-sl-mode').value;
    const slVal = parseFloat(q('pc-sl').value) || 0;

    const riskAmount = balance * riskPct / 100;
    q('pc-out-risk').textContent = '$' + riskAmount.toFixed(2);

    let lotSize = null;
    if (slMode === 'dollars' && slVal > 0) {
      lotSize = riskAmount / slVal;
    } else if (slMode === 'pips' && slVal > 0) {
      const instr = q('pc-instrument').value;
      const pipVal = PIP_VALUES[instr] || null;
      if (pipVal) lotSize = riskAmount / (slVal * pipVal);
    } else if (slMode === 'percent' && slVal > 0) {
      const slDollars = balance * slVal / 100;
      if (slDollars > 0) lotSize = riskAmount / slDollars;
    }

    const lotEl = q('pc-out-lot');
    const lotRow = q('pc-lot-row');
    if (lotSize !== null && Number.isFinite(lotSize) && lotSize > 0) {
      lotEl.textContent = lotSize.toFixed(2) + ' lots';
      lotRow.style.display = '';
    } else {
      // For a custom/unknown pip instrument we genuinely can't size — hide the row.
      lotRow.style.display = slMode === 'dollars' ? '' : 'none';
      lotEl.textContent = '—';
    }
  }

  // Toggle the instrument selector + stop-loss field label with the SL mode.
  function syncMode() {
    const mode = q('pc-sl-mode').value;
    q('pc-instr-row').style.display = mode === 'pips' ? '' : 'none';
    const labelKey = mode === 'pips' ? 'pos_calc_sl_pips'
      : mode === 'percent' ? 'pos_calc_sl_percent' : 'pos_calc_sl_dollars';
    // First text node of the label carries the caption (the <input> follows it).
    q('pc-sl-label').childNodes[0].nodeValue = t(labelKey) + ' ';
    calculate();
  }

  // Pre-fill the Kelly-optimal risk if a journal/quick-check report exists.
  function applyKelly() {
    const rep = lastReport || state.lastReport;
    const note = q('pc-kelly-note');
    if (rep?.kelly?.recommended > 0) {
      const rec = (rep.kelly.recommended * 100).toFixed(2);
      q('pc-risk').value = rec;
      note.textContent = t('pos_calc_kelly_note', { mode: rep.kelly.modeLabel, rec: rec + '%' });
    } else {
      note.textContent = '';
    }
    calculate();
  }

  container.querySelectorAll('input, select').forEach((el) => {
    el.addEventListener('input', calculate);
  });
  q('pc-sl-mode').addEventListener('change', syncMode);

  syncMode();
  applyKelly();

  return {
    // On re-entry (e.g. after running an analysis), refresh the Kelly pre-fill.
    rerender: () => applyKelly(),
  };
}
