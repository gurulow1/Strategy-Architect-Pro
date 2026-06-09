// AI weakness explainer panel.
// Calls explainWeaknesses, sorts findings by severity, renders each as a
// .card.verdict card whose left-border colour maps to the finding severity.
// Only border-left-color is set inline (for the info case), all other
// styling comes from existing CSS classes.

import { callAI } from '../services/aiClient.js';

const SEV_ORDER = { critical: 0, warning: 1, info: 2 };

export function createAIWeaknessPanel(container) {

  async function renderWeaknesses(diagnostics) {
    container.innerHTML = '<div class="muted small">Analyzing diagnostics&hellip;</div>';

    try {
      const data = await callAI('explainWeaknesses', { diagnostics });
      buildPanel(data.findings || []);
    } catch (_) {
      container.innerHTML = '<div class="muted small">Diagnostics unavailable.</div>';
    }
  }

  function buildPanel(findings) {
    container.innerHTML = '';

    if (!findings.length) {
      const ok = document.createElement('div');
      ok.className = 'small good';
      ok.textContent = 'No critical issues found.';
      container.appendChild(ok);
      return;
    }

    const sorted = [...findings].sort(
      (a, b) => (SEV_ORDER[a.severity] ?? 3) - (SEV_ORDER[b.severity] ?? 3)
    );

    const wrap = document.createElement('div');
    wrap.className = 'diag';

    const title = document.createElement('h3');
    title.textContent = 'AI Diagnostics';
    wrap.appendChild(title);

    for (const f of sorted) {
      // Reuse .card.verdict pattern from results.js for coloured left borders.
      // critical → .verdict.bad (--bad, red)
      // warning  → .verdict.warn (--warn, orange)
      // info     → .verdict base + inline borderLeftColor (no .verdict.info class)
      const severityCls = f.severity === 'critical' ? 'bad'
        : f.severity === 'warning' ? 'warn'
        : null;

      const card = document.createElement('div');
      card.className = severityCls ? `card verdict ${severityCls}` : 'card verdict';
      if (!severityCls) card.style.borderLeftColor = 'var(--info)';

      // Evidence rendered as a bullet list using existing .diag-col ul/li styles.
      card.innerHTML = `
        <strong>${f.type}</strong>
        <p class="small">${f.description}</p>
        <div class="diag-col muted">
          <ul><li class="small">${f.evidence}</li></ul>
        </div>
        <p class="small"><em>&rarr;&nbsp;${f.action}</em></p>`;

      wrap.appendChild(card);
    }

    container.appendChild(wrap);
  }

  return { renderWeaknesses };
}
