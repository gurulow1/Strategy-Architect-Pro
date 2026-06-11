// Structured PDF export for Strategy Architect Pro.
// Pages: (1) header + verdict + KPIs, (2) diagnostics,
// (3) edge integrity + psychology (only if present), (4) equity + drawdown charts.
//
// Implementation note: rather than laying text out with jsPDF's built-in
// Helvetica — which cannot render Cyrillic, leaving Russian reports as tofu —
// each page is composed as a print-styled, off-screen DOM node and captured with
// html2canvas. This keeps the export bilingual and fully offline (the browser
// already has the fonts), and guarantees the numbers match what's on screen.

import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import { t, getLang } from './i18n.js';
import { tFinding } from './i18n.js';
import { fmtPct, fmtPctSigned, fmtNum, fmtValue, fmtMoney } from './format.js';

// A4 at 96dpi, in CSS pixels (210mm × 297mm).
const PX_W = 794;
const PX_H = 1123;

const C = {
  ink: '#1a1a2e', muted: '#6b7280', line: '#e5e7eb', cardBg: '#f8f9fb',
  green: '#16a34a', orange: '#d97706', red: '#dc2626', blue: '#2563eb',
  chartBg: '#0d0d1a',
};

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function localizedDate(lang) {
  try {
    return new Date().toLocaleDateString(lang === 'ru' ? 'ru-RU' : 'en-US',
      { day: 'numeric', month: 'long', year: 'numeric' });
  } catch (_) {
    return new Date().toISOString().slice(0, 10);
  }
}

const gradeKey = { robust: 'grade_robust', moderate: 'grade_moderate', thin: 'grade_thin', fragile: 'grade_fragile' };

function scoreColor(score) {
  if (!Number.isFinite(score)) return C.muted;
  if (score >= 50) return C.green;
  if (score > 0) return C.orange;
  return C.red;
}

// ── Page builders (return HTML strings) ──────────────────────────────────────
function kpiCard(label, value, sub, color = C.ink) {
  return `
    <div style="flex:1;min-width:0;background:${C.cardBg};border:1px solid ${C.line};
      border-radius:10px;padding:14px 16px;">
      <div style="font-size:11px;color:${C.muted};text-transform:uppercase;letter-spacing:.04em;">${esc(label)}</div>
      <div style="font-size:22px;font-weight:700;color:${color};margin:6px 0 2px;">${esc(value)}</div>
      <div style="font-size:10px;color:${C.muted};">${esc(sub)}</div>
    </div>`;
}

function buildPage1(report, lang) {
  const s = report.stats;
  const sim = report.sim;
  const k = report.kelly;
  const unit = report.displayUnit || 'R';
  const sym = report.currencySymbol || '$';
  const score = report.robustness?.score;
  const scoreDisp = Number.isFinite(score) ? score : 'N/A';
  const e = s.expectancy;
  const vKey = e <= 0 ? 'verdict_noedge' : (Number.isFinite(score) && score >= 50 ? 'verdict_viable' : 'verdict_marginal');
  const col = scoreColor(score);
  const pf = s.profitFactor === Infinity ? '∞' : fmtNum(s.profitFactor);

  return `
    <div style="background:${C.ink};color:#fff;height:64px;display:flex;align-items:center;
      justify-content:space-between;padding:0 40px;">
      <div style="font-size:20px;font-weight:700;letter-spacing:-.01em;">${esc(t('brand'))} ${esc(t('brand_pro'))}</div>
      <div style="font-size:13px;opacity:.8;">${esc(localizedDate(lang))}</div>
    </div>

    <div style="padding:32px 40px;">
      <div style="display:flex;align-items:center;gap:20px;border:1px solid ${C.line};
        border-radius:14px;padding:20px 24px;margin-bottom:28px;">
        <div style="width:84px;height:84px;border-radius:50%;flex-shrink:0;
          background:${col};color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;">
          <span style="font-size:28px;font-weight:800;line-height:1;">${esc(scoreDisp)}</span>
          <span style="font-size:11px;opacity:.85;">/100</span>
        </div>
        <div>
          <div style="font-size:22px;font-weight:700;color:${C.ink};">${esc(t(vKey))}</div>
          <div style="font-size:14px;color:${C.muted};margin-top:4px;">
            ${esc(t('robustness_score'))}: ${esc(t(gradeKey[report.robustness?.grade] || 'grade_fragile'))}</div>
        </div>
      </div>

      <div style="display:flex;gap:14px;margin-bottom:14px;">
        ${kpiCard(t('kpi_expectancy'), fmtValue(s.expectancy, unit, sym), t(unit === 'currency' ? 'kpi_expectancy_sub_cur' : 'kpi_expectancy_sub'), e > 0 ? C.green : C.red)}
        ${kpiCard(t('kpi_pf'), pf, t('kpi_pf_sub'))}
        ${kpiCard(t('kpi_ruin'), fmtPct(sim.riskOfRuin), t('kpi_ruin_sub', { threshold: '50%' }), sim.riskOfRuin > 0.05 ? C.red : C.green)}
      </div>
      <div style="display:flex;gap:14px;">
        ${kpiCard(t('kpi_return'), fmtPctSigned(sim.meanReturn), t('kpi_median_sub'), sim.meanReturn >= 0 ? C.green : C.red)}
        ${kpiCard(t('kpi_pop'), fmtPct(sim.probProfit, 0), t('kpi_pop_sub'), sim.probProfit >= 0.5 ? C.green : C.orange)}
        ${kpiCard(t('kpi_kelly'), k.profitable ? fmtPct(k.fStar, 1) : 'N/A', k.profitable ? t('kpi_kelly_sub', { mode: k.modeLabel, rec: fmtPct(k.recommended, 2) }) : t('verdict_noedge'))}
      </div>
    </div>`;
}

function findingColumn(title, items, color) {
  const body = items.length
    ? items.map((it) => `<li style="margin:0 0 8px;font-size:12px;line-height:1.45;color:${C.ink};">• ${esc(tFinding(it))}</li>`).join('')
    : `<li style="font-size:12px;color:${C.muted};font-style:italic;">${esc(t('diag_none'))}</li>`;
  return `
    <div style="flex:1;min-width:0;">
      <div style="font-size:14px;font-weight:700;color:${color};margin-bottom:10px;
        padding-bottom:6px;border-bottom:2px solid ${color};">${esc(title)}</div>
      <ul style="list-style:none;margin:0;padding:0;">${body}</ul>
    </div>`;
}

function buildPage2(report) {
  const f = report.findings;
  const note = report.displayUnit === 'currency'
    ? `<div style="margin-top:24px;padding:12px 16px;border-radius:10px;background:#fef9c3;
        border:1px solid #fde047;font-size:12px;color:#854d0e;">${esc(t('notice_currency_normalized'))}</div>`
    : '';
  return `
    <div style="padding:40px;">
      <div style="font-size:20px;font-weight:700;color:${C.ink};margin-bottom:24px;">${esc(t('diag_title'))}</div>
      <div style="display:flex;gap:20px;">
        ${findingColumn(t('diag_strengths'), f.strengths, C.green)}
        ${findingColumn(t('diag_weaknesses'), f.weaknesses, C.red)}
      </div>
      <div style="display:flex;gap:20px;margin-top:28px;">
        ${findingColumn(t('diag_risks'), f.risks, C.orange)}
        ${findingColumn(t('diag_actions'), f.actions, C.blue)}
      </div>
      ${note}
    </div>`;
}

function buildPage3(report) {
  const unit = report.displayUnit || 'R';
  const sym = report.currencySymbol || '$';
  const sl = report.skillLuck;
  const tp = report.temporal;
  const bs = report.blindspots;
  const ps = report.psychology;
  const blocks = [];

  if (sl) {
    const vmap = {
      strong: ['ei_verdict_strong', C.green], probable: ['ei_verdict_probable', C.orange],
      weak: ['ei_verdict_weak', C.orange], unclear: ['ei_verdict_unclear', C.red],
      insufficient_data: ['ei_verdict_insufficient', C.muted],
    };
    const [vk, vc] = vmap[sl.verdict] || vmap.unclear;
    const detail = sl.verdict === 'insufficient_data'
      ? `<div style="font-size:12px;color:${C.muted};">${esc(t('ei_insufficient', { n: sl.sampleSize }))}</div>`
      : `<div style="font-size:12px;color:${C.ink};margin:2px 0;">${esc(t('ei_conf', { p: fmtPct(sl.expectancyCI.pAboveZero, 0) }))}</div>
         <div style="font-size:12px;color:${C.ink};margin:2px 0;">${esc(t('ei_pvalue', { p: fmtNum(sl.pValueVsCoin, 3) }))}</div>`;
    blocks.push(`
      <div style="flex:1;min-width:0;background:${C.cardBg};border:1px solid ${C.line};border-radius:10px;padding:16px;">
        <div style="font-size:14px;font-weight:700;color:${C.ink};margin-bottom:8px;">${esc(t('ei_skill_title'))}</div>
        <div style="display:inline-block;font-size:11px;font-weight:700;color:#fff;background:${vc};
          padding:3px 10px;border-radius:20px;margin-bottom:8px;">${esc(t(vk))}</div>
        ${detail}
      </div>`);
  }

  if (tp && tp.available) {
    const banner = tp.degrading
      ? `<div style="font-size:11px;color:#fff;background:${C.red};padding:4px 8px;border-radius:6px;margin-bottom:8px;">${esc(t('ei_degrading'))}</div>`
      : '';
    const row = (label, a, b, fmt) =>
      `<tr><td style="padding:3px 6px;color:${C.muted};">${esc(label)}</td>
        <td style="padding:3px 6px;text-align:right;">${esc(fmt(a))}</td>
        <td style="padding:3px 6px;text-align:right;">${esc(fmt(b))}</td></tr>`;
    blocks.push(`
      <div style="flex:1;min-width:0;background:${C.cardBg};border:1px solid ${C.line};border-radius:10px;padding:16px;">
        <div style="font-size:14px;font-weight:700;color:${C.ink};margin-bottom:8px;">${esc(t('ei_time_title'))}</div>
        ${banner}
        <table style="width:100%;border-collapse:collapse;font-size:12px;">
          <thead><tr><th></th>
            <th style="text-align:right;color:${C.muted};font-weight:600;">${esc(t('ei_early'))}</th>
            <th style="text-align:right;color:${C.muted};font-weight:600;">${esc(t('ei_recent'))}</th></tr></thead>
          <tbody>
            ${row(t('ei_col_wr'), tp.earlyStats.winRate, tp.recentStats.winRate, (v) => fmtPct(v, 0))}
            ${row(t('ei_col_exp'), tp.earlyStats.expectancy, tp.recentStats.expectancy, (v) => fmtValue(v, unit, sym))}
            ${row(t('ei_col_pf'), tp.earlyStats.profitFactor, tp.recentStats.profitFactor, (v) => (v === Infinity ? '∞' : fmtNum(v)))}
          </tbody>
        </table>
      </div>`);
  }

  // Blind spots — direction + worst day (instrument table is too wide for PDF).
  const blindLines = [];
  if (bs?.direction?.available && bs.direction.losingDirection) {
    blindLines.push(t('ei_dir_losing', { dir: t(`dir_${bs.direction.losingDirection}`) }));
  }
  if (bs?.dayOfWeek?.available && bs.dayOfWeek.toxicDay) {
    blindLines.push(t('find.avoid_day', { day: t(`dow_${bs.dayOfWeek.worstDay.dayIndex}`) }));
  }
  const blindBlock = blindLines.length
    ? `<div style="margin-top:18px;background:${C.cardBg};border:1px solid ${C.line};border-radius:10px;padding:16px;">
        <div style="font-size:14px;font-weight:700;color:${C.ink};margin-bottom:8px;">${esc(t('ei_blind_title'))}</div>
        ${blindLines.map((l) => `<div style="font-size:12px;color:${C.ink};margin:3px 0;">• ${esc(l)}</div>`).join('')}
       </div>`
    : '';

  // Psychology — stop signal + after-loss summary.
  let psychBlock = '';
  if (ps) {
    const lines = [];
    if (ps.stopSignal?.triggered) {
      lines.push(`<div style="font-size:12px;color:#fff;background:${C.red};padding:6px 10px;border-radius:6px;margin-bottom:8px;">⚠ ${esc(t('psych_stop_signal', { n: ps.stopSignal.after, baseWR: fmtPct(ps.stopSignal.baseWR, 0), nextWR: fmtPct(ps.stopSignal.nextWR, 0) }))}</div>`);
    }
    for (const row of ps.afterLoss.filter((r) => r.sampleSize >= 5)) {
      lines.push(`<div style="font-size:12px;color:${C.ink};margin:3px 0;">${esc(t('psych_after_n', { n: row.after }))}: ${esc(fmtPct(row.nextWR, 0))} <span style="color:${C.muted};">(${row.sampleSize})</span></div>`);
    }
    if (lines.length) {
      psychBlock = `<div style="margin-top:18px;background:${C.cardBg};border:1px solid ${C.line};border-radius:10px;padding:16px;">
        <div style="font-size:14px;font-weight:700;color:${C.ink};margin-bottom:8px;">${esc(t('psych_title'))}</div>
        ${lines.join('')}</div>`;
    }
  }

  return `
    <div style="padding:40px;">
      <div style="font-size:20px;font-weight:700;color:${C.ink};margin-bottom:24px;">${esc(t('ei_title'))}</div>
      <div style="display:flex;gap:20px;">${blocks.join('')}</div>
      ${blindBlock}
      ${psychBlock}
    </div>`;
}

function chartImgTag(id, label) {
  const canvas = document.getElementById(id);
  let src = null;
  // JPEG @ 90% keeps chart screenshots a fraction of the PNG size with no visible
  // loss — the difference between a 20 MB and a ~3 MB report.
  try { if (canvas && canvas.toDataURL) src = canvas.toDataURL('image/jpeg', 0.90); } catch (_) { src = null; }
  const inner = src
    ? `<img src="${src}" style="width:100%;display:block;" alt="${esc(label)}">`
    : `<div style="height:200px;display:flex;align-items:center;justify-content:center;color:#9ca3af;font-size:13px;">Chart unavailable</div>`;
  return `
    <div style="background:${C.chartBg};border-radius:12px;padding:16px;margin-bottom:18px;">
      <div style="font-size:13px;font-weight:600;color:#cbd5e1;margin-bottom:10px;">${esc(label)}</div>
      ${inner}
    </div>`;
}

function buildPage4(report) {
  const spec = report.spec || {};
  const simNote = t('pdf_sim_note', {
    capital: fmtMoney(spec.capital),
    trades: spec.trades,
    sims: (spec.sims || 0).toLocaleString(),
    risk: fmtPct(spec.risk, 1),
  });
  const basisNote = report.displayUnit === 'currency'
    ? ` · ${t('notice_currency_normalized')}` : '';
  return `
    <div style="padding:40px;">
      <div style="font-size:20px;font-weight:700;color:${C.ink};margin-bottom:24px;">${esc(t('chart_equity'))} · ${esc(t('chart_dd'))}</div>
      ${chartImgTag('c-equity', t('chart_equity'))}
      ${chartImgTag('c-dd', t('chart_dd'))}
      <div style="font-size:11px;color:${C.muted};margin-top:8px;">${esc(simNote + basisNote)}</div>
    </div>`;
}

function buildDocument(report, lang) {
  const root = document.createElement('div');
  root.style.cssText = 'position:fixed;left:-99999px;top:0;z-index:-1;';

  // Only emit the Edge Integrity page when it would actually carry content —
  // Quick Check has no per-trade records, leaving the page near-empty otherwise.
  const hasEdge = report.skillLuck || report.temporal || report.psychology
    || (report.blindspots && (
      report.blindspots.direction?.available
      || report.blindspots.instrument?.available
      || report.blindspots.dayOfWeek?.available
    ));
  const pagesHtml = [buildPage1(report, lang), buildPage2(report)];
  if (hasEdge) pagesHtml.push(buildPage3(report));
  pagesHtml.push(buildPage4(report));

  root.innerHTML = pagesHtml.map((html) => `
    <div class="pdf-page" style="width:${PX_W}px;height:${PX_H}px;background:#fff;
      color:${C.ink};font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;
      overflow:hidden;box-sizing:border-box;">${html}</div>`).join('');
  return root;
}

export async function generatePDF(report) {
  const lang = getLang();
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  const root = buildDocument(report, lang);
  document.body.appendChild(root);

  try {
    const pages = [...root.querySelectorAll('.pdf-page')];
    for (let i = 0; i < pages.length; i++) {
      let imgData = null;
      try {
        const canvas = await html2canvas(pages[i], {
          scale: 1.5, backgroundColor: '#ffffff', logging: false, useCORS: true,
        });
        imgData = canvas.toDataURL('image/jpeg', 0.90);
      } catch (err) {
        // Never let one bad page abort the whole export.
        imgData = null;
      }
      if (i > 0) pdf.addPage();
      if (imgData) {
        pdf.addImage(imgData, 'JPEG', 0, 0, 210, 297);
      } else {
        pdf.setFontSize(12);
        pdf.text('Page unavailable', 20, 20);
      }
    }
    pdf.save(`strategy-report-${new Date().toISOString().slice(0, 10)}.pdf`);
  } finally {
    root.remove();
  }
}
