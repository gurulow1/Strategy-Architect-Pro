// Floating AI chat panel — resizable, with contextual navigation support.
//
// Resize: drag the ⟋ handle at the top-left corner; width/height persist
//   between open/close sessions (stored in closure vars panelW/panelH).
//
// Navigation: when the AI response includes a `navigation` field
//   { tab, highlight }, a "📍 Go to …" pill appears.  Clicking it calls
//   window.__sap_navigateTo(tab, elementId), which is registered by app.js.
//
// Only structural/positional inline styles are used; decorative classes come
// from styles.css.  Highlight animation + nav-pill styles are injected once.

import { callAI } from '../services/aiClient.js';

// ── One-time style injection ──────────────────────────────────────────────────
function injectStyles() {
  if (document.getElementById('ai-chat-styles')) return;
  const s = document.createElement('style');
  s.id = 'ai-chat-styles';
  s.textContent = `
    @keyframes sap-ai-flash {
      0%   { outline: 2px solid transparent;          background-color: transparent; }
      20%  { outline: 2px solid rgba(99,102,241,.65); background-color: rgba(99,102,241,.12); }
      80%  { outline: 2px solid rgba(99,102,241,.65); background-color: rgba(99,102,241,.12); }
      100% { outline: 2px solid transparent;          background-color: transparent; }
    }
    .ai-highlight { animation: sap-ai-flash 2.2s ease forwards; border-radius: 6px; }

    .ai-nav-btn {
      display: inline-flex; align-items: center; gap: 5px;
      margin-top: 8px; padding: 4px 11px;
      border: 1px solid var(--line); border-radius: 20px;
      background: rgba(99,102,241,.08); color: var(--text);
      font-size: .75rem; cursor: pointer; transition: background .15s;
    }
    .ai-nav-btn:hover { background: rgba(99,102,241,.2); }

    #ai-resize-handle {
      position: absolute; top: 0; left: 0;
      width: 22px; height: 22px;
      cursor: nw-resize; opacity: .28; transition: opacity .15s; z-index: 2;
      color: var(--text);
    }
    #ai-resize-handle:hover { opacity: .75; }
  `;
  document.head.appendChild(s);
}

// ── Human-readable labels for element IDs used in navigation pills ────────────
const HIGHLIGHT_LABELS = {
  'qc-winrate':      'Win Rate',
  'qc-rr':           'Reward : Risk',
  'qc-risk':         'Risk per Trade',
  'qc-cost':         'Fees',
  'qc-capital':      'Account Size',
  'qc-trades':       'Trade Count',
  'kpi-expectancy':  'Expectancy',
  'kpi-pf':          'Profit Factor',
  'kpi-ruin':        'Risk of Ruin',
  'kpi-dd':          'Drawdown',
  'kpi-pop':         'Prob. of Profit',
  'kpi-kelly':       'Kelly Fraction',
  'kpi-sig':         'Edge Significance',
  'pp-daily':        'Daily Loss Limit',
  'pp-max':          'Max Drawdown Limit',
  'pp-target':       'Profit Target',
};

const TAB_LABELS = {
  quick:      'Quick Check',
  journal:    'Journal Analysis',
  robustness: 'Robustness Test',
  prop:       'Prop Challenge',
};

export function createAIChat() {
  injectStyles();

  // ── Persistent closure state ──────────────────────────────────────────────
  let isOpen     = false;
  let isResizing = false;
  let messages   = [];
  let panel      = null;
  let msgBox     = null;
  let inputEl    = null;
  let sendBtn    = null;
  let busy       = false;

  // Dimensions persist across open/close so the user's resize is remembered.
  let panelW = 600;
  let panelH = Math.min(Math.round(window.innerHeight * 0.72), 560);

  // ── Trigger button ────────────────────────────────────────────────────────
  const trigger = document.createElement('button');
  trigger.className = 'btn-primary';
  trigger.textContent = '💬 Ask AI';
  trigger.style.cssText = [
    'position:fixed', 'bottom:20px', 'right:20px',
    'width:auto', 'padding:10px 20px', 'z-index:1000',
    'border-radius:999px', 'box-shadow:0 8px 24px rgba(29,78,216,.35)',
  ].join(';');
  trigger.addEventListener('click', (e) => { e.stopPropagation(); isOpen ? close() : open(); });
  document.body.appendChild(trigger);

  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && isOpen) close(); });

  // ── Panel lifecycle ───────────────────────────────────────────────────────
  function open() {
    if (isOpen) return;
    isOpen = true;

    panel = document.createElement('div');
    panel.className = 'card';
    // position:fixed; anchored bottom-right; height is controlled directly so
    // we don't use max-height here — the resize logic manages it.
    panel.style.cssText = [
      'position:fixed', 'bottom:0', 'right:0',
      `width:${panelW}px`, `height:${panelH}px`,
      'z-index:1001',
      'display:flex', 'flex-direction:column',
      'border-radius:var(--radius) var(--radius) 0 0',
      'overflow:hidden',
    ].join(';');

    panel.innerHTML = `
      <div id="ai-resize-handle" title="Drag to resize">
        <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
          <path d="M3 19L19 3"  stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          <path d="M9 19L19 9"  stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
      </div>
      <div id="ai-chat-hdr" style="display:flex;justify-content:space-between;align-items:center;padding:14px 18px 14px 30px;border-bottom:1px solid var(--line);flex-shrink:0;">
        <strong>Ask about this strategy</strong>
        <button id="ai-chat-close" class="lang-btn">&times;</button>
      </div>
      <div class="muted small" style="padding:6px 18px 0;flex-shrink:0;">
        Answers based on loaded data only. Not investment advice.
      </div>
      <div id="ai-chat-msgs" style="flex:1;overflow-y:auto;padding:10px 18px;min-height:0;"></div>
      <div style="display:flex;gap:8px;padding:12px 18px;border-top:1px solid var(--line);flex-shrink:0;">
        <input id="ai-chat-input" class="select" style="flex:1;" placeholder="Ask a question&hellip;">
        <button id="ai-chat-send" class="btn-primary" style="width:auto;padding:9px 14px;flex-shrink:0;">Send</button>
      </div>`;

    msgBox  = panel.querySelector('#ai-chat-msgs');
    inputEl = panel.querySelector('#ai-chat-input');
    sendBtn = panel.querySelector('#ai-chat-send');

    panel.querySelector('#ai-chat-close').addEventListener('click', close);
    panel.querySelector('#ai-resize-handle').addEventListener('mousedown', startResize);
    sendBtn.addEventListener('click', handleSend);
    inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
    });

    messages.forEach(appendMessage);
    scrollBottom();

    document.addEventListener('click', onDocClick);
    document.body.appendChild(panel);
  }

  function close() {
    if (!isOpen) return;
    isOpen = false;
    document.removeEventListener('click', onDocClick);
    if (panel) { panel.remove(); panel = null; }
    msgBox = inputEl = sendBtn = null;
  }

  function onDocClick(e) {
    // Don't close while drag is in progress (mouseup fires before click,
    // so we delay clearing the flag — see onUp below).
    if (isResizing) return;
    if (panel && !panel.contains(e.target) && e.target !== trigger) close();
  }

  // ── Resize (drag top-left handle) ─────────────────────────────────────────
  // Panel is fixed to bottom-right, so dragging left/up grows the panel.
  function startResize(e) {
    e.preventDefault();
    e.stopPropagation();
    isResizing = true;

    const startX = e.clientX, startY = e.clientY;
    const startW = panelW,    startH = panelH;

    function onMove(ev) {
      // Moving left (negative deltaX) → wider; moving up (negative deltaY) → taller.
      panelW = Math.max(380, Math.min(window.innerWidth  * 0.92, startW - (ev.clientX - startX)));
      panelH = Math.max(400, Math.min(window.innerHeight * 0.92, startH - (ev.clientY - startY)));
      if (panel) { panel.style.width = `${panelW}px`; panel.style.height = `${panelH}px`; }
    }

    function onUp() {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup',   onUp);
      // Delay so the click event that fires right after mouseup doesn't close the panel.
      setTimeout(() => { isResizing = false; }, 60);
    }

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup',   onUp);
  }

  // ── Message sending ───────────────────────────────────────────────────────
  async function handleSend() {
    if (busy || !inputEl) return;
    const question = inputEl.value.trim();
    if (!question) return;

    inputEl.value = '';
    const userMsg = { role: 'user', text: question };
    messages.push(userMsg);
    appendMessage(userMsg);
    scrollBottom();
    setLoading(true);

    const { metrics, tradeHistory, diagnostics } = window.__sap_currentAnalysis || {};

    try {
      const data = await callAI('answerQuestion', { question, metrics, tradeHistory, diagnostics });
      const aiMsg = {
        role:       'ai',
        text:       data.answer,
        evidence:   data.evidence,
        confidence: data.confidence,
        caveat:     data.caveat,
        navigation: data.navigation || null,
      };
      messages.push(aiMsg);
      appendMessage(aiMsg);
    } catch (_) {
      const errMsg = { role: 'ai', text: 'AI unavailable. Please try again later.' };
      messages.push(errMsg);
      appendMessage(errMsg);
    } finally {
      setLoading(false);
      scrollBottom();
    }
  }

  function setLoading(on) {
    busy = on;
    if (inputEl) inputEl.disabled = on;
    if (sendBtn) sendBtn.disabled = on;
  }

  // ── Message rendering ─────────────────────────────────────────────────────
  function appendMessage(msg) {
    if (!msgBox) return;

    const el = document.createElement('div');
    el.style.marginBottom = '12px';

    if (msg.role === 'user') {
      el.style.textAlign = 'right';
      const bubble = document.createElement('span');
      bubble.className = 'small';
      bubble.style.cssText = 'display:inline-block;max-width:85%;padding:7px 12px;background:rgba(29,78,216,.10);border-radius:10px;';
      bubble.textContent = msg.text;
      el.appendChild(bubble);
    } else {
      const badgeCls = msg.confidence === 'high'   ? 'badge good'
        : msg.confidence === 'medium'               ? 'badge warn'
        : 'badge muted';

      const confidenceHtml = msg.confidence
        ? `<span class="${badgeCls}">${msg.confidence}</span> `
        : '';

      const evidenceHtml = Array.isArray(msg.evidence) && msg.evidence.length
        ? `<div class="diag-col muted" style="margin-top:6px;"><ul>${
            msg.evidence.map(e => `<li class="small">${e}</li>`).join('')
          }</ul></div>`
        : '';

      const caveatHtml = msg.caveat
        ? `<div class="small muted" style="margin-top:4px;"><em>${msg.caveat}</em></div>`
        : '';

      el.innerHTML = `
        <div class="small muted" style="margin-bottom:4px;">${confidenceHtml}</div>
        <div class="small">${msg.text}</div>
        ${evidenceHtml}
        ${caveatHtml}
        ${buildNavHtml(msg.navigation)}`;

      // Wire the nav pill (must be after innerHTML is set).
      if (msg.navigation) {
        const btn = el.querySelector('.ai-nav-btn');
        if (btn) {
          const { tab, highlight } = msg.navigation;
          btn.addEventListener('click', () => {
            if (typeof window.__sap_navigateTo === 'function') {
              window.__sap_navigateTo(tab, highlight || null);
            }
          });
        }
      }
    }

    msgBox.appendChild(el);
  }

  function buildNavHtml(nav) {
    if (!nav || !nav.tab) return '';
    const tabLabel       = TAB_LABELS[nav.tab] || nav.tab;
    const highlightLabel = nav.highlight
      ? HIGHLIGHT_LABELS[nav.highlight] || nav.highlight.replace(/-/g, ' ')
      : null;
    const suffix = highlightLabel ? ` → ${highlightLabel}` : '';
    return `<button class="ai-nav-btn">📍 ${tabLabel}${suffix}</button>`;
  }

  function scrollBottom() {
    if (msgBox) msgBox.scrollTop = msgBox.scrollHeight;
  }
}
