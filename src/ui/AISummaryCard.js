// AI-generated strategy summary card.
// Renders a collapsible verdict card using only existing CSS classes.
// Verdict label and colored left-border come from .card.verdict.{good,warn,bad}.
// Strengths / weaknesses reuse the .diag-grid / .diag-col design used in results.js.
//
// Usage:
//   const { renderSummary } = createAISummaryCard(containerEl);
//   renderSummary(metrics, diagnostics);   // call after analysis completes

import { callAI } from '../services/aiClient.js';
import { t } from './i18n.js';
import { escapeHtml } from './safeDom.js';

// Map AI verdict keys → existing CSS color classes + i18n label keys.
const VERDICT_CLS = { strong: 'good', fragile: 'warn', weak: 'bad', no_edge: 'bad' };
const VERDICT_LABEL_KEY = {
  strong: 'ai_verdict_strong', fragile: 'ai_verdict_fragile',
  weak: 'ai_verdict_weak', no_edge: 'ai_verdict_no_edge',
};

export function createAISummaryCard(container) {
  let _metrics = null;
  let _diagnostics = null;

  // ── Public API ───────────────────────────────────────────────────────────

  async function renderSummary(metrics, diagnostics) {
    _metrics = metrics;
    _diagnostics = diagnostics;
    showLoading();

    try {
      const data = await callAI('generateSummary', { metrics, diagnostics });
      buildCard(data);
    } catch (err) {
      buildErrorCard(err.message);
    }
  }

  // ── Renderers ────────────────────────────────────────────────────────────

  function showLoading() {
    container.innerHTML = `<div class="card pad"><div class="muted small">${t('ai_analyzing')}</div></div>`;
  }

  function buildCard(data) {
    const cls   = VERDICT_CLS[data.verdict]   || 'bad';
    const label = VERDICT_LABEL_KEY[data.verdict] ? t(VERDICT_LABEL_KEY[data.verdict]) : data.verdict;

    const mkList = (items) => Array.isArray(items) && items.length
      ? `<ul>${items.map((s) => `<li>${escapeHtml(s)}</li>`).join('')}</ul>`
      : `<ul><li class="muted">${t('ai_none')}</li></ul>`;

    const sampleWarnHtml = data.sample_warning
      ? `<div class="small warn">${escapeHtml(data.sample_warning)}</div><div class="divider"></div>`
      : '';

    // The card element — reuses .card .verdict .{cls} exactly like results.js.
    const card = document.createElement('div');
    card.className = `card verdict ${cls}`;
    card.innerHTML = `
      <div class="verdict-main" id="ai-sc-hdr">
        <div>
          <div class="verdict-grade ${cls}">${escapeHtml(label)} &mdash; ${t('ai_headline')}</div>
          <div class="verdict-sub">${escapeHtml(data.headline)}</div>
        </div>
        <span class="muted small" id="ai-sc-toggle" aria-hidden="true">&#9650;</span>
      </div>
      <div id="ai-sc-body">
        <div class="diag-grid">
          <div class="diag-col good">
            <h4>${t('ai_strengths')}</h4>
            ${mkList(data.strengths)}
          </div>
          <div class="diag-col bad">
            <h4>${t('ai_weaknesses')}</h4>
            ${mkList(data.weaknesses)}
          </div>
          <div class="diag-col risk">
            <h4>${t('ai_biggest_risk')}</h4>
            <p class="small">${escapeHtml(data.biggest_risk)}</p>
          </div>
          <div class="diag-col action">
            <h4>${t('ai_recommended_action')}</h4>
            <p class="small">${escapeHtml(data.recommended_action)}</p>
          </div>
        </div>
        ${sampleWarnHtml}
        <div class="divider"></div>
        <button class="btn-primary" id="ai-sc-refresh">${t('ai_refresh')}</button>
      </div>`;

    const header   = card.querySelector('#ai-sc-hdr');
    const body     = card.querySelector('#ai-sc-body');
    const toggle   = card.querySelector('#ai-sc-toggle');

    // cursor: pointer is functional state (same pattern as app.js display toggling).
    header.style.cursor = 'pointer';

    header.addEventListener('click', () => {
      const collapsed = body.style.display === 'none';
      body.style.display = collapsed ? '' : 'none';
      toggle.innerHTML = collapsed ? '&#9650;' : '&#9660;';
    });

    card.querySelector('#ai-sc-refresh').addEventListener('click', () => {
      renderSummary(_metrics, _diagnostics);
    });

    container.innerHTML = '';
    container.appendChild(card);
  }

  function buildErrorCard(message) {
    // Collapsed error state: verdict border only, no body.
    container.innerHTML = `
      <div class="card verdict bad">
        <div class="verdict-main">
          <div>
            <div class="verdict-grade bad">${t('ai_unavailable')}</div>
            <div class="verdict-sub">${escapeHtml(message)}</div>
          </div>
        </div>
      </div>`;
  }

  return { renderSummary };
}
