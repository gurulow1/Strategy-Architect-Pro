// Prop Challenge coach card.
// Renders a coaching-oriented summary with verdict badge, recommended action,
// and biggest risk. Visually distinct from AISummaryCard: the verdict left-border
// is overridden to --accent-2 (purple) regardless of verdict colour, so the coach
// card reads as a separate layer of interpretation rather than a repeat verdict.
//
// Usage:
//   const { renderCoach } = createPropCoachCard(containerEl);
//   renderCoach(summaryData);   // summaryData from generateSummary AI handler

import { callAI } from '../services/aiClient.js';
import { escapeHtml } from './safeDom.js';

// Same mapping as AISummaryCard — kept co-located so changes stay in sync.
const VERDICT_CLS   = { strong: 'good', fragile: 'warn', weak: 'bad', no_edge: 'bad' };
const VERDICT_LABEL = { strong: 'Strong', fragile: 'Fragile', weak: 'Weak', no_edge: 'No Edge' };

export function createPropCoachCard(container) {

  function renderCoach(summary) {
    container.innerHTML = '';

    if (!summary) {
      const empty = document.createElement('div');
      empty.className = 'muted small';
      empty.textContent = 'Run analysis to see coach advice.';
      container.appendChild(empty);
      return;
    }

    const cls   = VERDICT_CLS[summary.verdict]   || 'bad';
    const label = VERDICT_LABEL[summary.verdict] || String(summary.verdict);

    // Optional recommended_risk field (AI may or may not include it).
    const riskHtml = summary.recommended_risk
      ? `<div class="kpi card">
           <div class="kpi-label">Recommended Risk</div>
           <div class="kpi-num ${cls}">${escapeHtml(summary.recommended_risk)}</div>
         </div>`
      : '';

    const sampleWarnHtml = summary.sample_warning
      ? `<div class="small warn">${escapeHtml(summary.sample_warning)}</div><div class="divider"></div>`
      : '';

    const biggestRiskHtml = summary.biggest_risk
      ? `<div class="divider"></div><div class="small bad">&rarr;&nbsp;${escapeHtml(summary.biggest_risk)}</div>`
      : '';

    const card = document.createElement('div');
    // Base: .card.verdict.{cls} for shape, shadow and base left-border width/style.
    // Override border-left-color to --accent-2 (purple) to visually distinguish
    // this coaching card from the AISummaryCard (which keeps verdict colours).
    card.className = `card verdict ${cls}`;
    card.style.borderLeftColor = 'var(--accent-2)';

    card.innerHTML = `
      <div class="verdict-main">
        <div>
          <div class="verdict-grade ${cls}">${escapeHtml(label)}</div>
          <div class="verdict-sub">Prop Challenge Coach</div>
        </div>
      </div>
      ${riskHtml}
      ${sampleWarnHtml}
      <div class="divider"></div>
      <div class="small">${escapeHtml(summary.recommended_action || summary.headline || '')}</div>
      ${biggestRiskHtml}`;

    container.appendChild(card);
  }

  return { renderCoach };
}
