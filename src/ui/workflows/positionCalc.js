// Risk Sensitivity Panel — the laboratory's answer to "what changes if I push
// my risk, or pull back?". Reads the last journal/quick-check report and runs a
// light Monte Carlo sweep across risk levels on the SAME trade distribution, so
// the trader can see how return, drawdown and risk-of-ruin move with risk.
//
// No business logic of its own: every number comes from the pure engine
// (simulate / riskOfRuin / stats). When no analysis has been run, it shows a
// call-to-action placeholder instead.
import { t } from '../i18n.js';
import { state } from '../state.js';
import { fmtPct, fmtPctSigned, fmtValue } from '../format.js';
import { simulate } from '../../engine/simulate.js';
import { createRng } from '../../engine/rng.js';
import { riskOfRuin } from '../../engine/riskOfRuin.js';
import { mean, median, percentile } from '../../engine/stats.js';
import { buildRiskContract } from '../../analysis/riskContract.js';

const RISK_CONTRACT_KEY = 'sap_risk_contract_v1';
const CONFIDENCE_LEVELS = new Set(['low', 'medium', 'high']);
const PAUSE_REASONS = new Set(['non_positive_expectancy', 'high_ruin', 'insufficient_data']);

function validStoredContract(contract) {
  return contract?.version === 1
    && CONFIDENCE_LEVELS.has(contract.confidence)
    && typeof contract.hardPause === 'boolean'
    && Array.isArray(contract.hardPauseReasons)
    && contract.hardPauseReasons.every((reason) => PAUSE_REASONS.has(reason))
    && ['maxRiskPerTrade', 'dailyStop', 'weeklyStop', 'drawdownReview']
      .every((key) => Number.isFinite(contract[key]) && contract[key] >= 0)
    && Number.isInteger(contract.pauseAfterLosses)
    && contract.pauseAfterLosses >= 1;
}

function loadRiskContract() {
  try {
    const stored = JSON.parse(localStorage.getItem(RISK_CONTRACT_KEY));
    return validStoredContract(stored?.contract) ? stored : null;
  } catch {
    return null;
  }
}

function saveRiskContract(contract) {
  try {
    localStorage.setItem(RISK_CONTRACT_KEY, JSON.stringify({
      contract,
      acceptedAt: new Date().toISOString(),
    }));
    return true;
  } catch {
    return false;
  }
}

function removeRiskContract() {
  try {
    localStorage.removeItem(RISK_CONTRACT_KEY);
    return true;
  } catch {
    return false;
  }
}

function sameContract(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

// Always sweep 0.25% → 3% in 8 equal steps. This is the PRACTICAL trading range;
// Kelly may sit above it (a high-edge strategy can recommend 10%+), in which case
// the panel shows a warning rather than charting absurd risk levels.
function buildLevels() {
  const PRACTICAL_MAX = 0.03;
  const minLevel = 0.0025;
  const step = (PRACTICAL_MAX - minLevel) / 7;
  return Array.from({ length: 8 }, (_, i) => Math.round((minLevel + step * i) * 10000) / 10000);
}

// ── Entry points ─────────────────────────────────────────────────────────────
export function mountPositionCalc(container) {
  render(container);
  // selectTab() calls controller.rerender() on every tab entry — picking up a
  // freshly run analysis without a manual refresh.
  return { rerender: () => render(container) };
}

// Called by app.js right after an analysis completes, so the panel updates even
// while the user is already looking at it (no tab switch needed).
export function refreshPositionCalc(container) {
  if (container) render(container);
}

function render(container) {
  const report = state.lastReport;
  if (!report) {
    renderPlaceholder(container);
  } else {
    renderSensitivityPanel(container, report);
  }
}

// ── Placeholder (no analysis loaded) ─────────────────────────────────────────
function renderPlaceholder(container) {
  const stored = loadRiskContract();
  container.innerHTML = `
    <div class="workflow">
      <div class="wf-head">
        <h2>${t('risk_panel_title')}</h2>
        <p class="muted">${t('risk_panel_desc')}</p>
      </div>
      ${stored ? renderRiskContractBlock(null, stored) : ''}
      <div class="empty-state card pad">
        <div class="empty-state-title">${t('risk_panel_no_data')}</div>
        <div class="empty-state-sub muted">${t('risk_panel_no_data_sub')}</div>
      </div>
    </div>`;
  wireRiskContractActions(container, null);
}

// ── BLOC A — strategy summary header ─────────────────────────────────────────
function renderStrategyHeader(report) {
  const s = report.status;
  const k = report.kelly;
  const sim = report.sim;
  const ts = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const dot = { green: '🟢', yellow: '🟡', red: '🔴' }[s?.color] || '⚪';

  return `
    <div class="card pad risk-header">
      <div class="risk-header-row">
        <div class="risk-status">
          <span class="risk-dot">${dot}</span>
          <span class="risk-status-text">${t(s?.textKey || 'status_yellow')}</span>
        </div>
        <div class="risk-ts muted small">${t('risk_updated', { time: ts })}</div>
      </div>
      <div class="risk-metrics">
        <div class="risk-metric">
          <div class="risk-metric-label">${t('kpi_kelly')}</div>
          <div class="risk-metric-val">${k.profitable ? fmtPct(k.fStar, 1) : 'N/A'}</div>
          <div class="risk-metric-sub">${k.profitable ? t('kpi_kelly_sub', { mode: k.modeLabel, rec: fmtPct(k.recommended, 2) }) : ''}</div>
        </div>
        <div class="risk-metric">
          <div class="risk-metric-label">${t('kpi_ruin')}</div>
          <div class="risk-metric-val ${sim.riskOfRuin > 0.1 ? 'bad' : 'good'}">${fmtPct(sim.riskOfRuin)}</div>
          <div class="risk-metric-sub">${t('kpi_ruin_sub', { threshold: '50%' })}</div>
        </div>
        <div class="risk-metric">
          <div class="risk-metric-label">${t('kpi_sig')}</div>
          <div class="risk-metric-val">${fmtPct(report.edge.pAboveZero, 0)}</div>
          <div class="risk-metric-sub">${t('kpi_sig_sub')}</div>
        </div>
      </div>
    </div>`;
}

// ── BLOC B — risk sensitivity sweep ──────────────────────────────────────────
// Run once when the panel loads. 800 sims/level is lighter than the main run
// (2000) but honest enough to compare levels — and fast enough for real time.
function precomputeSensitivity(report, levels) {
  const { spec } = report;
  const base = {
    capital: spec.capital,
    trades: spec.trades,
    sims: 800,
    costPerTrade: spec.costPerTrade || 0,
    sample: spec.sample || null,
    winRate: report.effWinRate,
    rr: report.effRr,
    collectRealizedR: false,
    collectBandCurves: false,
  };

  return levels.map((risk, i) => {
    const rng = createRng(42 + i * 17);
    const res = simulate({ ...base, risk }, rng);
    return {
      risk,
      meanRet: mean(res.returns),
      medDD: median(res.maxDDs),
      ror: riskOfRuin(res.ddFromStart, 0.5),
      p10: percentile(res.returns, 0.1),
    };
  });
}

function renderSensitivityBlock(levels, kellyRisk, defaultRisk = kellyRisk) {
  // Index of the level closest to the Kelly-recommended risk.
  const kellyIdx = levels.reduce((best, l, i) =>
    (Math.abs(l.risk - kellyRisk) < Math.abs(levels[best].risk - kellyRisk) ? i : best), 0);
  const selectedIdx = levels.reduce((best, l, i) =>
    (Math.abs(l.risk - defaultRisk) < Math.abs(levels[best].risk - defaultRisk) ? i : best), 0);

  const sliderHtml = `
    <div class="risk-slider-wrap">
      <label class="risk-slider-label">
        <span>${t('risk_level_label')}</span>
        <strong id="rs-risk-display">${fmtPct(levels[selectedIdx].risk, 2)}</strong>
      </label>
      <input id="rs-slider" type="range" min="0" max="${levels.length - 1}"
             step="1" value="${selectedIdx}" class="risk-slider">
      <div class="risk-slider-ticks">
        ${levels.map((l) => `<span>${fmtPct(l.risk, 2)}</span>`).join('')}
      </div>
    </div>`;

  const rows = levels.map((l, i) => {
    const isKelly = i === kellyIdx;
    const color = l.ror > 0.15 ? 'bad' : l.ror < 0.05 ? 'good' : '';
    return `<tr class="rs-row ${isKelly ? 'rs-kelly' : ''} ${i === selectedIdx ? 'rs-selected' : ''}" data-idx="${i}">
      <td>${fmtPct(l.risk, 2)}${isKelly ? ' ★' : ''}</td>
      <td class="${l.meanRet >= 0 ? 'good' : 'bad'}">${fmtPctSigned(l.meanRet)}</td>
      <td class="warn">${fmtPct(l.medDD)}</td>
      <td class="${color}">${fmtPct(l.ror)}</td>
      <td class="muted small">${fmtPctSigned(l.p10)}</td>
    </tr>`;
  }).join('');

  // When Kelly sits above the practical 3% ceiling, the ★ marks the closest row
  // and we warn instead of pretending the table covers the optimum.
  const kellyNote = kellyRisk > 0.03
    ? `<div class="notice warn" style="margin-top:10px;font-size:12px;">
        ${t('risk_sens_kelly_above', { kelly: fmtPct(kellyRisk, 1), practical: '3%' })}
       </div>`
    : `<div class="risk-sens-legend muted small" style="margin-top:8px;">
        ${t('risk_sens_kelly_note', { kelly: fmtPct(kellyRisk, 2) })}
       </div>`;

  return `
    <div class="card pad">
      <h3>${t('risk_sens_title')}</h3>
      <p class="muted small">${t('risk_sens_desc')}</p>
      ${sliderHtml}
      <div class="table-wrap"><table class="data-table" id="rs-table">
        <thead>
          <tr>
            <th>${t('risk_sens_col_risk')}</th>
            <th>${t('risk_sens_col_return')}</th>
            <th>${t('risk_sens_col_dd')}</th>
            <th>${t('risk_sens_col_ruin')}</th>
            <th>${t('risk_sens_col_p10')}</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table></div>
      ${kellyNote}
    </div>`;
}

// ── BLOC C — drawdown recovery calculator ────────────────────────────────────
function renderRecoveryBlock(report) {
  return `
    <div class="card pad">
      <h3>${t('recovery_title')}</h3>
      <p class="muted small">${t('recovery_desc')}</p>
      <div class="pos-form recovery-form">
        <label>${t('recovery_dd_input')}
          <div class="input-wrap">
            <input id="rc-dd" type="number" min="1" max="90" step="1" value="20">
            <span class="input-suffix">%</span>
          </div>
        </label>
        <label>${t('recovery_balance')}
          <div class="input-wrap">
            <span class="input-prefix">$</span>
            <input id="rc-balance" type="number" min="100" step="100" value="${report.spec?.capital || 10000}">
          </div>
        </label>
      </div>
      <div class="pos-result card recovery-result" id="rc-result">
        <div class="pos-line">
          <span>${t('recovery_loss_amount')}</span>
          <strong id="rc-out-loss">—</strong>
        </div>
        <div class="pos-line">
          <span>${t('recovery_trades_needed')}</span>
          <strong id="rc-out-trades">—</strong>
        </div>
        <div class="pos-line">
          <span>${t('recovery_gain_needed')}</span>
          <strong id="rc-out-pct">—</strong>
        </div>
      </div>
      <div class="muted small" style="margin-top:8px;">${t('recovery_note', { exp: fmtValue(report.stats.expectancy, report.displayUnit || 'R', report.currencySymbol || '$') })}</div>
    </div>`;
}

function renderContractMetrics(contract) {
  const paused = contract.hardPause;
  const pct = (value) => paused ? '—' : fmtPct(value, 2);
  return `
    <div class="risk-metrics">
      <div class="risk-metric">
        <div class="risk-metric-label">${t('risk_contract_trade')}</div>
        <div class="risk-metric-val">${paused ? t('risk_contract_paused') : fmtPct(contract.maxRiskPerTrade, 2)}</div>
      </div>
      <div class="risk-metric">
        <div class="risk-metric-label">${t('risk_contract_daily')}</div>
        <div class="risk-metric-val">${pct(contract.dailyStop)}</div>
      </div>
      <div class="risk-metric">
        <div class="risk-metric-label">${t('risk_contract_weekly')}</div>
        <div class="risk-metric-val">${pct(contract.weeklyStop)}</div>
      </div>
      <div class="risk-metric">
        <div class="risk-metric-label">${t('risk_contract_streak')}</div>
        <div class="risk-metric-val">${paused
          ? t('risk_contract_now')
          : t('risk_contract_losses_value', { n: contract.pauseAfterLosses })}</div>
      </div>
      <div class="risk-metric">
        <div class="risk-metric-label">${t('risk_contract_drawdown')}</div>
        <div class="risk-metric-val">${pct(contract.drawdownReview)}</div>
      </div>
    </div>`;
}

function renderPauseNotice(contract) {
  if (!contract.hardPause) return '';
  const reasons = contract.hardPauseReasons
    .map((reason) => t(`risk_contract_reason_${reason}`))
    .join(' ');
  return `<div class="notice bad">${t('risk_contract_hard_pause')} ${reasons}</div>`;
}

function renderRiskContractBlock(proposed, stored) {
  const active = stored?.contract || null;
  const changed = Boolean(active && proposed && !sameContract(active, proposed));
  const shown = active || proposed;
  if (!shown) return '';
  const badge = active
    ? `<span class="badge good">${t('risk_contract_active')}</span>`
    : `<span class="badge muted">${t('risk_contract_draft')}</span>`;

  return `
    <div class="card pad">
      <h3>${t('risk_contract_title')} ${badge}</h3>
      <p class="muted small">${t('risk_contract_desc')}</p>
      <div class="small" style="margin-bottom:14px;">
        ${t('risk_contract_confidence', { level: t(`risk_contract_conf_${shown.confidence}`) })}
      </div>
      ${renderContractMetrics(shown)}
      ${renderPauseNotice(shown)}
      ${changed ? `
        <div class="notice ${proposed.hardPause ? 'bad' : 'warn'}">${t('risk_contract_update_available')}</div>
        <h4 style="margin-top:16px;">${t('risk_contract_updated_draft')}</h4>
        <div class="small" style="margin-bottom:14px;">
          ${t('risk_contract_confidence', { level: t(`risk_contract_conf_${proposed.confidence}`) })}
        </div>
        ${renderContractMetrics(proposed)}
        ${renderPauseNotice(proposed)}
      ` : ''}
      <p class="muted small">${t('risk_contract_local_note')}</p>
      <div style="display:flex;gap:10px;flex-wrap:wrap;">
        ${proposed && (!active || changed)
          ? `<button class="btn-primary" id="risk-contract-accept">${t(active ? 'risk_contract_update' : 'risk_contract_accept')}</button>`
          : ''}
        ${active ? `<button class="btn-secondary" id="risk-contract-remove">${t('risk_contract_remove')}</button>` : ''}
      </div>
      <div class="small bad" id="risk-contract-error" hidden>${t('risk_contract_storage_error')}</div>
    </div>`;
}

function wireRiskContractActions(container, proposed) {
  container.querySelector('#risk-contract-accept')?.addEventListener('click', () => {
    if (saveRiskContract(proposed)) render(container);
    else container.querySelector('#risk-contract-error').hidden = false;
  });
  container.querySelector('#risk-contract-remove')?.addEventListener('click', () => {
    if (removeRiskContract()) render(container);
    else container.querySelector('#risk-contract-error').hidden = false;
  });
}

function updateRecovery(report, container) {
  const ddPct = parseFloat(container.querySelector('#rc-dd').value) || 0;
  const balance = parseFloat(container.querySelector('#rc-balance').value) || 0;
  const exp = report.stats.expectancy; // per trade, in displayUnit

  const q = (id) => container.querySelector(id);
  if (ddPct <= 0 || balance <= 0 || !Number.isFinite(exp) || exp <= 0) {
    q('#rc-out-loss').textContent = '—';
    q('#rc-out-trades').textContent = '—';
    q('#rc-out-pct').textContent = '—';
    return;
  }

  const lossAmount = balance * ddPct / 100;
  const reducedBalance = balance - lossAmount;
  // Gain needed as a % of the (reduced) balance to get back to even.
  const gainPct = reducedBalance > 0 ? lossAmount / reducedBalance * 100 : Infinity;

  // Linear approximation of trades-to-recover (NOT compound — kept simple to
  // explain). In currency mode expectancy is already $/trade; in R mode we
  // translate R × risk × balance into $/trade.
  let tradesNeeded = null;
  if (report.displayUnit === 'currency' && exp > 0) {
    tradesNeeded = Math.ceil(lossAmount / exp);
  } else if (exp > 0 && report.spec?.risk > 0) {
    const dollarPerTrade = exp * report.spec.risk * reducedBalance;
    if (dollarPerTrade > 0) tradesNeeded = Math.ceil(lossAmount / dollarPerTrade);
  }

  q('#rc-out-loss').textContent = '$' + lossAmount.toLocaleString('en-US', { maximumFractionDigits: 0 });
  q('#rc-out-trades').textContent = tradesNeeded !== null
    ? (tradesNeeded <= 1
        ? t('recovery_less_than_one')
        : `~${tradesNeeded} ${t('recovery_trades_unit')}`)
    : t('recovery_trades_na');
  q('#rc-out-pct').textContent = Number.isFinite(gainPct) ? gainPct.toFixed(1) + '%' : '—';
}

// ── Full panel ───────────────────────────────────────────────────────────────
async function renderSensitivityPanel(container, report) {
  const kellyRisk = report.kelly.recommended > 0 ? report.kelly.recommended : report.spec.risk;
  const proposedContract = buildRiskContract(report);
  const defaultRisk = proposedContract.hardPause
    ? 0.0025
    : proposedContract.maxRiskPerTrade;

  // Paint a loading state before the (synchronous) sweep so the UI never freezes
  // on a blank frame.
  container.innerHTML = `
    <div class="workflow">
      <div class="wf-head">
        <h2>${t('risk_panel_title')}</h2>
        <p class="muted">${t('risk_panel_desc')}</p>
      </div>
      <div class="muted" style="padding:40px;text-align:center;">${t('risk_panel_computing')}</div>
    </div>`;

  await new Promise((r) => setTimeout(r, 0));
  // The panel may have been re-rendered (tab switch / new analysis) while we
  // yielded — bail if our loading node is no longer in the DOM.
  if (!container.querySelector('.workflow')) return;
  const levelsArr = buildLevels();
  const levels = precomputeSensitivity(report, levelsArr);

  container.innerHTML = `
    <div class="workflow">
      <div class="wf-head">
        <h2>${t('risk_panel_title')}</h2>
        <p class="muted">${t('risk_panel_desc')}</p>
      </div>
      ${renderStrategyHeader(report)}
      ${renderRiskContractBlock(proposedContract, loadRiskContract())}
      ${renderSensitivityBlock(levels, kellyRisk, defaultRisk)}
      ${renderRecoveryBlock(report)}
    </div>`;

  wireRiskContractActions(container, proposedContract);

  // Slider → live highlight + risk readout.
  const slider = container.querySelector('#rs-slider');
  slider?.addEventListener('input', (e) => {
    const idx = parseInt(e.target.value, 10);
    container.querySelector('#rs-risk-display').textContent = fmtPct(levels[idx].risk, 2);
    container.querySelectorAll('.rs-row').forEach((row) => {
      row.classList.toggle('rs-selected', parseInt(row.dataset.idx, 10) === idx);
    });
  });

  // Recovery calculator.
  ['#rc-dd', '#rc-balance'].forEach((sel) => {
    container.querySelector(sel)?.addEventListener('input', () => updateRecovery(report, container));
  });
  updateRecovery(report, container);
}
