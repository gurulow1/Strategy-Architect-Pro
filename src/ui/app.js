// App shell: tab routing, language, dark theme, mobile hamburger, auth.
import { t, setLang, getLang, applyStatic, onLangChange } from './i18n.js';
import { state, newSeed } from './state.js';
import { mountQuickCheck }   from './workflows/quickCheck.js';
import { mountJournal }      from './workflows/journalAnalysis.js';
import { mountRobustness }   from './workflows/robustnessTest.js';
import { mountProp }         from './workflows/propChallenge.js';
import { mountPositionCalc, refreshPositionCalc } from './workflows/positionCalc.js';
import { refreshChartTheme } from './charts.js';
import {
  isLicenseMode, hasFullAccess, hasTrialAccess, canAccess, verifyKey, startTrial,
  signOutUser, onAuthChange,
} from './auth.js';

const TABS = [
  { id: 'quick',      titleKey: 'tab_quick',      subKey: 'tab_quick_sub',      mount: mountQuickCheck, step: 1, badge: 'start' },
  { id: 'journal',    titleKey: 'tab_journal',     subKey: 'tab_journal_sub',    mount: mountJournal,    step: 2, badge: null    },
  { id: 'robustness', titleKey: 'tab_robustness',  subKey: 'tab_robustness_sub', mount: mountRobustness, step: 3, badge: null    },
  { id: 'prop',       titleKey: 'tab_prop',        subKey: 'tab_prop_sub',       mount: mountProp,       step: 4, badge: null    },
  { id: 'calc',       titleKey: 'tab_calc',        subKey: 'tab_calc_sub',       mount: mountPositionCalc, step: 5, badge: null },
];

// A compact, purpose-drawn icon family for the mobile workflow dock.
// Every mark uses the same rounded 1.8px construction and currentColor.
const TAB_ICON_PATHS = {
  quick: `
    <path d="M4.5 16.8c2.2-6.9 6.8-9.7 14.8-8.6"/>
    <path d="m15.7 4.8 3.6 3.4-4.5 2.3"/>
    <circle cx="5.1" cy="17.1" r="1.6"/>`,
  journal: `
    <path d="M5 7.2c2.7-1.9 5.2-1.9 7.4 0 2.1 1.8 4.3 1.8 6.6 0v9.6c-2.3 1.8-4.5 1.8-6.6 0-2.2-1.9-4.7-1.9-7.4 0z"/>
    <path d="M8 10.3h4.1M8 13.4h7.7"/>`,
  robustness: `
    <path d="m12 3.8 7.1 4.1v8.2L12 20.2l-7.1-4.1V7.9z"/>
    <path d="m7.5 12.8 2.6-3 2.4 4.3 4-5"/>`,
  prop: `
    <path d="M4.4 18.4 9.7 6.1l3.1 6.1 2-3.8 4.8 10"/>
    <path d="M7.1 15.2h9.8M9.7 6.1l2.3-2.3 2.2 2.3"/>`,
  calc: `
    <path d="M4.5 16.7a8.1 8.1 0 0 1 15 0"/>
    <path d="m12 13.1 4.2-3.4"/>
    <circle cx="12" cy="16.7" r="1.6"/>
    <path d="M7.1 17h-2.6M19.5 17h-2.6"/>`,
};

// Short labels (full titles like "Robustness Test" overflow a 10px bottom label).
const TAB_SHORT_KEY = {
  quick: 'tab_quick_short', journal: 'tab_journal_short',
  robustness: 'tab_robustness_short', prop: 'tab_prop_short', calc: 'tab_calc_short',
};

function bottomTabHtml(tb) {
  return `
    <button type="button" class="bottom-tab" data-tab="${tb.id}" aria-label="${t(tb.titleKey)}">
      <svg class="bt-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
        ${TAB_ICON_PATHS[tb.id]}
      </svg>
      <span class="bt-label">${t(TAB_SHORT_KEY[tb.id])}</span>
    </button>`;
}

// Single source for tab button markup (used by both the desktop bar and the
// mobile drawer) — keeps step numbers and the "Start here" badge in sync.
function tabButtonHtml(tb) {
  const badge = tb.badge === 'start' ? ` <span class="tab-badge">${t('tab_start_badge')}</span>` : '';
  return `
    <button type="button" class="tab" data-tab="${tb.id}">
      <div class="tab-step">${tb.step}</div>
      <span class="tab-title">${t(tb.titleKey)}${badge}</span>
      <span class="tab-sub">${t(tb.subKey)}</span>
    </button>`;
}

const panels = {};
let activeTab = 'quick';

// ── Theme ─────────────────────────────────────────────────────────────────────
export function initTheme() {
  const saved = localStorage.getItem('sap_theme');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const dark = saved ? saved === 'dark' : prefersDark;
  applyTheme(dark, false);
}

function applyTheme(dark, animate = true) {
  if (!animate) document.documentElement.style.setProperty('transition', 'none');
  document.documentElement.classList.toggle('dark', dark);
  localStorage.setItem('sap_theme', dark ? 'dark' : 'light');
  if (!animate) requestAnimationFrame(() => document.documentElement.style.removeProperty('transition'));
  // Update toggle icon if it exists in the DOM.
  const btn = document.getElementById('theme-toggle');
  if (btn) {
    const label = dark ? t('theme_light') : t('theme_dark');
    btn.textContent = '';
    btn.setAttribute('aria-label', label);
    btn.title = label;
  }
  // Refresh chart colors.
  refreshChartTheme();
}

function toggleTheme() {
  applyTheme(!document.documentElement.classList.contains('dark'));
}

// ── Auth overlay ──────────────────────────────────────────────────────────────
export function showAuthOverlay() {
  if (document.getElementById('auth-overlay')) return;
  const el = document.createElement('div');
  el.id = 'auth-overlay';
  el.className = 'auth-overlay';
  el.innerHTML = buildAuthOverlayHtml();
  document.body.appendChild(el);
  wireAuthOverlay(el);
}

function hideAuthOverlay() {
  const el = document.getElementById('auth-overlay');
  if (el) {
    el.style.opacity = '0';
    el.style.transition = 'opacity .25s';
    setTimeout(() => el.remove(), 260);
  }
}

function buildAuthOverlayHtml() {
  const trialAction = hasTrialAccess()
    ? ''
    : `<button type="button" class="btn-primary auth-trial-btn" id="auth-trial">${t('auth_trial_start')}</button>
      <div class="auth-divider"><span>${t('auth_or_activate')}</span></div>`;
  return `
    <div class="auth-card" role="dialog" aria-modal="true" aria-labelledby="auth-title">
      <div class="auth-glow" aria-hidden="true"></div>
      <div class="auth-head">
        <div class="brand-lockup">
          <div class="brand-icon auth-hex" aria-hidden="true"></div>
          <div>
            <div class="brand-name" id="auth-title">${t('brand')} <span class="brand-pro">${t('brand_pro')}</span></div>
            <div class="brand-tag">${t('tagline')}</div>
          </div>
        </div>
        <span class="lab-chip">${t('lab')}</span>
      </div>
      <p class="auth-lead">${t('auth_tagline')}</p>
      <div class="auth-features">
        <div class="auth-feature"><span aria-hidden="true"></span> ${t('auth_feat_1')}</div>
        <div class="auth-feature"><span aria-hidden="true"></span> ${t('auth_feat_2')}</div>
        <div class="auth-feature"><span aria-hidden="true"></span> ${t('auth_feat_3')}</div>
      </div>
      ${trialAction}
      <div class="auth-field">
        <label for="auth-key">${t('auth_key_label')}</label>
        <input type="text" id="auth-key" placeholder="${t('auth_key_placeholder')}"
          maxlength="39" spellcheck="false" autocomplete="one-time-code"
          autocapitalize="characters" inputmode="text">
      </div>
      <label class="auth-remember">
        <input type="checkbox" id="auth-remember" checked>
        <span class="small muted">${t('auth_remember')}</span>
      </label>
      <div class="auth-error" id="auth-err"></div>
      <button type="button" class="btn-primary" id="auth-submit">${t('auth_unlock')}</button>
      <p class="small muted auth-privacy-note">${t('auth_privacy_note')}</p>
      <p class="small muted auth-legal-links">
        ${t('auth_legal_prefix')}
        <a href="/terms.html" target="_blank" rel="noopener">${t('footer_terms')}</a>
        ·
        <a href="/privacy.html" target="_blank" rel="noopener">${t('footer_privacy')}</a>
      </p>
    </div>`;
}

function wireAuthOverlay(el) {
  const setErr = (msg) => { const e = el.querySelector('#auth-err'); if (e) e.textContent = msg; };
  const setBusy = (busy) => {
    el.querySelectorAll('button').forEach((button) => { button.disabled = busy; });
  };

  el.querySelector('#auth-trial')?.addEventListener('click', async () => {
    setBusy(true);
    setErr('');
    try {
      await startTrial();
      hideAuthOverlay();
      updateHeaderAuth();
    } catch (err) {
      setErr(err.message || t('auth_err_generic'));
    } finally {
      setBusy(false);
    }
  });

  el.querySelector('#auth-submit')?.addEventListener('click', async () => {
    const key    = el.querySelector('#auth-key')?.value.trim() || '';
    const remember = el.querySelector('#auth-remember')?.checked ?? true;
    if (!key) { setErr(t('auth_key_label') + '?'); return; }
    setBusy(true);
    setErr('');
    try {
      await verifyKey(key, remember);
      hideAuthOverlay();
      updateHeaderAuth();
    } catch (err) {
      setErr(err.message || t('auth_err_generic'));
    } finally {
      setBusy(false);
    }
  });

  const keyInput = el.querySelector('#auth-key');
  keyInput?.addEventListener('input', () => {
    const compact = keyInput.value.toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, 32);
    keyInput.value = compact.match(/.{1,4}/g)?.join('-') || '';
  });
  keyInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') el.querySelector('#auth-submit')?.click();
  });
  requestAnimationFrame(() => (el.querySelector('#auth-trial') || keyInput)?.focus());
}

// ── Background grid parallax (max ±5px shift on mouse move) ──────────────────
(function initGridParallax() {
  // Touch devices never fire mousemove usefully — skip so the listener and its
  // per-move style recalc never exist on phones/tablets.
  if (window.matchMedia('(pointer: coarse)').matches) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  let rafId = null;
  let tx = 0, ty = 0;
  document.addEventListener('mousemove', (e) => {
    tx = (e.clientX / window.innerWidth  - 0.5) * 10;
    ty = (e.clientY / window.innerHeight - 0.5) * 10;
    if (rafId) return;
    rafId = requestAnimationFrame(() => {
      document.documentElement.style.setProperty('--grid-x', `${tx.toFixed(1)}px`);
      document.documentElement.style.setProperty('--grid-y', `${ty.toFixed(1)}px`);
      rafId = null;
    });
  }, { passive: true });
}());

// ── Primary-button radial highlight follows the cursor (pointer devices only) ──
if (!window.matchMedia('(pointer: coarse)').matches) {
  document.addEventListener('mousemove', (e) => {
    const btn = e.target.closest('button.btn-primary');
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    btn.style.setProperty('--rx', ((e.clientX - r.left) / r.width  * 100).toFixed(1) + '%');
    btn.style.setProperty('--ry', ((e.clientY - r.top)  / r.height * 100).toFixed(1) + '%');
  }, { passive: true });
}

// ── Shell rendering ───────────────────────────────────────────────────────────
export function boot() {
  state.seed = state.seed || newSeed();
  state.lang = getLang();
  // Hide the "Start here" badge if the user has already run an analysis before.
  if (localStorage.getItem('sap_ran_once')) document.body.classList.add('sap-ran-once');
  renderShell();
  if (hasFullAccess()) selectTab(activeTab);

  // Topbar gains a subtle glass effect once the page is scrolled.
  window.addEventListener('scroll', () => {
    document.getElementById('topbar-shell')?.classList.toggle('scrolled', window.scrollY > 10);
  }, { passive: true });

  onLangChange((lang) => {
    state.lang = lang;
    document.documentElement.lang = lang;
    document.querySelectorAll('.lang-switch .lang-btn').forEach((b) => {
      const active = b.dataset.lang === lang;
      b.classList.toggle('active', active);
      b.setAttribute('aria-pressed', String(active));
    });
    remountActive();
  });

  onAuthChange(({ hasFullAccess: accessGranted }) => {
    updateHeaderAuth();
    if (accessGranted) {
      if (!panels[activeTab]) selectTab(activeTab);
    } else {
      resetProtectedState();
    }
    // Show/hide AI chat trigger (the button is created by AIChat.js and
    // self-identifies via window.__sap_setAIChatVisible).
    if (typeof window.__sap_setAIChatVisible === 'function') {
      window.__sap_setAIChatVisible(canAccess('ai'));
    }
  });

  // Auto-refresh the Risk Sensitivity panel when a new analysis lands, even if
  // the user is already viewing it (workflows call this after renderReport).
  window.__sap_refreshRisk = () => {
    if (panels.calc) refreshPositionCalc(panels.calc.el);
  };

  window.__sap_navigateTo = (tabId, elementId) => {
    if (tabId && tabId !== activeTab) {
      selectTab(tabId);
      if (elementId) setTimeout(() => highlightElement(elementId), 150);
    } else if (elementId) {
      highlightElement(elementId);
    }
  };
}

function resetProtectedState() {
  Object.values(panels).forEach((panel) => panel.el.remove());
  for (const key of Object.keys(panels)) delete panels[key];
  state.lastReport = null;
  state.strategy = null;
  window.__sap_currentAnalysis = {};
}

function renderShell() {
  const app = document.getElementById('app');
  const dark = document.documentElement.classList.contains('dark');

  // The header lives in a full-bleed sticky shell OUTSIDE the centered #app
  // column, so its background spans the entire viewport width. (Inside #app it
  // rendered as a centered rectangle floating over the side margins on wide
  // screens.) The inner .topbar keeps the content constrained to #app's width.
  let shell = document.getElementById('topbar-shell');
  if (!shell) {
    shell = document.createElement('header');
    shell.id = 'topbar-shell';
    shell.className = 'topbar-shell';
    app.parentNode.insertBefore(shell, app);
  }
  shell.innerHTML = `
    <div class="topbar">
      <div class="brand">
        <div class="brand-lockup">
          <div class="brand-icon" aria-hidden="true"></div>
          <div>
            <div class="brand-name">${t('brand')} <span class="brand-pro">${t('brand_pro')}</span></div>
            <div class="brand-tag">${t('tagline')}</div>
          </div>
        </div>
      </div>
      <div class="topbar-right">
        <span class="lab-chip">${t('lab')}</span>
        <div class="lang-switch">
          <button type="button" class="lang-btn" data-lang="en">EN</button>
          <button type="button" class="lang-btn" data-lang="ru">RU</button>
        </div>
        <button type="button" class="theme-btn" id="theme-toggle"
          aria-label="${dark ? t('theme_light') : t('theme_dark')}"
          title="${dark ? t('theme_light') : t('theme_dark')}"></button>
        <div id="header-auth"></div>
        <button class="hamburger-btn" id="hamburger-btn" aria-label="Menu">☰ Menu</button>
      </div>
    </div>`;

  app.innerHTML = `
    <nav id="mobile-drawer" class="mobile-nav-drawer" aria-label="Analysis workflows">
      ${TABS.map(tabButtonHtml).join('')}
    </nav>
    <nav class="tabbar" aria-label="Analysis workflows">
      ${TABS.map(tabButtonHtml).join('')}
    </nav>
    <main class="panels" id="panels"></main>
    <footer class="site-footer">
      <span>${t('footer_notice')}</span>
      <nav class="site-footer-links" aria-label="${t('footer_legal_nav')}">
        <a href="/privacy.html">${t('footer_privacy')}</a>
        <a href="/terms.html">${t('footer_terms')}</a>
        <a href="https://t.me/djordano0" target="_blank" rel="noopener noreferrer">${t('footer_contact')}</a>
      </nav>
    </footer>
    <nav class="bottom-tabbar" id="bottom-tabbar" aria-label="Primary">
      <div class="bottom-tabbar-inner">
        ${TABS.map(bottomTabHtml).join('')}
      </div>
    </nav>`;

  // Language buttons (live in the shell now — query the document).
  // Run before updateHeaderAuth so the auth button (also .lang-btn) isn't caught.
  document.querySelectorAll('.lang-switch .lang-btn').forEach((b) => {
    const active = b.dataset.lang === getLang();
    b.classList.toggle('active', active);
    b.setAttribute('aria-pressed', String(active));
    b.addEventListener('click', () => setLang(b.dataset.lang));
  });
  document.documentElement.lang = getLang();

  // Theme toggle
  document.getElementById('theme-toggle').addEventListener('click', toggleTheme);

  // Tabs (desktop bar, mobile drawer, and the mobile bottom bar)
  document.querySelectorAll('.tab, .bottom-tab').forEach((b) => b.addEventListener('click', () => {
    const id = b.dataset.tab;
    if (!canAccess(id)) {
      showAccessDenied(id);
      return;
    }
    selectTab(id);
    // Close mobile drawer on tab select.
    document.getElementById('mobile-drawer')?.classList.remove('open');
    // Scroll back to the top so the new tab starts at its header.
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }));

  // Hamburger
  document.getElementById('hamburger-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    document.getElementById('mobile-drawer')?.classList.toggle('open');
  });
  document.addEventListener('click', (e) => {
    const drawer = document.getElementById('mobile-drawer');
    const hamburger = document.getElementById('hamburger-btn');
    if (drawer?.classList.contains('open') && !drawer.contains(e.target) && e.target !== hamburger) {
      drawer.classList.remove('open');
    }
  }, { passive: true });

  updateHeaderAuth();
}

// ── Header auth widget ────────────────────────────────────────────────────────
function updateHeaderAuth() {
  const container = document.getElementById('header-auth');
  if (!container) return;

  if (!isLicenseMode()) {
    container.innerHTML = '';
    return;
  }

  if (hasFullAccess()) {
    const label = hasTrialAccess() ? t('auth_trial_active') : t('auth_logout');
    container.innerHTML = `<button type="button" class="lang-btn" id="header-logout-btn">${label}</button>`;
    container.querySelector('#header-logout-btn')?.addEventListener('click', () => {
      if (!hasTrialAccess()) signOutUser();
      updateHeaderAuth();
      showAuthOverlay();
    });
  } else {
    container.innerHTML = `<button type="button" class="lang-btn" id="header-login-btn">${t('auth_key_btn')}</button>`;
    container.querySelector('#header-login-btn')?.addEventListener('click', showAuthOverlay);
  }
}

// ── Locked feature placeholder ────────────────────────────────────────────────
function showAccessDenied(tabId) {
  const tab = TABS.find((t) => t.id === tabId);
  // Show a toast-style message asking them to sign in.
  let toast = document.getElementById('auth-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'auth-toast';
    toast.style.cssText = [
      'position:fixed', 'bottom:80px', 'left:50%', 'transform:translateX(-50%)',
      'background:var(--panel)', 'border:1px solid var(--line)', 'border-radius:12px',
      'padding:12px 20px', 'font-size:13px', 'z-index:999', 'box-shadow:var(--shadow)',
      'display:flex', 'align-items:center', 'gap:10px',
    ].join(';');
    document.body.appendChild(toast);
  }
  toast.innerHTML = `<span>${t('auth_protected')}</span><button type="button" class="btn-primary" style="width:auto;padding:7px 14px;font-size:12px;" id="toast-login">${t('auth_key_btn')}</button>`;
  toast.querySelector('#toast-login')?.addEventListener('click', showAuthOverlay);
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.remove(), 4000);
}

// ── Tab selection ─────────────────────────────────────────────────────────────
function selectTab(id) {
  const tab = TABS.find((item) => item.id === id);
  if (!tab || !canAccess(id)) {
    showAccessDenied(id);
    return;
  }
  activeTab = id;
  document.querySelectorAll('.tab').forEach((b) => {
    const isActive = b.dataset.tab === id;
    b.classList.toggle('active', isActive);
    if (isActive) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  });
  document.querySelectorAll('.bottom-tab').forEach((b) => {
    const isActive = b.dataset.tab === id;
    b.classList.toggle('active', isActive);
    b.classList.toggle('locked', !canAccess(b.dataset.tab));
    if (isActive) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  });
  const host = document.getElementById('panels');

  if (!panels[id]) {
    const el = document.createElement('section');
    el.className = 'panel-host';
    host.appendChild(el);
    const controller = tab.mount(el);
    panels[id] = { el, controller };
    applyStatic(el);
  }
  Object.entries(panels).forEach(([pid, p]) => { p.el.style.display = pid === id ? 'block' : 'none'; });

  const ctrl = panels[id].controller;
  if (ctrl?.rerender) ctrl.rerender();
  applyStatic(panels[id].el);
}

function remountActive() {
  Object.values(panels).forEach((p) => p.el.remove());
  for (const k of Object.keys(panels)) delete panels[k];
  renderShell();
  selectTab(activeTab);
}

// ── Element highlight helper ──────────────────────────────────────────────────
function highlightElement(id) {
  if (!id) return;
  const activePanel = panels[activeTab]?.el ?? null;
  let el = activePanel ? activePanel.querySelector(`#${CSS.escape(id)}`) : null;
  if (!el) el = document.getElementById(id);
  if (!el) return;

  let node = el.parentElement;
  while (node && node !== document.body) {
    if (node.tagName === 'DETAILS') node.open = true;
    node = node.parentElement;
  }
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el.classList.remove('ai-highlight');
  requestAnimationFrame(() => {
    el.classList.add('ai-highlight');
    setTimeout(() => el.classList.remove('ai-highlight'), 2300);
  });
}
