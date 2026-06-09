// App shell: tab routing, language, dark theme, mobile hamburger, auth.
import { t, setLang, getLang, applyStatic, onLangChange } from './i18n.js';
import { state, newSeed } from './state.js';
import { mountQuickCheck }   from './workflows/quickCheck.js';
import { mountJournal }      from './workflows/journalAnalysis.js';
import { mountRobustness }   from './workflows/robustnessTest.js';
import { mountProp }         from './workflows/propChallenge.js';
import { refreshChartTheme } from './charts.js';
import {
  isFirebaseEnabled, hasFullAccess, isAuthenticated, isDemoMode,
  canAccess, signIn, register, signOutUser, resetPassword, signInWithGoogle,
  startDemo, onAuthChange,
} from './auth.js';

const TABS = [
  { id: 'quick',      titleKey: 'tab_quick',      subKey: 'tab_quick_sub',      mount: mountQuickCheck },
  { id: 'journal',    titleKey: 'tab_journal',     subKey: 'tab_journal_sub',    mount: mountJournal    },
  { id: 'robustness', titleKey: 'tab_robustness',  subKey: 'tab_robustness_sub', mount: mountRobustness },
  { id: 'prop',       titleKey: 'tab_prop',        subKey: 'tab_prop_sub',       mount: mountProp       },
];

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
  el.innerHTML = buildAuthOverlayHtml('landing');
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

function buildAuthOverlayHtml(view) {
  if (view === 'landing') {
    return `
      <div class="auth-card">
        <div style="font-size:32px;margin-bottom:12px;">📐</div>
        <h2>${t('brand')} <span class="brand-pro">${t('brand_pro')}</span></h2>
        <p>${t('auth_tagline')}</p>
        <button class="btn-primary" id="auth-open-login" style="margin-bottom:10px;">${t('auth_login')}</button>
        <button class="btn-secondary" id="auth-start-demo"
          style="width:100%;border:1px solid var(--line);background:var(--panel);color:var(--text);border-radius:12px;padding:11px;font-size:14px;font-weight:600;cursor:pointer;">
          ${t('auth_demo')}
        </button>
        <p class="small muted" style="margin-top:16px;">${t('auth_demo_limit')}</p>
      </div>`;
  }

  if (view === 'login') {
    return `
      <div class="auth-card">
        <h2>${t('auth_login')}</h2>
        <p class="small muted" style="margin-bottom:20px;">&nbsp;</p>
        ${isFirebaseEnabled() ? `
        <button class="btn-google" id="auth-google">
          <svg width="18" height="18" viewBox="0 0 18 18"><path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"/><path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"/><path fill="#FBBC05" d="M3.964 10.706A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.706V4.962H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.038l3.007-2.332z"/><path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.962L3.964 7.294C4.672 5.163 6.656 3.58 9 3.58z"/></svg>
          ${t('auth_google')}
        </button>
        <div class="auth-divider">${t('auth_or')}</div>` : ''}
        <div class="auth-field"><label>${t('auth_email')}</label><input type="email" id="auth-email" autocomplete="email"></div>
        <div class="auth-field"><label>${t('auth_password')}</label><input type="password" id="auth-pwd" autocomplete="current-password"></div>
        <div class="auth-error" id="auth-err"></div>
        <div class="auth-btn-row" style="margin-top:14px;">
          <button class="btn-secondary" id="auth-back" style="border:1px solid var(--line);background:var(--panel);color:var(--text);border-radius:12px;padding:11px;font-size:14px;font-weight:600;cursor:pointer;">←</button>
          <button class="btn-primary" id="auth-submit" style="flex:1;">${t('auth_login')}</button>
        </div>
        <p class="auth-switch"><a href="#" class="link" id="auth-to-register">${t('auth_switch_reg')}</a></p>
        <p class="auth-switch"><a href="#" class="link" id="auth-forgot">${t('auth_forgot')}</a></p>
      </div>`;
  }

  if (view === 'register') {
    return `
      <div class="auth-card">
        <h2>${t('auth_register')}</h2>
        <p class="small muted" style="margin-bottom:20px;">&nbsp;</p>
        <div class="auth-field"><label>${t('auth_email')}</label><input type="email" id="auth-email" autocomplete="email"></div>
        <div class="auth-field"><label>${t('auth_password')}</label><input type="password" id="auth-pwd" autocomplete="new-password"></div>
        <div class="auth-error" id="auth-err"></div>
        <div class="auth-btn-row" style="margin-top:14px;">
          <button class="btn-secondary" id="auth-back" style="border:1px solid var(--line);background:var(--panel);color:var(--text);border-radius:12px;padding:11px;font-size:14px;font-weight:600;cursor:pointer;">←</button>
          <button class="btn-primary" id="auth-submit" style="flex:1;">${t('auth_register')}</button>
        </div>
        <p class="auth-switch"><a href="#" class="link" id="auth-to-login">${t('auth_switch_login')}</a></p>
      </div>`;
  }

  return '';
}

function wireAuthOverlay(el) {
  const swap = (view) => { el.innerHTML = buildAuthOverlayHtml(view); wireAuthOverlay(el); };
  const setErr = (msg) => { const e = el.querySelector('#auth-err'); if (e) e.textContent = msg; };

  el.querySelector('#auth-open-login')?.addEventListener('click', () => swap('login'));
  el.querySelector('#auth-start-demo')?.addEventListener('click', () => { startDemo(); hideAuthOverlay(); updateHeaderAuth(); });
  el.querySelector('#auth-back')?.addEventListener('click', () => swap('landing'));
  el.querySelector('#auth-to-register')?.addEventListener('click', (e) => { e.preventDefault(); swap('register'); });
  el.querySelector('#auth-to-login')?.addEventListener('click', (e) => { e.preventDefault(); swap('login'); });

  el.querySelector('#auth-google')?.addEventListener('click', async () => {
    try { await signInWithGoogle(); hideAuthOverlay(); updateHeaderAuth(); }
    catch (err) { setErr(friendlyError(err)); }
  });

  el.querySelector('#auth-forgot')?.addEventListener('click', async (e) => {
    e.preventDefault();
    const email = el.querySelector('#auth-email')?.value.trim();
    if (!email) { setErr(t('auth_email') + '?'); return; }
    try { await resetPassword(email); setErr(t('auth_reset_sent')); }
    catch (err) { setErr(friendlyError(err)); }
  });

  el.querySelector('#auth-submit')?.addEventListener('click', async () => {
    const email = el.querySelector('#auth-email')?.value.trim() || '';
    const pwd   = el.querySelector('#auth-pwd')?.value || '';
    const btn   = el.querySelector('#auth-submit');
    if (!email || !pwd) return;
    btn.disabled = true;
    try {
      const isReg = el.querySelector('#auth-to-login'); // present on register view
      if (isReg) await register(email, pwd);
      else        await signIn(email, pwd);
      hideAuthOverlay();
      updateHeaderAuth();
    } catch (err) {
      setErr(friendlyError(err));
    } finally {
      btn.disabled = false;
    }
  });

  // Submit on Enter
  el.querySelectorAll('input').forEach((inp) => {
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') el.querySelector('#auth-submit')?.click(); });
  });
}

function friendlyError(err) {
  const code = err?.code || '';
  if (code.includes('invalid-credential') || code.includes('wrong-password') || code.includes('user-not-found')) return t('auth_err_invalid');
  if (code.includes('email-already-in-use')) return t('auth_err_exists');
  if (code.includes('weak-password'))        return t('auth_err_weak');
  return t('auth_err_generic');
}

// ── Shell rendering ───────────────────────────────────────────────────────────
export function boot() {
  state.seed = state.seed || newSeed();
  state.lang = getLang();
  renderShell();
  selectTab(activeTab);

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
        <div class="brand-name">${t('brand')} <span class="brand-pro">${t('brand_pro')}</span></div>
        <div class="brand-tag">${t('tagline')}</div>
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
      ${TABS.map((tb) => `
        <button class="tab" data-tab="${tb.id}">
          <span class="tab-title">${t(tb.titleKey)}</span>
          <span class="tab-sub">${t(tb.subKey)}</span>
        </button>`).join('')}
    </nav>
    <nav class="tabbar">
      ${TABS.map((tb) => `
        <button class="tab" data-tab="${tb.id}">
          <span class="tab-title">${t(tb.titleKey)}</span>
          <span class="tab-sub">${t(tb.subKey)}</span>
        </button>`).join('')}
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

  if (!isFirebaseEnabled()) {
    container.innerHTML = '';
    return;
  }

  if (isAuthenticated()) {
    const email = _currentEmail();
    const initial = email ? email[0].toUpperCase() : '?';
    container.innerHTML = `
      <div class="user-pill" id="user-pill">
        <span class="user-avatar">${initial}</span>
        <span class="small">${email}</span>
      </div>`;
    container.querySelector('#user-pill').addEventListener('click', async () => {
      await signOutUser();
      updateHeaderAuth();
      showAuthOverlay();
    });
  } else if (isDemoMode()) {
    container.innerHTML = `<span class="demo-badge" title="${t('auth_demo_limit')}">${t('auth_demo_badge')}</span>`;
  } else {
    container.innerHTML = `<button class="lang-btn" id="header-login-btn">${t('auth_login')}</button>`;
    container.querySelector('#header-login-btn')?.addEventListener('click', showAuthOverlay);
  }
}

function _currentEmail() {
  try { return currentUser()?.email || ''; } catch (_) { return ''; }
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
  toast.innerHTML = `<span>🔒 ${t('auth_protected')}</span><button class="btn-primary" style="width:auto;padding:7px 14px;font-size:12px;" id="toast-login">${t('auth_login')}</button>`;
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
