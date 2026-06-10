// Shared results renderer: verdict → KPIs → diagnosis → charts.
// Used by Quick Check and Journal Analysis. Presentation only.

import { t, tFinding } from './i18n.js';
import { fmtR, fmtPct, fmtPctSigned, fmtNum, fmtValue, fmtPct as pct } from './format.js';
import {
  renderEquity, renderHistogram, renderDrawdownHist, renderStreaks, renderRuinProfile,
  renderRollingLine,
} from './charts.js';
import { diagnostics } from '../engine/diagnostics.js';
import { createAISummaryCard, createAIWeaknessPanel } from './aiComponents.js';

function verdict(report) {
  const e = report.stats.expectancy;
  const score = report.robustness.score;
  if (e <= 0) return { key: 'verdict_noedge', cls: 'bad' };
  if (score >= 50) return { key: 'verdict_viable', cls: 'good' };
  return { key: 'verdict_marginal', cls: 'warn' };
}

function kpi(label, value, sub, cls = '', id = '', tip = '') {
  const idAttr = id ? ` id="${id}"` : '';
  // Escape the tooltip for safe use inside an HTML attribute.
  const tipEsc = tip ? tip.replace(/"/g, '&quot;') : '';
  const tipHtml = tip ? ` <span class="kpi-tip" tabindex="0" role="img" aria-label="${tipEsc}" title="${tipEsc}">?</span>` : '';
  return `<div class="kpi card"${idAttr}><div class="kpi-label">${label}${tipHtml}</div>
    <div class="kpi-num ${cls}"><span class="kpi-slot">${value}</span></div>
    <div class="kpi-sub">${sub}</div></div>`;
}

// Wire dynamic accent: whole UI shifts color based on strategy health.
function setDynamicAccent(profitFactor) {
  const root = document.documentElement;
  const dark = root.classList.contains('dark');
  let accent, accentHover, accentSubtle;
  if (profitFactor >= 2.0) {
    accent = '#22c55e'; accentHover = '#16a34a'; accentSubtle = 'rgba(34,197,94,0.12)';
  } else if (profitFactor >= 1.0) {
    accent = dark ? '#6366f1' : '#4f46e5';
    accentHover = dark ? '#818cf8' : '#4338ca';
    accentSubtle = dark ? 'rgba(99,102,241,0.12)' : 'rgba(79,70,229,0.08)';
  } else if (profitFactor >= 0) {
    accent = '#ef4444'; accentHover = '#dc2626'; accentSubtle = 'rgba(239,68,68,0.12)';
  } else {
    accent = '#7f1d1d'; accentHover = '#991b1b'; accentSubtle = 'rgba(127,29,29,0.15)';
  }
  root.style.setProperty('--accent', accent);
  root.style.setProperty('--accent-hover', accentHover);
  root.style.setProperty('--accent-subtle', accentSubtle);
}

function findingList(items) {
  if (!items.length) return `<li class="muted">${t('diag_none')}</li>`;
  return items.map((it) => `<li>${tFinding(it)}</li>`).join('');
}

const gradeKey = { robust: 'grade_robust', moderate: 'grade_moderate', thin: 'grade_thin', fragile: 'grade_fragile' };

// ── Edge Integrity (journal only) ─────────────────────────────────────────────
const verdictMeta = {
  strong:            { key: 'ei_verdict_strong',       cls: 'good' },
  probable:          { key: 'ei_verdict_probable',     cls: 'warn' },
  weak:              { key: 'ei_verdict_weak',         cls: 'warn' },
  unclear:           { key: 'ei_verdict_unclear',      cls: 'bad' },
  insufficient_data: { key: 'ei_verdict_insufficient', cls: 'muted' },
};
const dayLabel = (idx) => t(`dow_${idx}`);
const dirLabel = (d) => t(`dir_${d}`);

function eiSkillCard(sl) {
  const meta = verdictMeta[sl.verdict] || verdictMeta.unclear;
  const lines = [];
  if (sl.verdict === 'insufficient_data') {
    lines.push(`<div class="muted small">${t('ei_insufficient', { n: sl.sampleSize })}</div>`);
  } else {
    lines.push(`<div class="ei-line">${t('ei_conf', { p: pct(sl.expectancyCI.pAboveZero, 0) })}</div>`);
    const sig = sl.pValueVsCoin < 0.05 ? ` <span class="good small">${t('ei_pvalue_sig')}</span>` : '';
    lines.push(`<div class="ei-line">${t('ei_pvalue', { p: fmtNum(sl.pValueVsCoin, 3) })}${sig}</div>`);
    if (sl.extraLossesToBreakeven > 0)
      lines.push(`<div class="ei-line">${t('ei_fragility', { n: sl.extraLossesToBreakeven })}</div>`);
  }
  return `
    <section class="ei-sub card">
      <div class="ei-sub-head"><h4>${t('ei_skill_title')}</h4><span class="badge ${meta.cls}">${t(meta.key)}</span></div>
      ${lines.join('')}
    </section>`;
}

function eiTimeCard(tp, unit, sym) {
  if (!tp || !tp.available) return '';
  const banner = tp.degrading ? `<div class="ei-banner bad">${t('ei_degrading')}</div>` : '';
  const chart = tp.rolling.expectancy.length
    ? `<div class="chart-wrap" style="height:160px;"><canvas id="c-rolling"></canvas></div>`
    : `<div class="muted small">${t('ei_rolling_short')}</div>`;
  const row = (label, e, r, fmt) =>
    `<tr><td>${label}</td><td>${fmt(e)}</td><td>${fmt(r)}</td></tr>`;
  return `
    <section class="ei-sub card">
      <div class="ei-sub-head"><h4>${t('ei_time_title')}</h4></div>
      ${banner}
      ${chart}
      <table class="data-table ei-table">
        <thead><tr><th></th><th>${t('ei_early')}</th><th>${t('ei_recent')}</th></tr></thead>
        <tbody>
          ${row(t('ei_col_wr'), tp.earlyStats.winRate, tp.recentStats.winRate, (v) => fmtPct(v, 0))}
          ${row(t('ei_col_exp'), tp.earlyStats.expectancy, tp.recentStats.expectancy, (v) => fmtValue(v, unit, sym))}
          ${row(t('ei_col_pf'), tp.earlyStats.profitFactor, tp.recentStats.profitFactor, (v) => (v === Infinity ? '∞' : fmtNum(v)))}
        </tbody>
      </table>
    </section>`;
}

function eiBlindCard(bs, unit, sym) {
  if (!bs) return '';
  const { direction, instrument, dayOfWeek } = bs;
  const blocks = [];

  if (direction && direction.available) {
    const side = (label, grp, losing) => {
      const net = grp.stats.expectancy * grp.count;
      const cls = losing ? 'bad' : '';
      return `<div class="ei-line ${cls}"><span>${label} (${grp.count})</span><strong>${fmtValue(net, unit, sym)}</strong></div>`;
    };
    const note = direction.losingDirection
      ? `<div class="ei-line bad small">${t('ei_dir_losing', { dir: dirLabel(direction.losingDirection) })}</div>`
      : '';
    blocks.push(`
      <div class="ei-block">
        <div class="ei-block-title">${t('ei_dir_title')}</div>
        ${side(dirLabel('long'), direction.long, direction.losingDirection === 'long')}
        ${side(dirLabel('short'), direction.short, direction.losingDirection === 'short')}
        ${note}
      </div>`);
  }

  if (instrument && instrument.available) {
    const rows = instrument.bySymbol.slice(0, 6).map((s) => {
      const hot = s.symbol === instrument.topSymbol && instrument.concentrated;
      return `<tr class="${hot ? 'ei-hot' : ''}"><td>${s.symbol}</td><td>${s.count}</td><td>${pct(s.profitShare, 0)}</td></tr>`;
    }).join('');
    const losers = instrument.hiddenLosers.length
      ? `<div class="ei-line bad small">${t('ei_losers', { symbols: instrument.hiddenLosers.map((s) => s.symbol).join(', ') })}</div>`
      : '';
    blocks.push(`
      <div class="ei-block">
        <div class="ei-block-title">${t('ei_instr_title')}</div>
        <table class="data-table ei-table">
          <thead><tr><th>${t('ei_col_symbol')}</th><th>${t('ei_col_trades')}</th><th>${t('ei_col_share')}</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        ${losers}
      </div>`);
  }

  if (dayOfWeek && dayOfWeek.available) {
    const rows = dayOfWeek.byDay.map((d) => {
      const toxic = dayOfWeek.toxicDay && d.dayIndex === dayOfWeek.worstDay.dayIndex;
      return `<tr class="${toxic ? 'ei-toxic' : ''}"><td>${dayLabel(d.dayIndex)}</td><td>${d.count}</td><td>${fmtValue(d.stats.expectancy, unit, sym)}</td></tr>`;
    }).join('');
    blocks.push(`
      <div class="ei-block">
        <div class="ei-block-title">${t('ei_dow_title')}</div>
        <table class="data-table ei-table">
          <thead><tr><th>${t('ei_col_day')}</th><th>${t('ei_col_trades')}</th><th>${t('ei_col_exp')}</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`);
  }

  const body = blocks.length ? blocks.join('') : `<div class="muted small">${t('ei_no_blindspots')}</div>`;
  return `
    <section class="ei-sub card">
      <div class="ei-sub-head"><h4>${t('ei_blind_title')}</h4></div>
      ${body}
    </section>`;
}

function renderEdgeIntegrity(report, unit, sym) {
  if (!report.skillLuck && !report.temporal && !report.blindspots) return '';
  return `
    <div class="ei card pad result-enter" style="animation-delay:260ms">
      <h3>${t('ei_title')}</h3>
      <div class="ei-grid">
        ${report.skillLuck ? eiSkillCard(report.skillLuck) : ''}
        ${eiTimeCard(report.temporal, unit, sym)}
        ${eiBlindCard(report.blindspots, unit, sym)}
      </div>
    </div>`;
}

export function renderReport(report, mount, { ruinThreshold = 0.5 } = {}) {
  const v = verdict(report);
  const s = report.stats;
  const sim = report.sim;
  const k = report.kelly;

  // Set dynamic accent BEFORE charts render so c() reads the updated CSS variable.
  const rawPF = Number.isFinite(s.profitFactor) ? s.profitFactor : 0;
  setDynamicAccent(rawPF);

  const pf = s.profitFactor === Infinity ? '∞' : fmtNum(s.profitFactor);
  const sigPct = pct(report.edge.pAboveZero, 0);
  // Score badge must never show raw NaN — fall back to "N/A" if it failed.
  const scoreDisplay = Number.isFinite(report.robustness?.score) ? report.robustness.score : 'N/A';

  // Per-trade unit: '$' when a no-R journal was normalized, else R-multiples.
  const unit = report.displayUnit || 'R';
  const sym = report.currencySymbol || '$';
  const expSub = unit === 'currency' ? 'kpi_expectancy_sub_cur' : 'kpi_expectancy_sub';

  mount.innerHTML = `
    <div class="verdict card ${v.cls} result-enter" style="animation-delay:0ms">
      <div class="verdict-main">
        <div class="verdict-score ${v.cls}">${scoreDisplay}<span>/100</span></div>
        <div>
          <div class="verdict-grade">${t(v.key)}</div>
          <div class="verdict-sub">${t('robustness_score')}: ${t(gradeKey[report.robustness.grade])}</div>
        </div>
      </div>
    </div>

    <div class="kpi-grid kpi-primary result-enter" style="animation-delay:120ms">
      ${kpi(t('kpi_expectancy'), fmtValue(s.expectancy, unit, sym), t(expSub), 'accent', 'kpi-expectancy')}
      ${kpi(t('kpi_pf'), pf, t('kpi_pf_sub'), 'accent', 'kpi-pf')}
      ${kpi(t('kpi_ruin'), fmtPct(sim.riskOfRuin), t('kpi_ruin_sub', { threshold: fmtPct(ruinThreshold, 0) }), sim.riskOfRuin > 0.05 ? 'bad' : 'good', 'kpi-ruin')}
    </div>

    <div class="kpi-section-label result-enter" style="animation-delay:160ms">
      <span>${t('kpi_secondary_label')}</span>
    </div>

    <div class="kpi-grid kpi-secondary result-enter" style="animation-delay:200ms">
      ${kpi(t('kpi_return'), fmtPctSigned(sim.meanReturn), t('kpi_return_sub', { p10: fmtPctSigned(sim.p10Return), p90: fmtPctSigned(sim.p90Return) }), sim.meanReturn >= 0 ? 'good' : 'bad')}
      ${kpi(t('kpi_median'), fmtPctSigned(sim.medianReturn), t('kpi_median_sub'), sim.medianReturn >= 0 ? 'good' : 'bad')}
      ${kpi(t('kpi_pop'), fmtPct(sim.probProfit, 0), t('kpi_pop_sub'), sim.probProfit >= 0.55 ? 'good' : sim.probProfit >= 0.45 ? 'warn' : 'bad', 'kpi-pop')}
      ${kpi(t('kpi_dd'), fmtPct(sim.medianDD), t('kpi_dd_sub', { worst: fmtPct(sim.worstDD) }), 'warn', 'kpi-dd')}
      ${kpi(t('kpi_kelly'), k.profitable ? fmtPct(k.fStar, 1) : 'N/A', k.profitable ? t('kpi_kelly_sub', { mode: k.modeLabel, rec: fmtPct(k.recommended, 2) }) : t('verdict_noedge'), '', 'kpi-kelly')}
      ${kpi(t('kpi_sig'), sigPct, t('kpi_sig_sub'), '', 'kpi-sig', t('kpi_sig_tip'))}
    </div>
    ${unit === 'currency' ? `<div class="notice warn result-enter" style="animation-delay:210ms">${t('notice_currency_normalized')}</div>` : ''}

    <div class="diag card result-enter" style="animation-delay:220ms">
      <h3>${t('diag_title')}</h3>
      <div class="diag-grid">
        <div class="diag-col good"><h4>${t('diag_strengths')}</h4><ul>${findingList(report.findings.strengths)}</ul></div>
        <div class="diag-col bad"><h4>${t('diag_weaknesses')}</h4><ul>${findingList(report.findings.weaknesses)}</ul></div>
        <div class="diag-col risk"><h4>${t('diag_risks')}</h4><ul>${findingList(report.findings.risks)}</ul></div>
        <div class="diag-col action"><h4>${t('diag_actions')}</h4><ul>${findingList(report.findings.actions)}</ul></div>
      </div>
    </div>

    ${renderEdgeIntegrity(report, unit, sym)}

    <div class="report-actions result-enter" style="animation-delay:300ms">
      <button class="btn-secondary" id="rep-share">${t('btn_share')}</button>
      <button class="btn-secondary" id="rep-pdf">${t('btn_pdf')}</button>
    </div>

    <div class="chart-grid result-enter" style="animation-delay:320ms">
      <section class="card panel wide chart-hero">
        <div class="chart-hero-head">
          <h3>${t('chart_equity')}</h3>
          <span class="chart-hero-badge">${t('chart_equity_badge')}</span>
        </div>
        <div class="chart-wrap chart-3d tall"><canvas id="c-equity"></canvas></div>
      </section>
      <section class="card panel"><h3>${t('chart_dist')}</h3><div class="chart-wrap"><canvas id="c-dist"></canvas></div></section>
      <section class="card panel"><h3>${t('chart_dd')}</h3><div class="chart-wrap"><canvas id="c-dd"></canvas></div></section>
      <section class="card panel"><h3>${t('chart_ruin')}</h3><div class="chart-wrap"><canvas id="c-ruin"></canvas></div></section>
      <section class="card panel"><h3>${t('chart_streaks')}</h3><div class="chart-wrap"><canvas id="c-streaks"></canvas></div></section>
    </div>
  `;

  // Animate the verdict score counter from 0 → final value.
  const scoreEl = mount.querySelector('.verdict-score');
  if (scoreEl && Number.isFinite(report.robustness?.score)
      && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const target = report.robustness.score;
    const duration = 900;
    const start = performance.now();
    const suffix = '<span>/100</span>';
    function tick(now) {
      const progress = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
      const current = Math.round(eased * target);
      scoreEl.innerHTML = `${current}${suffix}`;
      if (progress < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  renderEquity('c-equity', report.bands);
  renderHistogram('c-dist', report.returns);
  renderDrawdownHist('c-dd', report.maxDDs);
  renderRuinProfile('c-ruin', sim.ruinProfile);
  if (report.temporal?.available && report.temporal.rolling.expectancy.length) {
    renderRollingLine('c-rolling', report.temporal.rolling.expectancy);
  }
  const streakLabels = Array.from({ length: 8 }, (_, i) => `${i + 1}`);
  renderStreaks('c-streaks', report.streaks.winDist.slice(1, 9), report.streaks.lossDist.slice(1, 9),
    streakLabels, { win: t('streak_win'), loss: t('streak_loss') });

  // ── Report actions: PDF (print) + Share (clipboard) ──────────────────────────
  mount.querySelector('#rep-pdf')?.addEventListener('click', () => window.print());
  const shareBtn = mount.querySelector('#rep-share');
  shareBtn?.addEventListener('click', async () => {
    const gradeTxt = t(gradeKey[report.robustness.grade] || 'grade_fragile');
    const score = Number.isFinite(report.robustness?.score) ? report.robustness.score : '—';
    const summary = [
      `${t('share_strategy')}: ${gradeTxt} (${score}/100)`,
      `${t('share_expectancy')}: ${fmtValue(s.expectancy, unit, sym)} | PF: ${pf} | ${t('share_ruin')}: ${fmtPct(sim.riskOfRuin)}`,
      t('share_footer'),
    ].join('\n');
    const orig = shareBtn.textContent;
    try {
      await navigator.clipboard.writeText(summary);
      shareBtn.textContent = t('share_copied');
    } catch (_) {
      shareBtn.textContent = t('share_failed');
    }
    setTimeout(() => { shareBtn.textContent = orig; }, 2200);
  });

  // ── AI cards ────────────────────────────────────────────────────────────────
  const metrics = {
    expectancy:    s.expectancy,
    profitFactor:  s.profitFactor,
    riskOfRuin:    sim.riskOfRuin,
    winRate:       report.effWinRate ?? s.winRate,
    tradeCount:    s.count ?? report.spec?.trades,
    maxDrawdown:   sim.worstDD,
  };

  const diag = diagnostics(metrics);

  window.__sap_currentAnalysis = {
    metrics,
    tradeHistory: report.spec?.sample ?? null,
    diagnostics: diag,
  };

  const aiWrap = document.createElement('div');
  aiWrap.innerHTML = `
    <div id="ai-summary-container" style="margin-top:16px;"></div>
    <div id="ai-weakness-container" style="margin-top:16px;"></div>`;
  mount.appendChild(aiWrap);

  createAISummaryCard(mount.querySelector('#ai-summary-container')).renderSummary(metrics, diag);
  createAIWeaknessPanel(mount.querySelector('#ai-weakness-container')).renderWeaknesses(diag);

  // Signal the AI chat (and any other listeners) that fresh results are ready.
  window.dispatchEvent(new Event('sap:analysis-complete'));
}
