// AI-powered journal parser.
// Accepts CSV / XLSX / TXT drops, sends raw text to the AI, shows a column
// preview for confirmation, and hands the normalized trade array to the caller.
//
// Uses ONLY existing CSS classes from styles.css — no new rules, no inline
// decorative styles. display toggling via element.style is kept to a minimum
// (same pattern used throughout app.js).

import * as XLSX from 'xlsx';
import { callAI } from '../services/aiClient.js';

// Fields the AI normalizes to; their display order.
const TRADE_FIELDS = ['date', 'pnl', 'r_multiple', 'direction', 'duration_minutes'];

// ── Smart truncation for AI token budget ────────────────────────────────────
// Keeps header + first FIRST_N data rows + last LAST_N data rows + hard char cap.
// The full rawText is never modified — truncation only affects the AI call.
const FIRST_N  = 50;
const LAST_N   = 20;
const CHAR_CAP = 8000;

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
      <div class="dropzone" id="ai-jp-drop">
        <div>Drop CSV, XLSX, or TXT file here</div>
        <div class="muted small">or click to choose &mdash; .csv, .xlsx, .txt</div>
        <input type="file" id="ai-jp-file" accept=".csv,.xlsx,.xls,.txt" hidden>
      </div>`;

    const drop = container.querySelector('#ai-jp-drop');
    const fileInput = container.querySelector('#ai-jp-file');

    drop.addEventListener('click', () => fileInput.click());
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
    container.innerHTML = `<div class="muted small">Processing&hellip;</div>`;
  }

  function showPreview(result, truncated = false) {
    const { trades, detected_columns, warnings } = result;
    const sample = trades.slice(0, 3);

    // Only show fields that have at least one non-null value in the first 3 rows.
    const activeFields = TRADE_FIELDS.filter(k => sample.some(t => t[k] != null));

    // Pivot table: column names as rows, sample trade values across columns.
    const sampleCount = Math.min(sample.length, 3);
    const headerCells = Array.from({ length: sampleCount }, (_, i) => `<th>Row ${i + 1}</th>`).join('');
    const bodyRows = activeFields.map(field => {
      const cells = sample.map(t => {
        const v = t[field];
        return `<td>${v != null ? String(v) : '<span class="muted">—</span>'}</td>`;
      }).join('');
      return `<tr><td><strong>${field}</strong></td>${cells}</tr>`;
    }).join('');

    const fmt = detected_columns?.format || 'Generic';
    const extraCount = trades.length - sampleCount;
    const moreHtml = extraCount > 0
      ? `<div class="muted small">&hellip; and ${extraCount} more trade${extraCount === 1 ? '' : 's'}</div>`
      : '';
    const warningHtml = (warnings || [])
      .map(w => `<div class="small bad">${w}</div>`)
      .join('');
    const truncNoteHtml = truncated
      ? `<div class="small muted">Large file: AI preview shows first ${FIRST_N} and last ${LAST_N} rows. All data will be used after confirmation.</div><div class="divider"></div>`
      : '';

    container.innerHTML = `
      <div class="card pad">
        ${truncNoteHtml}
        <h3>Detected: <span class="badge good">${fmt}</span></h3>
        <table class="data-table">
          <thead><tr><th>Column</th>${headerCells}</tr></thead>
          <tbody>${bodyRows}</tbody>
        </table>
        ${moreHtml}
        ${warningHtml ? `<div class="divider"></div>${warningHtml}` : ''}
        <div class="divider"></div>
        <button class="btn-primary" id="ai-jp-confirm">Confirm (${trades.length} trade${trades.length === 1 ? '' : 's'})</button>
        <div class="muted small"><a href="#" class="link" id="ai-jp-cancel">Cancel</a></div>
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
        <div class="small bad">${errorMsg}</div>
        <div class="divider"></div>
        <div class="muted small">AI service unavailable. Paste trades manually:</div>
        <textarea id="ai-jp-manual" class="select" rows="6"
          placeholder="date,pnl&#10;2024-01-01,150&#10;2024-01-02,-80"></textarea>
        <button class="btn-primary" id="ai-jp-submit">Submit manual data</button>
        <div class="muted small"><a href="#" class="link" id="ai-jp-cancel">Cancel</a></div>
      </div>`;

    container.querySelector('#ai-jp-submit').addEventListener('click', async () => {
      const text = container.querySelector('#ai-jp-manual').value.trim();
      if (text) { showLoading(); await runAI(text); }
    });
    container.querySelector('#ai-jp-cancel').addEventListener('click', (e) => {
      e.preventDefault();
      showIdle();
    });
  }

  // ── Async logic ──────────────────────────────────────────────────────────

  async function handleFile(f) {
    showLoading();
    let rawText;
    try {
      rawText = await readFile(f);
    } catch (err) {
      showFallback(`Could not read file: ${err.message}`);
      return;
    }
    await runAI(rawText);
  }

  function readFile(f) {
    return new Promise((resolve, reject) => {
      const name = f.name.toLowerCase();
      if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
        const reader = new FileReader();
        reader.onload = (e) => {
          try {
            const wb = XLSX.read(new Uint8Array(e.target.result), { type: 'array' });
            // Convert the first sheet to CSV; the AI parser handles the rest.
            resolve(XLSX.utils.sheet_to_csv(wb.Sheets[wb.SheetNames[0]]));
          } catch (err) { reject(err); }
        };
        reader.onerror = () => reject(new Error('FileReader failed'));
        reader.readAsArrayBuffer(f);
      } else {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target.result);
        reader.onerror = () => reject(new Error('FileReader failed'));
        reader.readAsText(f);
      }
    });
  }

  async function runAI(rawText) {
    try {
      const { text: aiText, truncated } = truncateForAI(rawText);
      const result = await callAI('parseJournal', { rawText: aiText });
      lastResult = result;
      if (!result.trades || result.trades.length === 0) {
        showFallback('No trades could be extracted from this file.');
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
