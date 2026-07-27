// AI-powered journal parser.
// Accepts CSV / TSV / TXT drops, parses known formats locally, and only sends
// a short sample to OpenAI after explicit consent for an unknown layout.
//
// Uses ONLY existing CSS classes from styles.css — no new rules, no inline
// decorative styles. display toggling via element.style is kept to a minimum
// (same pattern used throughout app.js).

import { callAI } from '../services/aiClient.js';
import { parseCsv, parseMetaTrader, looksLikeMetaTrader, rowsFromCsv } from '../analysis/journal.js';
import { t } from './i18n.js';
import { escapeHtml } from './safeDom.js';

// Fields the AI normalizes to; their display order.
const TRADE_FIELDS = ['date', 'pnl', 'r_multiple', 'direction', 'duration_minutes'];

// ── Smart truncation for AI token budget ────────────────────────────────────
// Keeps header + first FIRST_N data rows + last LAST_N data rows + hard char cap.
// The full rawText is never modified — truncation only affects the AI call.
const FIRST_N  = 50;
const LAST_N   = 20;
const CHAR_CAP = 8000;
const MAX_FILE_BYTES = 5 * 1024 * 1024;

function truncateForAI(rawText) {
  const allLines  = rawText.split(/\r?\n/);
  const header    = allLines[0] ?? '';
  const dataLines = allLines.slice(1).filter((l) => l.trim().length > 0);

  let truncated = false;
  let preview;

  if (dataLines.length <= FIRST_N + LAST_N) {
    // Small file — no row truncation needed.
    preview = [header, ...dataLines].join('\n');
  } else {
    truncated = true;
    const head = dataLines.slice(0, FIRST_N);
    const tail = dataLines.slice(dataLines.length - LAST_N);
    preview = [header, ...head, '...', ...tail].join('\n');
  }

  // Hard character cap — safeguard for very wide rows.
  if (preview.length > CHAR_CAP) {
    truncated = true;
    // Trim to cap, then back up to the last complete line so we don't send a partial row.
    let cut = preview.slice(0, CHAR_CAP);
    const lastNL = cut.lastIndexOf('\n');
    if (lastNL > CHAR_CAP * 0.7) cut = cut.slice(0, lastNL);
    preview = cut;
  }

  return { text: preview, truncated };
}

export function createAIJournalParser(container, onTradesConfirmed) {
  let lastResult = null;

  // ── State renderers ──────────────────────────────────────────────────────

  function showIdle() {
    container.innerHTML = `
      <div class="dropzone" id="ai-jp-drop" role="button" tabindex="0" aria-label="${t('jr_upload_btn')}">
        <div class="dropzone-icon" aria-hidden="true">📂</div>
        <strong>${t('jr_upload_btn')}</strong>
        <div class="muted small">${t('jr_upload_hint')}</div>
        <input type="file" id="ai-jp-file" accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain" hidden>
      </div>`;

    const drop = container.querySelector('#ai-jp-drop');
    const fileInput = container.querySelector('#ai-jp-file');

    drop.addEventListener('click', () => fileInput.click());
    drop.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); }
    });
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', (e) => {
      e.preventDefault();
      drop.classList.remove('over');
      if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
    });
    fileInput.addEventListener('change', (e) => {
      if (e.target.files.length) handleFile(e.target.files[0]);
    });
  }

  function showLoading() {
    container.innerHTML = `<div class="muted small">${escapeHtml(t('jr_processing'))}</div>`;
  }

  function showPreview(result, truncated = false) {
    const { trades, detected_columns, warnings } = result;
    const sample = trades.slice(0, 3);

    // Only show fields that have at least one non-null value in the first 3 rows.
    const activeFields = TRADE_FIELDS.filter(k => sample.some(t => t[k] != null));

    // Pivot table: column names as rows, sample trade values across columns.
    const sampleCount = Math.min(sample.length, 3);
    const headerCells = Array.from(
      { length: sampleCount },
      (_, i) => `<th>${escapeHtml(t('jr_row', { n: i + 1 }))}</th>`,
    ).join('');
    const bodyRows = activeFields.map(field => {
      const cells = sample.map(t => {
        const v = t[field];
        return `<td>${v != null ? escapeHtml(v) : '<span class="muted">—</span>'}</td>`;
      }).join('');
      return `<tr><td><strong>${escapeHtml(field)}</strong></td>${cells}</tr>`;
    }).join('');

    const fmt = detected_columns?.format || 'Generic';
    const extraCount = trades.length - sampleCount;
    const moreHtml = extraCount > 0
      ? `<div class="muted small">${escapeHtml(t('jr_more_trades', { n: extraCount }))}</div>`
      : '';
    const warningHtml = (warnings || [])
      .map((w) => `<div class="small bad">${escapeHtml(w)}</div>`)
      .join('');
    const truncNoteHtml = truncated
      ? `<div class="small muted">${escapeHtml(t('jr_ai_truncated', { first: FIRST_N, last: LAST_N }))}</div><div class="divider"></div>`
      : '';

    container.innerHTML = `
      <div class="card pad">
        ${truncNoteHtml}
        <h3>${escapeHtml(t('jr_detected'))}: <span class="badge good">${escapeHtml(fmt)}</span></h3>
        <div style="overflow-x:auto;margin:0 -4px;">
          <table class="data-table" style="min-width:100%;white-space:nowrap;">
            <thead><tr><th style="padding-right:16px;">${escapeHtml(t('jr_column'))}</th>${headerCells}</tr></thead>
            <tbody>${bodyRows}</tbody>
          </table>
        </div>
        ${moreHtml}
        ${warningHtml ? `<div class="divider"></div>${warningHtml}` : ''}
        <div class="divider"></div>
        <button class="btn-primary" id="ai-jp-confirm">${escapeHtml(t('jr_confirm', { n: trades.length }))}</button>
        <div class="muted small"><a href="#" class="link" id="ai-jp-cancel">${escapeHtml(t('cancel'))}</a></div>
      </div>`;

    container.querySelector('#ai-jp-confirm').addEventListener('click', () => {
      onTradesConfirmed(lastResult.trades);
    });
    container.querySelector('#ai-jp-cancel').addEventListener('click', (e) => {
      e.preventDefault();
      showIdle();
    });
  }

  function showFallback(errorMsg) {
    container.innerHTML = `
      <div class="card pad">
        <div class="small bad">${escapeHtml(errorMsg)}</div>
        <div class="divider"></div>
        <div class="muted small">${escapeHtml(t('jr_manual_hint'))}</div>
        <textarea id="ai-jp-manual" class="select" rows="6"
          placeholder="date,pnl&#10;2024-01-01,150&#10;2024-01-02,-80"></textarea>
        <button class="btn-primary" id="ai-jp-submit">${escapeHtml(t('jr_submit_manual'))}</button>
        <div class="muted small"><a href="#" class="link" id="ai-jp-cancel">${escapeHtml(t('cancel'))}</a></div>
      </div>`;

    container.querySelector('#ai-jp-submit').addEventListener('click', () => {
      const text = container.querySelector('#ai-jp-manual').value.trim();
      if (text) processGenericText(text);
    });
    container.querySelector('#ai-jp-cancel').addEventListener('click', (e) => {
      e.preventDefault();
      showIdle();
    });
  }

  function showAIConsent(rawText) {
    container.innerHTML = `
      <div class="card pad" role="region" aria-labelledby="ai-jp-consent-title">
        <h3 id="ai-jp-consent-title">${escapeHtml(t('jr_ai_consent_title'))}</h3>
        <p class="muted small">${escapeHtml(t('jr_ai_consent_body', { n: CHAR_CAP }))}</p>
        <div class="row">
          <button class="btn-primary" id="ai-jp-consent">${escapeHtml(t('jr_ai_consent_continue'))}</button>
          <button class="btn-ghost" id="ai-jp-cancel">${escapeHtml(t('cancel'))}</button>
        </div>
      </div>`;

    container.querySelector('#ai-jp-consent').addEventListener('click', async () => {
      showLoading();
      await runAI(rawText);
    });
    container.querySelector('#ai-jp-cancel').addEventListener('click', showIdle);
  }

  // ── Async logic ──────────────────────────────────────────────────────────

  async function handleFile(f) {
    if (f.size > MAX_FILE_BYTES) {
      showFallback(t('jr_file_too_large'));
      return;
    }
    showLoading();
    let file;
    try {
      file = await readFile(f);
    } catch (err) {
      showFallback(`${t('jr_file_read_failed')}: ${err.message}`);
      return;
    }

    // 1) Deterministic MetaTrader 4/5 path — reads the WHOLE Positions table,
    //    no row limit, no AI guesswork, so the trade count is stable and correct.
    const rows = file.rows || rowsFromCsv(file.rawText);
    if (looksLikeMetaTrader(rows)) {
      const mt = parseMetaTrader(rows);
      console.log(`[journal] MetaTrader format detected: ${mt.error ? `parse failed (${mt.error})` : `${mt.trades.length} positions`}.`);
      if (!mt.error) { showMetaTrader(mt); return; }
      // Recognized but unparseable → fall through to the AI/CSV path below.
    }

    // 2) Generic path: deterministic local parsing first. Unknown layouts are
    // sent to AI only if the user explicitly accepts the privacy prompt.
    processGenericText(file.rawText);
  }

  // Render a MetaTrader parse result through the existing preview UI.
  function showMetaTrader(mt) {
    lastResult = {
      trades: mt.trades.map((tr) => ({
        date: tr.date,
        pnl: Number.isFinite(tr.pnl) ? tr.pnl : null,
        r_multiple: null,
        direction: tr.direction,
        symbol: tr.symbol,
        duration_minutes: null,
      })),
      detected_columns: { format: 'MetaTrader 4/5' },
      warnings: (mt.warnings || []).map(renderWarning),
    };
    showPreview(lastResult, false);
  }

  function processGenericText(rawText) {
    const parsed = parseCsv(rawText);
    if (!parsed.error && parsed.trades.length >= 5) {
      lastResult = {
        trades: parsed.trades.map((trade) => ({
          date: trade.date,
          pnl: trade.pnl,
          r_multiple: trade.r ?? null,
          direction: null,
          duration_minutes: null,
        })),
        detected_columns: { format: t('jr_local_format') },
        warnings: (parsed.warnings || []).map(renderWarning),
      };
      showPreview(lastResult, false);
      return;
    }
    showAIConsent(rawText);
  }

  // Warnings are {id, vars} (bilingual via i18n) or plain strings (AI path).
  function renderWarning(w) {
    return typeof w === 'string' ? w : t(`jr_warn_${w.id}`, w.vars);
  }

  function readFile(f) {
    return new Promise((resolve, reject) => {
      const name = f.name.toLowerCase();
      if (!['.csv', '.tsv', '.txt'].some((ext) => name.endsWith(ext))) {
        reject(new Error(t('jr_file_unsupported')));
        return;
      }
      const reader = new FileReader();
      reader.onload = (e) => resolve({ rawText: e.target.result, rows: null });
      reader.onerror = () => reject(new Error(t('jr_file_read_failed')));
      reader.readAsText(f);
    });
  }

  async function runAI(rawText) {
    try {
      const { text: aiText, truncated } = truncateForAI(rawText);
      const result = await callAI('parseJournal', { rawText: aiText });
      if (truncated) {
        result.warnings = result.warnings || [];
        result.warnings.push(t('jr_ai_subset_warning', { first: FIRST_N, last: LAST_N }));
      }

      lastResult = result;
      if (!result.trades || result.trades.length === 0) {
        showFallback(t('jr_no_trades'));
        return;
      }
      showPreview(result, truncated);
    } catch (err) {
      showFallback(err.message);
    }
  }

  // Initialise
  showIdle();
}
