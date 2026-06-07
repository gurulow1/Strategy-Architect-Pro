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
