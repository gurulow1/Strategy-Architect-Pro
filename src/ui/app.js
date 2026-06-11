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
  isLicenseMode, hasFullAccess, canAccess, verifyKey, signOutUser, onAuthChange,
} from './auth.js';

const TABS = [
  { id: 'quick',      titleKey: 'tab_quick',      subKey: 'tab_quick_sub',      mount: mountQuickCheck, step: 1, badge: 'start' },
  { id: 'journal',    titleKey: 'tab_journal',     subKey: 'tab_journal_sub',    mount: mountJournal,    step: 2, badge: null    },
  { id: 'robustness', titleKey: 'tab_robustness',  subKey: 'tab_robustness_sub', mount: mountRobustness, step: 3, badge: null    },
  { id: 'prop',       titleKey: 'tab_prop',        subKey: 'tab_prop_sub',       mount: mountProp,       step: 4, badge: null    },
  { id: 'calc',       titleKey: 'tab_calc',        subKey: 'tab_calc_sub',       mount: mountPositionCalc, step: 5, badge: null },
];

// Single source for tab button markup (used by both the desktop bar and the
// mobile drawer) — keeps step numbers and the "Start here" badge in sync.
function tabButtonHtml(tb) {
  const badge = tb.badge === 'start' ? ` <span class="tab-badge">${t('tab_start_badge')}</span>` : '';
  return `
    <button class="tab" data-tab="${tb.id}">
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
  if (btn) btn.textContent = dark ? '☀️' : '🌙';
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
  return `
    <div class="auth-card">
      <div class="auth-glow" aria-hidden="true"></div>
      <div class="auth-head">
        <div class="brand-lockup">
          <div class="brand-icon auth-hex" aria-hidden="true">⬡</div>
          <div>
            <div class="brand-name">${t('brand')} <span class="brand-pro">${t('brand_pro')}</span></div>
            <div class="brand-tag">${t('tagline')}</div>
          </div>
        </div>
        <span class="lab-chip">🧪 ${t('lab')}</span>
      </div>
      <p class="auth-lead">${t('auth_tagline')}</p>
      <div class="auth-features">
        <div class="auth-feature"><span>📊</span> ${t('auth_feat_1')}</div>
        <div class="auth-feature"><span>🎲</span> ${t('auth_feat_2')}</div>
        <div class="auth-feature"><span>🤖</span> ${t('auth_feat_3')}</div>
      </div>
      <div class="auth-field">
        <label>${t('auth_key_label')}</label>
        <input type="password" id="auth-key" placeholder="${t('auth_key_placeholder')}"
          maxlength="64" spellcheck="false" autocomplete="off">
      </div>
      <label class="auth-remember">
        <input type="checkbox" id="auth-remember" checked>
        <span class="small muted">${t('auth_remember')}</span>
      </label>
      <div class="auth-error" id="auth-err"></div>
      <button class="btn-primary" id="auth-submit">${t('auth_unlock')}</button>
    </div>`;
}

function wireAuthOverlay(el) {
  const setErr = (msg) => { const e = el.querySelector('#auth-err'); if (e) e.textContent = msg; };

  el.querySelector('#auth-submit')?.addEventListener('click', async () => {
    const key    = el.querySelector('#auth-key')?.value.trim() || '';
    const remember = el.querySelector('#auth-remember')?.checked ?? true;
    const btn    = el.querySelector('#auth-submit');
    if (!key) { setErr(t('auth_key_label') + '?'); return; }
    btn.disabled = true;
    setErr('');
    try {
      await verifyKey(key, remember);
      hideAuthOverlay();
      updateHeaderAuth();
    } catch (err) {
      setErr(err.message || t('auth_err_generic'));
    } finally {
      btn.disabled = false;
    }
  });

  el.querySelector('#auth-key')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') el.querySelector('#auth-submit')?.click();
  });
}

// ── Background grid parallax (max ±5px shift on mouse move) ──────────────────
(function initGridParallax() {
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

// ── Primary-button radial highlight follows the cursor ─────────────────────────
document.addEventListener('mousemove', (e) => {
  const btn = e.target.closest('button.btn-primary');
  if (!btn) return;
  const r = btn.getBoundingClientRect();
  btn.style.setProperty('--rx', ((e.clientX - r.left) / r.width  * 100).toFixed(1) + '%');
  btn.style.setProperty('--ry', ((e.clientY - r.top)  / r.height * 100).toFixed(1) + '%');
}, { passive: true });

// ── Shell rendering ───────────────────────────────────────────────────────────
export function boot() {
  state.seed = state.seed || newSeed();
  state.lang = getLang();
  // Hide the "Start here" badge if the user has already run an analysis before.
  if (localStorage.getItem('sap_ran_once')) document.body.classList.add('sap-ran-once');
  renderShell();
  selectTab(activeTab);

  // Topbar gains a subtle glass effect once the page is scrolled.
  window.addEventListener('scroll', () => {
    document.querySelector('.topbar')?.classList.toggle('scrolled', window.scrollY > 10);
  }, { passive: true });

  onLangChange((lang) => {
    state.lang = lang;
    document.documentElement.lang = lang;
    document.querySelectorAll('.lang-btn').forEach((b) => b.classList.toggle('active', b.dataset.lang === lang));
    remountActive();
  });

  onAuthChange(() => {
    updateHeaderAuth();
    // If currently on a protected tab and lost access, switch to Quick Check.
    if (!canAccess(activeTab)) selectTab('quick');
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

function renderShell() {
  const app = document.getElementById('app');
  const dark = document.documentElement.classList.contains('dark');

  app.innerHTML = `
    <header class="topbar">
      <div class="brand">
        <div class="brand-lockup">
          <div class="brand-icon" aria-hidden="true">⬡</div>
          <div>
            <div class="brand-name">${t('brand')} <span class="brand-pro">${t('brand_pro')}</span></div>
            <div class="brand-tag">${t('tagline')}</div>
          </div>
        </div>
      </div>
      <div class="topbar-right">
        <span class="lab-chip">🧪 ${t('lab')}</span>
        <div class="lang-switch">
          <button class="lang-btn" data-lang="en">EN</button>
          <button class="lang-btn" data-lang="ru">RU</button>
        </div>
        <button class="theme-btn" id="theme-toggle" title="${dark ? t('theme_light') : t('theme_dark')}">${dark ? '☀️' : '🌙'}</button>
        <div id="header-auth"></div>
        <button class="hamburger-btn" id="hamburger-btn" aria-label="Menu">☰ Menu</button>
      </div>
    </header>
    <nav id="mobile-drawer" class="mobile-nav-drawer">
      ${TABS.map(tabButtonHtml).join('')}
    </nav>
    <nav class="tabbar">
      ${TABS.map(tabButtonHtml).join('')}
    </nav>
    <main class="panels" id="panels"></main>`;

  // Language buttons
  app.querySelectorAll('.lang-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.lang === getLang());
    b.addEventListener('click', () => setLang(b.dataset.lang));
  });
  document.documentElement.lang = getLang();

  // Theme toggle
  app.querySelector('#theme-toggle').addEventListener('click', toggleTheme);

  // Tabs (both desktop bar and mobile drawer)
  app.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => {
    const id = b.dataset.tab;
    if (!canAccess(id)) {
      showAccessDenied(id);
      return;
    }
    selectTab(id);
    // Close mobile drawer on tab select.
    document.getElementById('mobile-drawer')?.classList.remove('open');
  }));

  // Hamburger
  app.querySelector('#hamburger-btn')?.addEventListener('click', (e) => {
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
    container.innerHTML = `<button class="lang-btn" id="header-logout-btn">🔑 ${t('auth_logout')}</button>`;
    container.querySelector('#header-logout-btn')?.addEventListener('click', () => {
      signOutUser();
      updateHeaderAuth();
      showAuthOverlay();
    });
  } else {
    container.innerHTML = `<button class="lang-btn" id="header-login-btn">🔑 ${t('auth_key_btn')}</button>`;
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
  toast.innerHTML = `<span>🔒 ${t('auth_protected')}</span><button class="btn-primary" style="width:auto;padding:7px 14px;font-size:12px;" id="toast-login">${t('auth_key_btn')}</button>`;
  toast.querySelector('#toast-login')?.addEventListener('click', showAuthOverlay);
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.remove(), 4000);
}

// ── Tab selection ─────────────────────────────────────────────────────────────
function selectTab(id) {
  activeTab = id;
  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === id));
  const host = document.getElementById('panels');

  if (!panels[id]) {
    const el = document.createElement('section');
    el.className = 'panel-host';
    host.appendChild(el);
    const tab = TABS.find((tb) => tb.id === id);
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
