// App shell: tab routing, language, and lazy workflow mounting.
import { t, setLang, getLang, applyStatic, onLangChange } from './i18n.js';
import { state, newSeed } from './state.js';
import { mountQuickCheck } from './workflows/quickCheck.js';
import { mountJournal } from './workflows/journalAnalysis.js';
import { mountRobustness } from './workflows/robustnessTest.js';
import { mountProp } from './workflows/propChallenge.js';

const TABS = [
  { id: 'quick', titleKey: 'tab_quick', subKey: 'tab_quick_sub', mount: mountQuickCheck },
  { id: 'journal', titleKey: 'tab_journal', subKey: 'tab_journal_sub', mount: mountJournal },
  { id: 'robustness', titleKey: 'tab_robustness', subKey: 'tab_robustness_sub', mount: mountRobustness },
  { id: 'prop', titleKey: 'tab_prop', subKey: 'tab_prop_sub', mount: mountProp },
];

const panels = {}; // id -> { el, controller }
let activeTab = 'quick';

export function boot() {
  state.seed = newSeed();
  state.lang = getLang();
  renderShell();
  selectTab('quick');

  onLangChange((lang) => {
    state.lang = lang;
    document.documentElement.lang = lang;
    document.querySelectorAll('.lang-btn').forEach((b) => b.classList.toggle('active', b.dataset.lang === lang));
    // Re-mount the active tab so dynamic content is re-translated.
    remountActive();
  });

  // ── Contextual navigation API for AI chat ──────────────────────────────────
  // Called by AIChat.js when the user clicks a "📍 Go to …" pill.
  // 1. Switch to the target tab (if different from the current one).
  // 2. After the tab is mounted / visible, find and flash the element.
  window.__sap_navigateTo = (tabId, elementId) => {
    if (tabId && tabId !== activeTab) {
      selectTab(tabId);
      // Give the panel a tick to become visible before searching.
      if (elementId) setTimeout(() => highlightElement(elementId), 150);
    } else if (elementId) {
      highlightElement(elementId);
    }
  };
}

function renderShell() {
  const app = document.getElementById('app');
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
      </div>
    </header>
    <nav class="tabbar">
      ${TABS.map((tb) => `
        <button class="tab" data-tab="${tb.id}">
          <span class="tab-title">${t(tb.titleKey)}</span>
          <span class="tab-sub">${t(tb.subKey)}</span>
        </button>`).join('')}
    </nav>
    <main class="panels" id="panels"></main>`;

  app.querySelectorAll('.lang-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.lang === getLang());
    b.addEventListener('click', () => setLang(b.dataset.lang));
  });
  app.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => selectTab(b.dataset.tab)));
  document.documentElement.lang = getLang();
}

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

  // Every tab refreshes on entry: Robustness reflects the shared strategy;
  // Quick/Journal restore their last rendered report after a language switch.
  const c = panels[id].controller;
  if (c && c.rerender) c.rerender();
  applyStatic(panels[id].el);
}

function remountActive() {
  // Drop all cached panels and rebuild the shell (re-translates everything),
  // then re-open whatever tab was active. Computed reports persist in `state`.
  Object.values(panels).forEach((p) => p.el.remove());
  for (const k of Object.keys(panels)) delete panels[k];
  renderShell();
  selectTab(activeTab);
}

// ── Element highlight helper ────────────────────────────────────────────────
// Finds the element by id inside the currently-visible panel-host, opens any
// collapsed <details> ancestors, scrolls it into view, and plays the flash
// animation (css class "ai-highlight", injected by AIChat.js).
function highlightElement(id) {
  if (!id) return;

  // Search inside the active (visible) panel-host first; fall back to document.
  // Note: getElementById lives only on Document, so we use querySelector('#id').
  const activePanel = panels[activeTab]?.el ?? null;
  let el = activePanel ? activePanel.querySelector(`#${CSS.escape(id)}`) : null;
  if (!el) {
    // Some elements may live outside the panel-host (e.g. summary cards).
    el = document.getElementById(id);
  }
  if (!el) return;

  // Open any collapsed <details> ancestors so the element is reachable.
  let node = el.parentElement;
  while (node && node !== document.body) {
    if (node.tagName === 'DETAILS') node.open = true;
    node = node.parentElement;
  }

  el.scrollIntoView({ behavior: 'smooth', block: 'center' });

  // Remove then re-add the class so re-clicking the pill replays the animation.
  el.classList.remove('ai-highlight');
  // One rAF ensures the browser processes the removal before adding it back.
  requestAnimationFrame(() => {
    el.classList.add('ai-highlight');
    setTimeout(() => el.classList.remove('ai-highlight'), 2300);
  });
}
