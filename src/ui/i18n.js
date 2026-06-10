// i18n runtime. One real dictionary per language (no duplicated-blob bug).
import en from '../i18n/en.js';
import ru from '../i18n/ru.js';
import { formatVar } from './format.js';

const DICTS = { en, ru };
let current = localStorage.getItem('sap_lang') || 'en';
const listeners = new Set();

export function getLang() { return current; }

export function setLang(lang) {
  if (!DICTS[lang]) return;
  current = lang;
  localStorage.setItem('sap_lang', lang);
  applyStatic();
  listeners.forEach((fn) => fn(lang));
}

export function onLangChange(fn) { listeners.add(fn); }

// Translate a key with optional {var} interpolation (values printed verbatim).
export function t(key, vars) {
  const dict = DICTS[current] || DICTS.en;
  let s = dict[key];
  if (s === undefined) s = DICTS.en[key] !== undefined ? DICTS.en[key] : key;
  if (vars) {
    s = s.replace(/\{(\w+)\}/g, (m, name) => (name in vars ? vars[name] : m));
  }
  return s;
}

// Translate a diagnostic finding {id, vars} into a localized sentence,
// formatting each variable by its semantic key.
export function tFinding(finding) {
  const vars = {};
  for (const [k, v] of Object.entries(finding.vars || {})) vars[k] = formatVar(k, v);
  // Localize enum-valued vars (kept language-neutral in the pure analysis layer).
  const raw = finding.vars || {};
  if (raw.losingDirection) vars.losingDirection = t(`dir_${raw.losingDirection}`);
  if (raw.dayIndex != null) vars.day = t(`dow_${raw.dayIndex}`);
  return t(`find.${finding.id}`, vars);
}

// Apply translations to any element carrying data-i18n / data-i18n-ph / data-i18n-title.
export function applyStatic(root = document) {
  root.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(el.getAttribute('data-i18n'));
  });
  root.querySelectorAll('[data-i18n-ph]').forEach((el) => {
    el.setAttribute('placeholder', t(el.getAttribute('data-i18n-ph')));
  });
  root.querySelectorAll('[data-i18n-title]').forEach((el) => {
    el.setAttribute('title', t(el.getAttribute('data-i18n-title')));
  });
}
