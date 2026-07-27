// "Import directly from a broker" panel for the Journal Analysis tab.
// Collapsible; four tabs (Binance / Bybit / MetaTrader / cTrader). All broker
// calls go through the backend (keys never touch the browser network logs).
// On success it hands normalized trades — { date, pnl, r, direction, symbol } —
// to the same `onTrades` pipeline that the local journal parser feeds.
//
// Presentation only: business logic lives on the server connectors.

import { t } from './i18n.js';
import { apiPost, apiGet, getIntegrations, API_BASE } from '../services/serverApi.js';
import { escapeHtml, safeExternalUrl } from './safeDom.js';

const TABS = ['binance', 'bybit', 'metatrader', 'ctrader'];
const TAB_LABEL = { binance: 'Binance', bybit: 'Bybit', metatrader: 'MetaTrader', ctrader: 'cTrader' };

export function createBrokerImport(container, onTrades) {
  let integrations = { brokers: {} };
  let active = 'binance';
  // cTrader access token arrives via URL hash after OAuth redirect.
  let ctraderToken = readCTraderTokenFromHash();

  function readCTraderTokenFromHash() {
    const m = (window.location.hash || '').match(/ctrader_token=([^&]+)/);
    if (m) {
      // Strip it from the URL so the secret isn't left in the address bar.
      history.replaceState(null, '', window.location.pathname + window.location.search);
      return decodeURIComponent(m[1]);
    }
    return null;
  }

  function shell() {
    container.innerHTML = `
      <div class="broker-import">
        <button class="broker-toggle" id="bi-toggle" aria-expanded="false">
          <span>${t('broker_title')}</span><span class="broker-chev">▾</span>
        </button>
        <div class="broker-body" id="bi-body" hidden>
          <div class="broker-tabs" id="bi-tabs">
            ${TABS.map((id) => `<button class="broker-tab" data-tab="${id}">${TAB_LABEL[id]}</button>`).join('')}
          </div>
          <div class="broker-panel" id="bi-panel"></div>
          <div class="broker-msg small" id="bi-msg"></div>
        </div>
      </div>`;

    const toggle = container.querySelector('#bi-toggle');
    const body = container.querySelector('#bi-body');
    toggle.addEventListener('click', () => {
      const open = body.hidden;
      body.hidden = !open;
      toggle.setAttribute('aria-expanded', String(open));
      container.querySelector('.broker-chev').textContent = open ? '▴' : '▾';
      if (open) renderTab();
    });

    container.querySelectorAll('.broker-tab').forEach((b) => {
      b.addEventListener('click', () => { active = b.dataset.tab; renderTab(); });
    });

    // Auto-open and jump to cTrader if we just came back from its OAuth redirect.
    if (ctraderToken) { active = 'ctrader'; toggle.click(); }
  }

  function setMsg(message, cls = 'muted') {
    const el = container.querySelector('#bi-msg');
    if (el) { el.className = `broker-msg small ${cls}`; el.textContent = String(message ?? ''); }
  }

  function daysOptions() {
    return [30, 90, 180, 365].map((n) => `<option value="${n}"${n === 90 ? ' selected' : ''}>${n}</option>`).join('');
  }

  function renderTab() {
    container.querySelectorAll('.broker-tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === active));
    setMsg('');
    const panel = container.querySelector('#bi-panel');
    const enabled = integrations.brokers || {};

    if (active === 'binance' || active === 'bybit') {
      const isBinance = active === 'binance';
      panel.innerHTML = `
        <div class="broker-note muted small">${t('broker_readonly_note')}</div>
        <label class="broker-field"><span>${t('broker_api_key')}</span>
          <input class="select" id="bi-key" autocomplete="off" spellcheck="false"></label>
        <label class="broker-field"><span>${t('broker_api_secret')}</span>
          <input class="select" id="bi-secret" type="password" autocomplete="off" spellcheck="false"></label>
        ${isBinance ? `<label class="broker-field"><span>${t('broker_account_type')}</span>
          <select class="select" id="bi-acct"><option value="futures">${t('broker_acc_futures')}</option></select></label>` : ''}
        <label class="broker-field"><span>${t('broker_days')}</span>
          <select class="select" id="bi-days">${daysOptions()}</select></label>
        <button class="btn-primary" id="bi-load">${t('broker_load')}</button>`;
      panel.querySelector('#bi-load').addEventListener('click', () => loadKeyed(isBinance));
      return;
    }

    if (active === 'metatrader') {
      if (!enabled.metatrader) { panel.innerHTML = `<div class="muted small">${t('broker_unavailable')}</div>`; return; }
      panel.innerHTML = `
        <ol class="broker-steps small">
          <li>${t('broker_mt_step1')} <a href="#" class="link" id="bi-mt-dl">${t('broker_mt_download')}</a></li>
          <li>${t('broker_mt_step2')}</li>
          <li>${t('broker_mt_step3')}</li>
        </ol>
        <div class="broker-mt-cfg small" id="bi-mt-cfg"></div>
        <label class="broker-field"><span>${t('broker_mt_account')}</span>
          <input class="select" id="bi-mt-acct" inputmode="numeric"></label>
        <button class="btn-primary" id="bi-mt-fetch">${t('broker_mt_fetch')}</button>`;
      panel.querySelector('#bi-mt-dl').addEventListener('click', (e) => { e.preventDefault(); window.open(`${API_BASE}/api/broker/mt/ea`, '_blank'); });
      panel.querySelector('#bi-mt-fetch').addEventListener('click', fetchMT);
      // Show the push URL + token the user must paste into the EA.
      apiGet('/api/broker/mt/info').then((info) => {
        const cfg = container.querySelector('#bi-mt-cfg');
        if (cfg) cfg.innerHTML = `Server URL: <code>${escapeHtml(info.pushUrl)}</code><br>Token: <code>${escapeHtml(info.token || '—')}</code>`;
      }).catch(() => {});
      return;
    }

    if (active === 'ctrader') {
      if (!enabled.ctrader) { panel.innerHTML = `<div class="muted small">${t('broker_unavailable')}</div>`; return; }
      if (ctraderToken) {
        panel.innerHTML = `
          <div class="good small">✓ cTrader</div>
          <label class="broker-field"><span>${t('broker_ctrader_account')}</span>
            <input class="select" id="bi-ct-acct" inputmode="numeric"></label>
          <label class="broker-field"><span>${t('broker_days')}</span>
            <select class="select" id="bi-ct-days">${daysOptions()}</select></label>
          <button class="btn-primary" id="bi-ct-fetch">${t('broker_ctrader_fetch')}</button>`;
        panel.querySelector('#bi-ct-fetch').addEventListener('click', fetchCTrader);
      } else {
        panel.innerHTML = `
          <div class="muted small">${t('broker_ctrader_note')}</div>
          <button class="btn-primary" id="bi-ct-login">${t('broker_ctrader_login')}</button>`;
        panel.querySelector('#bi-ct-login').addEventListener('click', startCTraderOAuth);
      }
      return;
    }
  }

  // ── Actions ────────────────────────────────────────────────────────────────

  async function loadKeyed(isBinance) {
    const apiKey = container.querySelector('#bi-key').value.trim();
    const apiSecret = container.querySelector('#bi-secret').value.trim();
    const daysBack = Number(container.querySelector('#bi-days').value);
    if (!apiKey || !apiSecret) { setMsg(t('broker_api_key') + ' + ' + t('broker_api_secret') + '?', 'bad'); return; }
    setMsg(t('broker_loading'));
    const path = isBinance ? '/api/broker/binance/trades' : '/api/broker/bybit/trades';
    const body = isBinance
      ? { apiKey, apiSecret, accountType: container.querySelector('#bi-acct')?.value || 'futures', daysBack }
      : { apiKey, apiSecret, daysBack };
    try {
      const r = await apiPost(path, body);
      handleResult(r);
    } catch (err) { setMsg(t('broker_error', { msg: err.message }), 'bad'); }
  }

  async function fetchMT() {
    const accountId = container.querySelector('#bi-mt-acct').value.trim();
    if (!accountId) { setMsg(t('broker_mt_account') + '?', 'bad'); return; }
    setMsg(t('broker_loading'));
    try {
      const r = await apiPost('/api/broker/mt/fetch', { accountId });
      handleResult(r);
    } catch (err) {
      setMsg(/40\d/.test(err.message) ? t('broker_mt_nodata') : t('broker_error', { msg: err.message }), 'bad');
    }
  }

  async function startCTraderOAuth() {
    try {
      const { authUrl } = await apiGet('/api/broker/ctrader/auth');
      const safeUrl = safeExternalUrl(authUrl, { allowedHosts: ['connect.ctrader.com'] });
      if (safeUrl) window.open(safeUrl, '_blank', 'noopener');
      else setMsg(t('broker_unavailable'), 'bad');
    } catch (err) { setMsg(t('broker_error', { msg: err.message }), 'bad'); }
  }

  async function fetchCTrader() {
    const accountId = container.querySelector('#bi-ct-acct').value.trim();
    const daysBack = Number(container.querySelector('#bi-ct-days').value);
    if (!accountId) { setMsg(t('broker_ctrader_account') + '?', 'bad'); return; }
    setMsg(t('broker_loading'));
    try {
      const r = await apiPost('/api/broker/ctrader/trades', { accessToken: ctraderToken, accountId, daysBack });
      handleResult(r);
    } catch (err) { setMsg(t('broker_error', { msg: err.message }), 'bad'); }
  }

  function handleResult(r) {
    if (r.error) { setMsg(t('broker_error', { msg: r.error }), 'bad'); return; }
    const trades = (r.trades || []).map((tr) => ({
      date: tr.date || null,
      pnl: Number.isFinite(tr.pnl) ? tr.pnl : null,
      r: Number.isFinite(tr.r) ? tr.r : null,
      direction: tr.direction || null,
      symbol: tr.symbol || null,
    })).filter((tr) => tr.pnl !== null || tr.r !== null);
    if (!trades.length) { setMsg(t('broker_none'), 'warn'); return; }
    setMsg(t('broker_loaded', { n: trades.length, source: r.source || '' }), 'good');
    onTrades(trades);
  }

  // ── Init ─────────────────────────────────────────────────────────────────
  shell();
  getIntegrations().then((i) => { integrations = i; if (!container.querySelector('#bi-body').hidden) renderTab(); });
}
