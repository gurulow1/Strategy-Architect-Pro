// Input control builders. Presentation only — they emit HTML and wire live
// value labels. Reading values is the workflow's job (document.getElementById).
import { t } from './i18n.js';

// A labelled range slider with a live value readout and optional tooltip.
export function slider({ id, labelKey, min, max, step, value, suffix = '', tipKey = null, decimals = null }) {
  const tip = tipKey
    ? `<span class="tip" title="${t(tipKey)}">?</span>` : '';
  return `
    <div class="control">
      <div class="control-head">
        <span>${t(labelKey)} ${tip}</span>
        <span class="control-val" id="val-${id}"></span>
      </div>
      <input id="${id}" type="range" min="${min}" max="${max}" step="${step}" value="${value}"
        data-suffix="${suffix}" ${decimals != null ? `data-dec="${decimals}"` : ''}>
    </div>`;
}

export function select({ id, labelKey, options, value }) {
  const opts = options.map((o) => `<option value="${o.value}" ${o.value === value ? 'selected' : ''}>${t(o.labelKey)}</option>`).join('');
  return `
    <div class="control">
      <div class="control-head"><span>${t(labelKey)}</span></div>
      <select id="${id}" class="select">${opts}</select>
    </div>`;
}

export function checkbox({ id, labelKey, checked = false }) {
  return `<label class="check"><input type="checkbox" id="${id}" ${checked ? 'checked' : ''}><span>${t(labelKey)}</span></label>`;
}

// Format a slider's live value from its data-suffix / data-dec.
function fmtSliderVal(el) {
  const suffix = el.dataset.suffix || '';
  const dec = el.dataset.dec != null ? +el.dataset.dec : (suffix === '%' ? 2 : suffix === '' ? 0 : 0);
  const num = parseFloat(el.value);
  if (suffix === '$') return `$${Math.round(num).toLocaleString('en-US')}`;
  return `${num.toFixed(dec)}${suffix}`;
}

// Attach live-value updating to all sliders inside a container.
export function wireSliders(container, onInput) {
  container.querySelectorAll('input[type="range"]').forEach((el) => {
    const label = container.querySelector(`#val-${el.id}`);
    const update = () => { if (label) label.textContent = fmtSliderVal(el); };
    update();
    el.addEventListener('input', () => { update(); if (onInput) onInput(el.id); });
  });
}

export const num = (id) => parseFloat(document.getElementById(id).value);
export const val = (id) => document.getElementById(id).value;
export const checked = (id) => document.getElementById(id).checked;
