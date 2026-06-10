// Telegram connect panel. Lets a user link their Telegram chat to receive
// strategy-degradation alerts. Hidden entirely when the server has no bot
// configured. Presentation only — all state lives server-side.

import { t } from './i18n.js';
import { apiPost, getIntegrations, accountKey } from '../services/serverApi.js';

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

  function msg(html, cls = 'muted') {
    const el = container.querySelector('#tg-msg');
    if (el) { el.className = `tg-msg small ${cls}`; el.innerHTML = html; }
  }

  async function refreshStatus() {
    try {
      const { linked } = await apiPost('/api/telegram/status', { licenseKey: accountKey() });
      setStatus(Boolean(linked));
    } catch (_) { setStatus(false); }
  }

  async function connect() {
    msg(t('tg_modal_waiting'));
    let code;
    try {
      ({ code } = await apiPost('/api/telegram/generate-code', { licenseKey: accountKey() }));
    } catch (err) { msg(err.message, 'bad'); return; }

    const deepLink = botUsername ? `https://t.me/${botUsername}?start=${code}` : null;
    const cmd = `/start ${code}`;
    msg(
      `${t('tg_modal_instr')} <code>${cmd}</code>`
      + (deepLink ? `<br><a class="link" href="${deepLink}" target="_blank" rel="noopener">${t('tg_open_bot')}</a>` : ''),
    );

    // Poll for confirmation for ~60s.
    let elapsed = 0;
    clearInterval(pollTimer);
    pollTimer = setInterval(async () => {
      elapsed += 3;
      try {
        const { linked } = await apiPost('/api/telegram/status', { licenseKey: accountKey() });
        if (linked) { clearInterval(pollTimer); setStatus(true); msg(t('tg_connected'), 'good'); return; }
      } catch (_) { /* keep polling */ }
      if (elapsed >= 60) { clearInterval(pollTimer); msg(t('tg_modal_timeout'), 'warn'); }
    }, 3000);
  }

  async function test() {
    try { await apiPost('/api/telegram/test', { licenseKey: accountKey() }); msg(t('tg_test_sent'), 'good'); }
    catch (err) { msg(err.message, 'bad'); }
  }

  async function unlink() {
    clearInterval(pollTimer);
    try { await apiPost('/api/telegram/unlink', { licenseKey: accountKey() }); } catch (_) { /* ignore */ }
    setStatus(false);
    msg('');
  }

  init();
}
