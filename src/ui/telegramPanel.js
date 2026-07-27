// Telegram connect panel. Lets a user link their Telegram chat to receive
// strategy-degradation alerts. Hidden entirely when the server has no bot
// configured. Presentation only — all state lives server-side.

import { t } from './i18n.js';
import { apiPost, getIntegrations } from '../services/serverApi.js';
import { safeExternalUrl } from './safeDom.js';

export function createTelegramPanel(container) {
  let botUsername = null;
  let pollTimer = null;

  async function init() {
    const integ = await getIntegrations();
    if (!integ.telegram?.enabled) {
      container.innerHTML = '';   // nothing to show if the bot isn't configured
      return;
    }
    botUsername = integ.telegram.botUsername || null;
    shell();
    refreshStatus();
  }

  function shell() {
    container.innerHTML = `
      <div id="tg-connect-panel" class="card pad tg-panel">
        <div class="tg-head">
          <h4>${t('tg_title')}</h4>
          <span class="badge muted" id="tg-status">${t('tg_checking')}</span>
        </div>
        <div class="muted small">${t('tg_desc')}</div>
        <div class="tg-actions">
          <button class="btn-primary" id="tg-connect" hidden>${t('tg_connect')}</button>
          <button class="btn-secondary" id="tg-test" hidden>${t('tg_test')}</button>
          <button class="btn-secondary" id="tg-unlink" hidden>${t('tg_unlink')}</button>
        </div>
        <div class="tg-msg small" id="tg-msg"></div>
      </div>`;
    container.querySelector('#tg-connect').addEventListener('click', connect);
    container.querySelector('#tg-test').addEventListener('click', test);
    container.querySelector('#tg-unlink').addEventListener('click', unlink);
  }

  function setStatus(linked) {
    const badge = container.querySelector('#tg-status');
    badge.className = `badge ${linked ? 'good' : 'muted'}`;
    badge.textContent = linked ? t('tg_connected') : t('tg_not_connected');
    container.querySelector('#tg-connect').hidden = linked;
    container.querySelector('#tg-test').hidden = !linked;
    container.querySelector('#tg-unlink').hidden = !linked;
  }

  function msg(message, cls = 'muted') {
    const el = container.querySelector('#tg-msg');
    if (el) { el.className = `tg-msg small ${cls}`; el.textContent = String(message ?? ''); }
  }

  function showConnectInstructions(code) {
    const el = container.querySelector('#tg-msg');
    if (!el) return;
    el.className = 'tg-msg small muted';
    el.textContent = `${t('tg_modal_instr')} `;

    const cmd = document.createElement('code');
    cmd.textContent = `/start ${String(code ?? '')}`;
    el.appendChild(cmd);

    const username = String(botUsername ?? '').trim();
    if (!/^[A-Za-z0-9_]{5,32}$/.test(username)) return;
    const url = new URL(`https://t.me/${username}`);
    url.searchParams.set('start', String(code ?? ''));
    const deepLink = safeExternalUrl(url.href, { allowedHosts: ['t.me'] });
    if (!deepLink) return;

    el.appendChild(document.createElement('br'));
    const link = document.createElement('a');
    link.className = 'link';
    link.href = deepLink;
    link.target = '_blank';
    link.rel = 'noopener';
    link.textContent = t('tg_open_bot');
    el.appendChild(link);
  }

  async function refreshStatus() {
    try {
      const { linked } = await apiPost('/api/telegram/status');
      setStatus(Boolean(linked));
    } catch (_) { setStatus(false); }
  }

  async function connect() {
    msg(t('tg_modal_waiting'));
    let code;
    try {
      ({ code } = await apiPost('/api/telegram/generate-code'));
    } catch (err) { msg(err.message, 'bad'); return; }

    showConnectInstructions(code);

    // Poll for confirmation for ~60s.
    let elapsed = 0;
    clearInterval(pollTimer);
    pollTimer = setInterval(async () => {
      elapsed += 3;
      try {
        const { linked } = await apiPost('/api/telegram/status');
        if (linked) { clearInterval(pollTimer); setStatus(true); msg(t('tg_connected'), 'good'); return; }
      } catch (_) { /* keep polling */ }
      if (elapsed >= 60) { clearInterval(pollTimer); msg(t('tg_modal_timeout'), 'warn'); }
    }, 3000);
  }

  async function test() {
    try { await apiPost('/api/telegram/test'); msg(t('tg_test_sent'), 'good'); }
    catch (err) { msg(err.message, 'bad'); }
  }

  async function unlink() {
    clearInterval(pollTimer);
    try { await apiPost('/api/telegram/unlink'); } catch (_) { /* ignore */ }
    setStatus(false);
    msg('');
  }

  init();
}
