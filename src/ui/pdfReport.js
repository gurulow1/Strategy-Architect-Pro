// Structured PDF export for Strategy Architect Pro.
// 5 pages: (1) Executive Summary, (2) Monte Carlo Detail, (3) Diagnostics,
// (4) Edge Integrity (journal only), (5) Charts.
//
// Each page is composed as an off-screen DOM node captured with html2canvas.
// This keeps the export bilingual and fully offline (the browser has the fonts).

import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import { t, getLang } from './i18n.js';
import { tFinding } from './i18n.js';
import { fmtPct, fmtPctSigned, fmtNum, fmtValue } from './format.js';

const PX_W = 794;
const PX_H = 1123;

const C = {
  ink:        '#0f172a',
  muted:      '#64748b',
  faint:      '#94a3b8',
  line:       '#e2e8f0',
  rowEven:    '#f8fafc',
  rowOdd:     '#ffffff',
  cardBg:     '#f1f5f9',
  good:       '#15803d',
  goodBg:     '#dcfce7',
  warn:       '#b45309',
  warnBg:     '#fef3c7',
  bad:        '#b91c1c',
  badBg:      '#fee2e2',
  accent:     '#4f46e5',
  accentBg:   '#eef2ff',
  chartBg:    '#ffffff',
  headerBg:   '#0f172a',
  headerText: '#f8fafc',
};

const F = {
  xs: '9px', sm: '10px', base: '11px', md: '13px',
  lg: '16px', xl: '20px', xxl: '28px',
};

const MARGIN = '0 40px';
const CELL_PAD = '5px 10px';

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

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
  if (score >= 50) return C.good;
  if (score > 0) return C.warn;
  return C.bad;
}

// ── Shared layout components ──────────────────────────────────────────────────

function pageHeader(lang) {
  return `
    <div style="background:${C.headerBg};color:${C.headerText};
      height:36px;flex-shrink:0;display:flex;align-items:center;
      padding:0 40px;justify-content:space-between;">
      <span style="font-size:${F.sm};font-weight:700;letter-spacing:.08em;
        text-transform:uppercase;opacity:.9;">Strategy Architect Pro</span>
      <span style="font-size:${F.xs};opacity:.6;">${esc(t('brand'))} · ${esc(localizedDate(lang))}</span>
    </div>`;
}

function pageFooter(pageNum, total) {
  return `
    <div style="height:28px;flex-shrink:0;border-top:1px solid ${C.line};
      display:flex;align-items:center;padding:0 40px;justify-content:space-between;">
      <span style="font-size:${F.xs};color:${C.faint};">${esc(t('pdf_confidential'))}</span>
      <span style="font-size:${F.xs};color:${C.faint};">${esc(t('pdf_page'))} ${pageNum} / ${total}</span>
    </div>`;
}

function page(content, pageNum, totalPages, lang) {
  return `
    <div style="width:${PX_W}px;height:${PX_H}px;background:#fff;
      color:${C.ink};font-family:-apple-system,'Segoe UI',Arial,sans-serif;
      box-sizing:border-box;display:flex;flex-direction:column;overflow:hidden;">
      ${pageHeader(lang)}
      <div style="flex:1;overflow:hidden;">${content}</div>
      ${pageFooter(pageNum, totalPages)}
    </div>`;
}

function sectionTitle(text, sub = '') {
  return `
    <div style="padding:18px 40px 10px;border-bottom:2px solid ${C.accent};margin-bottom:14px;">
      <div style="font-size:${F.lg};font-weight:700;color:${C.ink};">${esc(text)}</div>
      ${sub ? `<div style="font-size:${F.sm};color:${C.muted};margin-top:2px;">${esc(sub)}</div>` : ''}
    </div>`;
}

function dataTable(headers, rows, { colWidths = null } = {}) {
  const colStyle = (i) => colWidths ? `width:${colWidths[i]};` : '';
  const head = headers.map((h, i) =>
    `<th style="${colStyle(i)}padding:${CELL_PAD};text-align:left;
      font-size:${F.xs};font-weight:700;color:${C.muted};text-transform:uppercase;
      letter-spacing:.05em;border-bottom:2px solid ${C.line};
      background:${C.cardBg};">${esc(h)}</th>`
  ).join('');
  const body = rows.map((cells, ri) => {
    const bg = ri % 2 === 0 ? C.rowOdd : C.rowEven;
    const tds = cells.map((cell, ci) => {
      const v = typeof cell === 'object' && cell !== null ? cell : { value: cell };
      const color = v.color || C.ink;
      const cellBg = v.bg || bg;
      const align = v.align || 'left';
      const weight = v.bold ? '700' : '400';
      return `<td style="${colStyle(ci)}padding:${CELL_PAD};font-size:${F.base};
        color:${color};background:${cellBg};text-align:${align};
        font-weight:${weight};border-bottom:1px solid ${C.line};">${esc(String(v.value ?? '—'))}</td>`;
    }).join('');
    return `<tr>${tds}</tr>`;
  }).join('');
  return `
    <table style="width:100%;border-collapse:collapse;border:1px solid ${C.line};
      border-radius:6px;overflow:hidden;">
      <thead><tr>${head}</tr></thead>
      <tbody>${body}</tbody>
    </table>`;
}

// ── Page 1 — Executive Summary ────────────────────────────────────────────────

function buildVerdictBlock(report) {
  const s = report.stats;
  const score = report.robustness?.score;
  const scoreDisp = Number.isFinite(score) ? score : '—';
  const vKey = s.expectancy <= 0 ? 'verdict_noedge'
    : (Number.isFinite(score) && score >= 50 ? 'verdict_viable' : 'verdict_marginal');
  const col = scoreColor(score);
  const st = report.status;
  const statusCol = { green: C.good, yellow: C.warn, red: C.bad }[st?.color] || C.muted;

  return `
    <div style="margin:0 40px 12px;display:flex;align-items:center;gap:24px;
      padding:18px 20px;background:${C.cardBg};border:1px solid ${C.line};border-radius:10px;">
      <div style="width:76px;height:76px;border-radius:50%;flex-shrink:0;
        background:${col};display:flex;flex-direction:column;align-items:center;
        justify-content:center;color:#fff;">
        <span style="font-size:24px;font-weight:800;line-height:1;">${esc(String(scoreDisp))}</span>
        <span style="font-size:9px;opacity:.85;">/100</span>
      </div>
      <div style="flex:1;">
        <div style="font-size:${F.xl};font-weight:800;color:${C.ink};margin-bottom:3px;">${esc(t(vKey))}</div>
        <div style="font-size:${F.sm};color:${C.muted};margin-bottom:6px;">
          ${esc(t('robustness_score'))}: ${esc(t(gradeKey[report.robustness?.grade] || 'grade_fragile'))}
        </div>
        <div style="font-size:${F.base};font-weight:600;color:${statusCol};">
          ● ${esc(t(st?.textKey || 'status_yellow'))}
        </div>
      </div>
      <div style="text-align:right;flex-shrink:0;">
        <div style="font-size:${F.xxl};font-weight:800;color:${C.accent};">${esc(String(s.count || '—'))}</div>
        <div style="font-size:${F.xs};color:${C.muted};">${esc(t('pdf_trades'))}</div>
        ${report.displayUnit === 'currency'
          ? `<div style="margin-top:5px;font-size:${F.xs};color:${C.warn};padding:2px 6px;
              background:${C.warnBg};border-radius:4px;">${esc(t('pdf_normalized_note'))}</div>`
          : ''}
      </div>
    </div>`;
}

function kpiRow(items) {
  const cards = items.map((it) => {
    // Color logic needs the raw number, not the formatted string: parseFloat on
    // "+6,627R" or "2.3%" yields NaN/garbage. Prefer an explicit rawValue.
    const raw = typeof it.rawValue === 'number'
      ? it.rawValue
      : parseFloat(String(it.value).replace(/[^0-9.eE+-]/g, ''));
    let vcol = C.ink;
    if (Number.isFinite(raw)) {
      if (it.good !== undefined && raw >= it.good) vcol = C.good;
      else if (it.bad !== undefined && raw <= it.bad) vcol = C.bad;
    }
    return `
      <div style="flex:1;padding:10px 14px;background:${C.cardBg};
        border:1px solid ${C.line};border-radius:8px;">
        <div style="font-size:${F.xs};color:${C.muted};text-transform:uppercase;
          letter-spacing:.05em;margin-bottom:3px;">${esc(it.label)}</div>
        <div style="font-size:${F.xl};font-weight:700;color:${vcol};margin-bottom:1px;">${esc(it.value)}</div>
        <div style="font-size:${F.xs};color:${C.faint};">${esc(it.sub || '')}</div>
      </div>`;
  }).join('');
  return `<div style="display:flex;gap:8px;margin:0 40px 8px;">${cards}</div>`;
}

function buildStatsTable(report) {
  const s = report.stats;
  const sim = report.sim;
  const k = report.kelly;
  const unit = report.displayUnit || 'R';
  const sym = report.currencySymbol || '$';
  const fv = (v) => fmtValue(v, unit, sym);
  const pf = s.profitFactor === Infinity ? '∞' : fmtNum(s.profitFactor);

  const rows = [
    ['Win Rate',              fmtPct(s.winRate, 1),        t('kpi_winrate')],
    ['Profit Factor',         pf,                           t('kpi_pf_sub')],
    [t('kpi_expectancy'),     fv(s.expectancy),             t(unit === 'currency' ? 'kpi_expectancy_sub_cur' : 'kpi_expectancy_sub')],
    ['Reward : Risk',         fmtNum(s.payoffRatio),        t('kpi_rr')],
    ['Gross Profit',          fv(s.grossProfit),            ''],
    ['Gross Loss',            fv(s.grossLoss),              ''],
    [t('kpi_kelly') + ' Full',  fmtPct(k.fStar, 2),        ''],
    [t('kpi_kelly') + ' Half',  fmtPct(k.fStar * 0.5, 2),  t('pdf_recommended')],
    [t('kpi_ruin'),           fmtPct(sim.riskOfRuin),       t('kpi_ruin_sub', { threshold: '50%' })],
    [t('kpi_pop'),            fmtPct(sim.probProfit, 0),    t('kpi_pop_sub')],
    [t('kpi_return') + ' P10', fmtPctSigned(sim.p10Return), t('pdf_worst_decile')],
    [t('kpi_return') + ' P90', fmtPctSigned(sim.p90Return), t('pdf_best_decile')],
    [t('kpi_dd'),             fmtPct(sim.medianDD),          t('kpi_dd_sub', { worst: fmtPct(sim.worstDD) })],
  ].map(([metric, value, note]) => [
    metric,
    { value, bold: true, align: 'right' },
    { value: note, color: C.faint },
  ]);

  return `
    <div style="margin:0 40px;">
      ${dataTable(
        [t('pdf_metric'), t('pdf_value'), t('pdf_note')],
        rows,
        { colWidths: ['50%', '25%', '25%'] }
      )}
    </div>`;
}

function buildPage1(report, lang, pageNum, totalPages) {
  const s = report.stats;
  const sim = report.sim;
  const unit = report.displayUnit || 'R';
  const sym = report.currencySymbol || '$';
  const fv = (v) => fmtValue(v, unit, sym);

  const content = `
    ${sectionTitle(t('pdf_executive_summary'), localizedDate(lang))}
    ${buildVerdictBlock(report)}
    ${kpiRow([
      { label: t('kpi_expectancy'), value: fv(s.expectancy), rawValue: s.expectancy,
        sub: t(unit === 'currency' ? 'kpi_expectancy_sub_cur' : 'kpi_expectancy_sub'), good: 0 },
      { label: t('kpi_pf'), value: s.profitFactor === Infinity ? '∞' : fmtNum(s.profitFactor),
        rawValue: s.profitFactor === Infinity ? 999 : s.profitFactor, sub: t('kpi_pf_sub'), good: 1.5 },
      { label: t('kpi_ruin'), value: fmtPct(sim.riskOfRuin), rawValue: sim.riskOfRuin,
        sub: t('kpi_ruin_sub', { threshold: '50%' }), bad: 0.05 },
    ])}
    ${kpiRow([
      { label: 'Win Rate', value: fmtPct(s.winRate, 1), rawValue: s.winRate,
        sub: `${s.count} ${t('pdf_trades')}` },
      { label: t('kpi_return'), value: fmtPctSigned(sim.meanReturn), rawValue: sim.meanReturn,
        sub: t('kpi_median_sub'), good: 0 },
      { label: t('kpi_pop'), value: fmtPct(sim.probProfit, 0), rawValue: sim.probProfit,
        sub: t('kpi_pop_sub'), good: 0.55 },
    ])}
    ${buildStatsTable(report)}`;

  return page(content, pageNum, totalPages, lang);
}

// ── Page 2 — Monte Carlo Simulation Detail ────────────────────────────────────

function buildPage2(report, lang, pageNum, totalPages) {
  const sim = report.sim;
  const spec = report.spec || {};

  const ruinRows = (sim.ruinProfile || []).map((r) => {
    const { color, bg } = r.probability > 0.1
      ? { color: C.bad, bg: C.badBg }
      : r.probability > 0.02
        ? { color: C.warn, bg: C.warnBg }
        : { color: C.good, bg: C.goodBg };
    return [
      t('kpi_ruin_sub', { threshold: fmtPct(r.threshold, 0) }),
      { value: fmtPct(r.probability), bold: true, align: 'right', color, bg },
    ];
  });

  const retRows = [
    [t('pdf_p10'),   { value: fmtPctSigned(sim.p10Return),  bold: true,  align: 'right', color: sim.p10Return < 0 ? C.bad : C.good }],
    [t('pdf_p25'),   { value: fmtPctSigned(sim.p25Return ?? sim.p10Return), align: 'right' }],
    ['Median',       { value: fmtPctSigned(sim.medianReturn), bold: true, align: 'right' }],
    [t('pdf_p75'),   { value: fmtPctSigned(sim.p75Return ?? sim.p90Return), align: 'right' }],
    [t('pdf_p90'),   { value: fmtPctSigned(sim.p90Return),  bold: true,  align: 'right', color: C.good }],
    ['Mean',         { value: fmtPctSigned(sim.meanReturn), bold: true,  align: 'right' }],
    [t('kpi_pop'),   { value: fmtPct(sim.probProfit, 0),    align: 'right' }],
  ];

  const specRows = [
    [t('in_capital'), '$' + (spec.capital || 0).toLocaleString('en-US')],
    [t('in_trades'),  String(spec.trades || 0)],
    [t('in_sims'),    (spec.sims || 0).toLocaleString('en-US')],
    [t('in_risk'),    fmtPct(spec.risk || 0, 2)],
    [t('in_cost'),    fmtPct(spec.costPerTrade || 0, 2)],
    [t('pdf_basis'),  report.displayUnit === 'currency' ? t('pdf_basis_pnl') : t('pdf_basis_r')],
  ];

  const content = `
    ${sectionTitle(t('pdf_simulation_detail'), t('pdf_simulation_sub', { sims: (spec.sims || 0).toLocaleString('en-US') }))}
    <div style="display:flex;gap:20px;margin:0 40px 16px;">
      <div style="flex:1.2;">
        <div style="font-size:${F.sm};font-weight:700;color:${C.muted};
          text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px;">
          ${esc(t('pdf_return_distribution'))}</div>
        ${dataTable([t('pdf_percentile'), t('pdf_return')], retRows, { colWidths: ['65%', '35%'] })}
      </div>
      <div style="flex:1;">
        <div style="font-size:${F.sm};font-weight:700;color:${C.muted};
          text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px;">
          ${esc(t('pdf_ruin_profile'))}</div>
        ${dataTable([t('pdf_threshold'), t('pdf_probability')], ruinRows, { colWidths: ['65%', '35%'] })}
        <div style="height:14px;"></div>
        <div style="font-size:${F.sm};font-weight:700;color:${C.muted};
          text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px;">
          ${esc(t('pdf_sim_spec'))}</div>
        ${dataTable(
          [t('pdf_parameter'), t('pdf_value')],
          specRows.map(([k, v]) => [k, { value: v, bold: true, align: 'right' }]),
          { colWidths: ['60%', '40%'] }
        )}
      </div>
    </div>`;

  return page(content, pageNum, totalPages, lang);
}

// ── Page 3 — Diagnostics ──────────────────────────────────────────────────────

function buildPage3(report, lang, pageNum, totalPages) {
  const f = report.findings;

  function column(titleKey, items, color, bg) {
    const lines = items.length
      ? items.map((it) => `
          <div style="padding:6px 10px;margin-bottom:4px;background:${bg};
            border-left:3px solid ${color};border-radius:0 4px 4px 0;
            font-size:${F.base};line-height:1.5;color:${C.ink};">${esc(tFinding(it))}</div>`)
        .join('')
      : `<div style="font-size:${F.sm};color:${C.faint};font-style:italic;
          padding:6px 0;">${esc(t('diag_none'))}</div>`;
    return `
      <div style="flex:1;min-width:0;">
        <div style="font-size:${F.sm};font-weight:700;color:${color};
          text-transform:uppercase;letter-spacing:.05em;
          margin-bottom:10px;padding-bottom:5px;border-bottom:2px solid ${color};">
          ${esc(t(titleKey))}</div>
        ${lines}
      </div>`;
  }

  const note = report.displayUnit === 'currency'
    ? `<div style="margin:12px 40px 0;padding:10px 14px;border-radius:6px;
        background:${C.warnBg};border:1px solid ${C.warn};
        font-size:${F.sm};color:${C.warn};">${esc(t('notice_currency_normalized'))}</div>`
    : '';

  const content = `
    ${sectionTitle(t('diag_title'))}
    <div style="display:flex;gap:14px;margin:0 40px;">
      ${column('diag_strengths', f.strengths, C.good, C.goodBg)}
      ${column('diag_weaknesses', f.weaknesses, C.bad, C.badBg)}
    </div>
    <div style="display:flex;gap:14px;margin:14px 40px 0;">
      ${column('diag_risks', f.risks, C.warn, C.warnBg)}
      ${column('diag_actions', f.actions, C.accent, C.accentBg)}
    </div>
    ${note}`;

  return page(content, pageNum, totalPages, lang);
}

// ── Page 4 — Edge Integrity (journal only) ────────────────────────────────────

function buildPage4(report, lang, pageNum, totalPages) {
  const unit = report.displayUnit || 'R';
  const sym = report.currencySymbol || '$';
  const sl = report.skillLuck;
  const tp = report.temporal;
  const bs = report.blindspots;
  const ps = report.psychology;
  const sections = [];

  if (sl && sl.verdict !== 'insufficient_data') {
    const vmap = {
      strong:   [t('ei_verdict_strong'),   C.good, C.goodBg],
      probable: [t('ei_verdict_probable'), C.warn, C.warnBg],
      weak:     [t('ei_verdict_weak'),     C.warn, C.warnBg],
      unclear:  [t('ei_verdict_unclear'),  C.bad,  C.badBg],
    };
    const [vLabel, vcol, vbg] = vmap[sl.verdict] || vmap.unclear;
    const extraRow = sl.extraLossesToBreakeven > 0
      ? [[t('ei_fragility', { n: '' }).replace(':', ''), { value: sl.extraLossesToBreakeven, align: 'right' }]]
      : [];
    sections.push(`
      <div style="margin-bottom:18px;">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">
          <div style="font-size:${F.md};font-weight:700;">${esc(t('ei_skill_title'))}</div>
          <span style="font-size:${F.xs};font-weight:700;color:${vcol};
            background:${vbg};padding:3px 10px;border-radius:20px;">${esc(vLabel)}</span>
        </div>
        ${dataTable(
          [t('pdf_metric'), t('pdf_value')],
          [
            [t('ei_conf', { p: '' }).replace(':', '').trim(), { value: fmtPct(sl.expectancyCI.pAboveZero, 0), bold: true, align: 'right' }],
            ['p-value vs 50/50', { value: fmtNum(sl.pValueVsCoin, 3), bold: true, align: 'right',
              color: sl.pValueVsCoin < 0.05 ? C.good : C.ink }],
            ...extraRow,
          ],
          { colWidths: ['70%', '30%'] }
        )}
      </div>`);
  }

  if (tp && tp.available) {
    const banner = tp.degrading
      ? `<div style="font-size:${F.sm};color:${C.bad};font-weight:700;
          background:${C.badBg};padding:5px 10px;border-radius:4px;margin-bottom:8px;">
          ⚠ ${esc(t('ei_degrading'))}</div>`
      : '';
    sections.push(`
      <div style="margin-bottom:18px;">
        <div style="font-size:${F.md};font-weight:700;margin-bottom:10px;">${esc(t('ei_time_title'))}</div>
        ${banner}
        ${dataTable(
          ['', t('ei_early'), t('ei_recent')],
          [
            [t('ei_col_wr'),
              { value: fmtPct(tp.earlyStats.winRate, 0),  align: 'right' },
              { value: fmtPct(tp.recentStats.winRate, 0), align: 'right', bold: true }],
            [t('ei_col_exp'),
              { value: fmtValue(tp.earlyStats.expectancy, unit, sym),  align: 'right' },
              { value: fmtValue(tp.recentStats.expectancy, unit, sym), align: 'right', bold: true }],
            [t('ei_col_pf'),
              { value: tp.earlyStats.profitFactor === Infinity  ? '∞' : fmtNum(tp.earlyStats.profitFactor),  align: 'right' },
              { value: tp.recentStats.profitFactor === Infinity ? '∞' : fmtNum(tp.recentStats.profitFactor), align: 'right', bold: true }],
          ],
          { colWidths: ['34%', '33%', '33%'] }
        )}
      </div>`);
  }

  if (bs) {
    const bsRows = [];
    if (bs.direction?.available && bs.direction.losingDirection) {
      bsRows.push([t('ei_dir_title'), t('ei_dir_losing', { dir: t(`dir_${bs.direction.losingDirection}`) })]);
    }
    if (bs.dayOfWeek?.available && bs.dayOfWeek.toxicDay) {
      bsRows.push([t('ei_dow_title'),
        `${t(`dow_${bs.dayOfWeek.worstDay.dayIndex}`)} — ${fmtValue(bs.dayOfWeek.worstDay.stats.expectancy, unit, sym)}`]);
    }
    if (bs.instrument?.hiddenLosers?.length) {
      bsRows.push([t('ei_blind_title'), bs.instrument.hiddenLosers.map((s) => s.symbol).join(', ')]);
    }
    if (bsRows.length) {
      sections.push(`
        <div style="margin-bottom:18px;">
          <div style="font-size:${F.md};font-weight:700;margin-bottom:10px;">${esc(t('ei_blind_title'))}</div>
          ${dataTable([t('pdf_category'), t('pdf_finding')], bsRows)}
        </div>`);
    }
  }

  if (ps?.stopSignal?.triggered) {
    const sg = ps.stopSignal;
    sections.push(`
      <div style="margin-bottom:14px;padding:10px 14px;background:${C.badBg};border:1px solid ${C.bad};
        border-radius:6px;font-size:${F.sm};color:${C.bad};">
        ⚠ ${esc(t('psych_stop_signal', { n: sg.after, baseWR: fmtPct(sg.baseWR, 0), nextWR: fmtPct(sg.nextWR, 0) }))}
      </div>`);
  }

  // After-loss behavior carries intel even without a hard stop signal — show the
  // win-rate-after-N-losses table whenever there's a meaningful sample.
  if (ps && ps.afterLoss && ps.afterLoss.some((r) => r.sampleSize >= 5)) {
    const lossRows = ps.afterLoss
      .filter((r) => r.sampleSize >= 5)
      .map((r) => [
        t('psych_after_n', { n: r.after }),
        { value: fmtPct(r.nextWR, 0), bold: true, align: 'right' },
        { value: String(r.sampleSize), align: 'right', color: C.muted },
      ]);
    sections.push(`
      <div style="margin-bottom:14px;">
        <div style="font-size:${F.md};font-weight:700;margin-bottom:8px;">${esc(t('psych_loss_title'))}</div>
        ${dataTable(
          [t('psych_col_after'), t('kpi_winrate'), t('psych_col_n')],
          lossRows,
          { colWidths: ['50%', '30%', '20%'] }
        )}
      </div>`);
  }

  if (!sections.length) return null;

  const content = `
    ${sectionTitle(t('ei_title'), t('pdf_journal_only'))}
    <div style="margin:0 40px;">${sections.join('')}</div>`;

  return page(content, pageNum, totalPages, lang);
}

// ── Page 5 — Charts ───────────────────────────────────────────────────────────

function chartBox(id, label, height = 280) {
  const canvas = document.getElementById(id);
  let src = null;
  try { if (canvas) src = canvas.toDataURL('image/jpeg', 0.88); } catch (_) { src = null; }
  return `
    <div style="margin-bottom:14px;">
      <div style="font-size:${F.sm};font-weight:700;color:${C.muted};
        text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px;">${esc(label)}</div>
      ${src
        ? `<img src="${src}" style="width:100%;height:${height}px;object-fit:contain;
            border:1px solid ${C.line};border-radius:6px;background:${C.chartBg};">`
        : `<div style="height:${height}px;border:1px solid ${C.line};border-radius:6px;
            display:flex;align-items:center;justify-content:center;
            color:${C.faint};font-size:${F.sm};">Chart not available</div>`}
    </div>`;
}

function buildPageCharts(report, lang, pageNum, totalPages) {
  const spec = report.spec || {};
  const simNote = `${t('in_capital')}: $${(spec.capital || 0).toLocaleString('en-US')} · `
    + `${t('in_trades')}: ${spec.trades} · ${t('in_sims')}: ${(spec.sims || 0).toLocaleString('en-US')} · `
    + `${t('in_risk')}: ${fmtPct(spec.risk || 0, 2)}`;

  const content = `
    ${sectionTitle(t('pdf_charts_title'))}
    <div style="margin:0 40px;">
      ${chartBox('c-equity', t('chart_equity'), 310)}
      <div style="display:flex;gap:14px;">
        <div style="flex:1;">${chartBox('c-dist', t('chart_dist'), 195)}</div>
        <div style="flex:1;">${chartBox('c-dd',   t('chart_dd'),   195)}</div>
      </div>
      <div style="font-size:${F.xs};color:${C.faint};margin-top:6px;">${esc(simNote)}</div>
    </div>`;

  return page(content, pageNum, totalPages, lang);
}

// ── Document assembly ─────────────────────────────────────────────────────────

function buildDocument(report, lang) {
  const root = document.createElement('div');
  root.style.cssText = 'position:fixed;left:-99999px;top:0;z-index:-1;';

  // Include psychology (afterLoss intel) even without a hard stop signal.
  const hasEdge = !!(report.skillLuck || report.temporal
    || (report.blindspots && Object.values(report.blindspots).some((b) => b?.available))
    || report.psychology);

  // Assemble the builder list first so the real page count is known before any
  // page is stamped — otherwise a null page 4 would leave footers reading "/5".
  const builders = [
    (n, total) => buildPage1(report, lang, n, total),
    (n, total) => buildPage2(report, lang, n, total),
    (n, total) => buildPage3(report, lang, n, total),
  ];
  if (hasEdge && buildPage4(report, lang, 1, 5)) {
    builders.push((n, total) => buildPage4(report, lang, n, total));
  }
  builders.push((n, total) => buildPageCharts(report, lang, n, total));

  const totalPages = builders.length;
  const pagesList = builders.map((fn, i) => fn(i + 1, totalPages));

  root.innerHTML = pagesList.map((html) => `<div class="pdf-page">${html}</div>`).join('');
  return root;
}

export async function generatePDF(report) {
  const lang = getLang();
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  const root = buildDocument(report, lang);
  document.body.appendChild(root);

  try {
    const pageEls = [...root.querySelectorAll('.pdf-page')];
    for (let i = 0; i < pageEls.length; i++) {
      let imgData = null;
      try {
        const canvas = await html2canvas(pageEls[i], {
          scale: 1.5, backgroundColor: '#ffffff', logging: false, useCORS: true,
        });
        imgData = canvas.toDataURL('image/jpeg', 0.88);
      } catch (_) { imgData = null; }
      if (i > 0) pdf.addPage();
      if (imgData) pdf.addImage(imgData, 'JPEG', 0, 0, 210, 297);
      else { pdf.setFontSize(10); pdf.text('Page unavailable', 20, 20); }
    }
    pdf.save(`strategy-report-${new Date().toISOString().slice(0, 10)}.pdf`);
  } finally {
    root.remove();
  }
}
