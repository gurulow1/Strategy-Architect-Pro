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
import { t } from './i18n.js';

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

    @keyframes ai-spin { to { transform: rotate(360deg); } }
    .ai-spinner {
      width: 12px; height: 12px; flex-shrink: 0;
      border: 2px solid var(--line);
      border-top-color: var(--accent, #1d4ed8);
      border-radius: 50%;
      animation: ai-spin .8s linear infinite;
    }
  `;
  document.head.appendChild(s);
}

// ── Localized labels for nav pills — computed at call time so language
//    changes are reflected without needing a page reload. ────────────────────
function getTabLabel(tabId) {
  const map = {
    quick:      'tab_quick',
    journal:    'tab_journal',
    robustness: 'tab_robustness',
    prop:       'tab_prop',
  };
  return t(map[tabId] || tabId);
}

function getHighlightLabel(id) {
  const map = {
    'qc-winrate':     'in_winrate',
    'qc-rr':          'in_rr',
    'qc-risk':        'in_risk',
    'qc-cost':        'in_cost',
    'qc-capital':     'in_capital',
    'qc-trades':      'in_trades',
    'kpi-expectancy': 'kpi_expectancy',
    'kpi-pf':         'kpi_pf',
    'kpi-ruin':       'kpi_ruin',
    'kpi-dd':         'kpi_dd',
    'kpi-pop':        'kpi_pop',
    'kpi-kelly':      'kpi_kelly',
    'kpi-sig':        'kpi_sig',
    'pp-daily':       'prop_daily',
    'pp-max':         'prop_max',
    'pp-target':      'prop_target',
  };
  const key = map[id];
  return key ? t(key) : id.replace(/-/g, ' ');
}

export function createAIChat() {
  injectStyles();

  // ── Persistent closure state ──────────────────────────────────────────────
  let isOpen      = false;
  let isResizing  = false;
  let messages    = [];
  let panel       = null;
  let msgBox      = null;
  let inputEl     = null;
  let sendBtn     = null;
  let busy        = false;
  let thinkingEl  = null;   // the loading indicator DOM node
  let warmupTimer = null;   // timeout handle for "warming up" message

  // Dimensions persist across open/close (desktop only).
  let panelW = Math.min(600, window.innerWidth);
  let panelH = Math.min(Math.round(window.innerHeight * 0.72), 560);

  // True when the viewport is narrow enough that the desktop floating panel
  // would overflow or be awkward to use.
  const isMobile = () => window.innerWidth < 520;

  // ── Trigger button ────────────────────────────────────────────────────────
  const trigger = document.createElement('button');
  trigger.className = 'btn-primary';
  trigger.textContent = '💬 Ask AI';
  trigger.style.cssText = [
    'position:fixed', 'bottom:20px', 'right:16px',
    'width:auto', 'padding:10px 18px', 'z-index:1000',
    'border-radius:999px', 'box-shadow:0 8px 24px rgba(29,78,216,.35)',
    'font-size:14px',
  ].join(';');
  trigger.addEventListener('click', (e) => { e.stopPropagation(); isOpen ? close() : open(); });
  document.body.appendChild(trigger);

  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && isOpen) close(); });

  // ── Panel CSS — different layout on mobile vs desktop ─────────────────────
  function buildPanelCss() {
    if (isMobile()) {
      // Full-width bottom sheet on narrow screens.
      return [
        'position:fixed', 'bottom:0', 'left:0', 'right:0',
        `height:${Math.round(window.innerHeight * 0.88)}px`,
        'z-index:1001',
        'display:flex', 'flex-direction:column',
        'border-radius:18px 18px 0 0',
        'overflow:hidden',
      ].join(';');
    }
    return [
      'position:fixed', 'bottom:0', 'right:0',
      `width:${panelW}px`, `height:${panelH}px`,
      'z-index:1001',
      'display:flex', 'flex-direction:column',
      'border-radius:var(--radius) var(--radius) 0 0',
      'overflow:hidden',
    ].join(';');
  }

  // ── Panel lifecycle ───────────────────────────────────────────────────────
  function open() {
    if (isOpen) return;
    isOpen = true;

    panel = document.createElement('div');
    panel.className = 'card';
    panel.style.cssText = buildPanelCss();

    const mobile = isMobile();
    // Resize handle is hidden on mobile — drag-to-resize is not practical there.
    const resizeHandleHtml = mobile ? '' : `
      <div id="ai-resize-handle" title="Drag to resize">
        <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
          <path d="M3 19L19 3"  stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          <path d="M9 19L19 9"  stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
      </div>`;
    const hdrPadding = mobile ? '14px 16px' : '14px 18px 14px 30px';

    panel.innerHTML = `
      ${resizeHandleHtml}
      <div id="ai-chat-hdr" style="display:flex;justify-content:space-between;align-items:center;padding:${hdrPadding};border-bottom:1px solid var(--line);flex-shrink:0;">
        <strong>${t('ai_title')}</strong>
        <button id="ai-chat-close" class="lang-btn">&times;</button>
      </div>
      <div class="muted small" style="padding:6px 16px 0;flex-shrink:0;">
        ${t('ai_disclaimer')}
      </div>
      <div id="ai-chat-msgs" style="flex:1;overflow-y:auto;padding:10px 16px;min-height:0;"></div>
      <div style="display:flex;gap:8px;padding:10px 16px;border-top:1px solid var(--line);flex-shrink:0;">
        <input id="ai-chat-input" class="select" style="flex:1;min-width:0;" placeholder="${t('ai_ask')}">
        <button id="ai-chat-send" class="btn-primary" style="width:auto;padding:9px 14px;flex-shrink:0;">${t('ai_send')}</button>
      </div>`;

    msgBox  = panel.querySelector('#ai-chat-msgs');
    inputEl = panel.querySelector('#ai-chat-input');
    sendBtn = panel.querySelector('#ai-chat-send');

    panel.querySelector('#ai-chat-close').addEventListener('click', close);
    const resizeHandle = panel.querySelector('#ai-resize-handle');
    if (resizeHandle) resizeHandle.addEventListener('mousedown', startResize);
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
    hideThinking();
    document.removeEventListener('click', onDocClick);
    if (panel) { panel.remove(); panel = null; }
    msgBox = inputEl = sendBtn = null;
  }

  function onDocClick(e) {
    if (isResizing) return;
    if (panel && !panel.contains(e.target) && e.target !== trigger) close();
  }

  // ── Resize (drag top-left handle — desktop only) ─────────────────────────
  function startResize(e) {
    e.preventDefault();
    e.stopPropagation();
    isResizing = true;

    const startX = e.clientX, startY = e.clientY;
    const startW = panelW,    startH = panelH;

    function onMove(ev) {
      panelW = Math.max(380, Math.min(window.innerWidth  * 0.92, startW - (ev.clientX - startX)));
      panelH = Math.max(400, Math.min(window.innerHeight * 0.92, startH - (ev.clientY - startY)));
      if (panel) { panel.style.width = `${panelW}px`; panel.style.height = `${panelH}px`; }
    }

    function onUp() {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup',   onUp);
      setTimeout(() => { isResizing = false; }, 60);
    }

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup',   onUp);
  }

  // Re-apply panel geometry when the viewport changes (orientation flip, etc.)
  window.addEventListener('resize', () => {
    if (!isOpen || !panel) return;
    panel.style.cssText = buildPanelCss();
  });

  // ── Loading indicator ─────────────────────────────────────────────────────
  function showThinking() {
    if (!msgBox) return;
    thinkingEl = document.createElement('div');
    thinkingEl.style.marginBottom = '12px';
    thinkingEl.innerHTML = `
      <div class="small muted" style="display:flex;align-items:center;gap:6px;">
        <span class="ai-spinner"></span>
        <span id="ai-thinking-text">${t('ai_thinking')}</span>
      </div>`;
    msgBox.appendChild(thinkingEl);
    scrollBottom();

    // After 3 s without a response, hint that the server is cold-starting.
    warmupTimer = setTimeout(() => {
      if (thinkingEl) {
        const span = thinkingEl.querySelector('#ai-thinking-text');
        if (span) span.textContent = t('ai_warmup');
      }
    }, 3000);
  }

  function hideThinking() {
    if (warmupTimer) { clearTimeout(warmupTimer); warmupTimer = null; }
    if (thinkingEl)  { thinkingEl.remove(); thinkingEl = null; }
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
      const errMsg = { role: 'ai', text: t('ai_error') };
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
    if (on) showThinking(); else hideThinking();
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
      // Translate confidence label (AI always returns English keys).
      const confMap = {
        high:   t('ai_conf_high'),
        medium: t('ai_conf_medium'),
        low:    t('ai_conf_low'),
      };
      const badgeCls = msg.confidence === 'high'   ? 'badge good'
        : msg.confidence === 'medium'               ? 'badge warn'
        : 'badge muted';

      const confidenceHtml = msg.confidence
        ? `<span class="${badgeCls}">${confMap[msg.confidence] || msg.confidence}</span> `
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
    const tabLabel       = getTabLabel(nav.tab);
    const highlightLabel = nav.highlight ? getHighlightLabel(nav.highlight) : null;
    const suffix = highlightLabel ? ` → ${highlightLabel}` : '';
    return `<button class="ai-nav-btn">📍 ${tabLabel}${suffix}</button>`;
  }

  function scrollBottom() {
    if (msgBox) msgBox.scrollTop = msgBox.scrollHeight;
  }
}
