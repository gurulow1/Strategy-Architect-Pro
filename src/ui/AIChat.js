// Floating AI chat panel.
// A fixed-position trigger button and slide-up panel. All state lives in closure
// variables — nothing is attached to window. The panel reads analysis context from
// window.__sap_currentAnalysis (set by the app when a report is ready).
//
// Inline styles are used sparingly and only where existing CSS classes cannot cover
// position:fixed, flex layout, overflow, or z-index requirements.
//
// Usage: createAIChat()  — call once after the page is ready. No return value needed.

import { callAI } from '../services/aiClient.js';

export function createAIChat() {
  // ── Closure state ─────────────────────────────────────────────────────────
  let isOpen      = false;
  let messages    = [];   // { role:'user'|'ai', text, evidence?, confidence?, caveat? }
  let panel       = null;
  let msgBox      = null;
  let inputEl     = null;
  let sendBtn     = null;
  let busy        = false;

  // ── Floating trigger button ───────────────────────────────────────────────

  const trigger = document.createElement('button');
  trigger.className = 'btn-primary';
  trigger.textContent = '💬 Ask AI';
  // Override btn-primary width:100% — this is the only way to make a compact fixed button.
  trigger.style.cssText = [
    'position:fixed',
    'bottom:20px',
    'right:20px',
    'width:auto',
    'padding:10px 20px',
    'z-index:1000',
    'border-radius:999px',
    'box-shadow:0 8px 24px rgba(29,78,216,.35)',
  ].join(';');

  trigger.addEventListener('click', (e) => { e.stopPropagation(); isOpen ? close() : open(); });
  document.body.appendChild(trigger);

  // ── Escape key (registered once for the lifetime of the chat) ─────────────

  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && isOpen) close(); });

  // ── Panel lifecycle ───────────────────────────────────────────────────────

  function open() {
    if (isOpen) return;
    isOpen = true;

    panel = document.createElement('div');
    panel.className = 'card';
    // Structural inline styles — no existing CSS class covers fixed-panel layout.
    panel.style.cssText = [
      'position:fixed',
      'bottom:0',
      'right:0',
      'width:400px',
      'max-height:60vh',
      'z-index:1001',
      'display:flex',
      'flex-direction:column',
      'border-radius:var(--radius) var(--radius) 0 0',
      'overflow:hidden',
    ].join(';');

    panel.innerHTML = `
      <div id="ai-chat-hdr" style="display:flex;justify-content:space-between;align-items:center;padding:14px 18px;border-bottom:1px solid var(--line);flex-shrink:0;">
        <strong>Ask about this strategy</strong>
        <button id="ai-chat-close" class="lang-btn">&times;</button>
      </div>
      <div class="muted small" style="padding:6px 18px 0;flex-shrink:0;">
        Answers based on loaded data only. Not investment advice.
      </div>
      <div id="ai-chat-msgs" style="flex:1;overflow-y:auto;padding:10px 18px;"></div>
      <div style="display:flex;gap:8px;padding:12px 18px;border-top:1px solid var(--line);flex-shrink:0;">
        <input id="ai-chat-input" class="select" style="flex:1;" placeholder="Ask a question&hellip;">
        <button id="ai-chat-send" class="btn-primary" style="width:auto;padding:9px 14px;flex-shrink:0;">Send</button>
      </div>`;

    msgBox   = panel.querySelector('#ai-chat-msgs');
    inputEl  = panel.querySelector('#ai-chat-input');
    sendBtn  = panel.querySelector('#ai-chat-send');

    panel.querySelector('#ai-chat-close').addEventListener('click', close);
    sendBtn.addEventListener('click', handleSend);
    inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
    });

    // Replay existing message history (so re-opening shows prior conversation).
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
    if (panel && !panel.contains(e.target) && e.target !== trigger) close();
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
        role: 'ai',
        text: data.answer,
        evidence: data.evidence,
        confidence: data.confidence,
        caveat: data.caveat,
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
    if (inputEl)  inputEl.disabled  = on;
    if (sendBtn)  sendBtn.disabled  = on;
  }

  // ── Message rendering ─────────────────────────────────────────────────────

  function appendMessage(msg) {
    if (!msgBox) return;

    const el = document.createElement('div');
    el.style.marginBottom = '12px';

    if (msg.role === 'user') {
      // Right-aligned bubble with a subtle accent tint.
      el.style.textAlign = 'right';
      const bubble = document.createElement('span');
      bubble.className = 'small';
      bubble.style.cssText = 'display:inline-block;max-width:85%;padding:7px 12px;background:rgba(29,78,216,.10);border-radius:10px;';
      bubble.textContent = msg.text;
      el.appendChild(bubble);
    } else {
      // AI response: confidence badge, answer text, evidence bullets, caveat.
      const badgeCls = msg.confidence === 'high'   ? 'badge good'
        : msg.confidence === 'medium' ? 'badge warn'
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
        ${caveatHtml}`;
    }

    msgBox.appendChild(el);
  }

  function scrollBottom() {
    if (msgBox) msgBox.scrollTop = msgBox.scrollHeight;
  }
}
