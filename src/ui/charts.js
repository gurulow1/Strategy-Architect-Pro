// Chart.js wrappers. Presentation only — every renderer receives ready data.
// All colors are resolved at render time so dark/light theme is always correct.
import Chart from 'chart.js/auto';
import { fmtMoney } from './format.js';

const registry = {};

// ── Theme-aware color palette ─────────────────────────────────────────────────
function isDark() { return document.documentElement.classList.contains('dark'); }

function c() {
  const dark = isDark();
  return {
    GOOD:         dark ? 'rgba(34,197,94,0.8)'    : 'rgba(22,163,74,0.8)',
    BAD:          dark ? 'rgba(239,68,68,0.8)'    : 'rgba(220,38,38,0.8)',
    WARN:         dark ? 'rgba(245,158,11,0.8)'   : 'rgba(202,138,4,0.8)',
    ACCENT:       dark ? 'rgba(99,102,241,0.9)'   : 'rgba(79,70,229,0.9)',
    ACCENT_DIM:   dark ? 'rgba(99,102,241,0.25)'  : 'rgba(79,70,229,0.25)',
    grid:         dark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)',
    tick:         dark ? '#737373'                : '#666666',
    tooltipBg:    dark ? '#141414'                : '#ffffff',
    tooltipBorder:dark ? 'rgba(255,255,255,0.1)'  : 'rgba(0,0,0,0.1)',
  };
}

// ── Shared chart options factory ──────────────────────────────────────────────
function common() {
  const p = c();
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 350 },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: p.tooltipBg, borderColor: p.tooltipBorder, borderWidth: 1,
        padding: 10, cornerRadius: 8,
        displayColors: false, titleFont: { size: 12, weight: '700' }, bodyFont: { size: 12 },
      },
    },
    scales: {
      x: { grid: { color: p.grid }, ticks: { color: p.tick, font: { size: 10 } } },
      y: { grid: { color: p.grid }, ticks: { color: p.tick, font: { size: 10 } } },
    },
  };
}

function mount(id, config) {
  const el = document.getElementById(id);
  if (!el) return null;
  if (registry[id]) registry[id].destroy();
  registry[id] = new Chart(el, config);
  return registry[id];
}

export function destroyAll() {
  Object.keys(registry).forEach((id) => { registry[id].destroy(); delete registry[id]; });
}

// ── Theme refresh — call after toggling dark/light ────────────────────────────
export function refreshChartTheme() {
  const p = c();
  // Update Chart.js global default color (affects legend text, etc.)
  Chart.defaults.color = p.tick;
  const scaleUpdates = {
    grid: { color: p.grid },
    ticks: { color: p.tick, font: { size: 10 } },
  };
  Object.values(registry).forEach((chart) => {
    if (!chart) return;
    if (chart.options.plugins?.tooltip) {
      chart.options.plugins.tooltip.backgroundColor = p.tooltipBg;
      chart.options.plugins.tooltip.borderColor = p.tooltipBorder;
    }
    ['x', 'y'].forEach((axis) => {
      if (chart.options.scales?.[axis]) {
        Object.assign(chart.options.scales[axis], scaleUpdates);
      }
    });
    chart.update('none'); // instant update without animation
  });
}

// ── Render functions ──────────────────────────────────────────────────────────

export function renderEquity(id, bands) {
  const p = c();
  const fill = isDark() ? 'rgba(99,102,241,0.06)' : 'rgba(79,70,229,0.06)';
  const band = (data, alpha, f) => ({
    data, borderColor: isDark() ? `rgba(99,102,241,${alpha})` : `rgba(79,70,229,${alpha})`,
    backgroundColor: fill,
    pointRadius: 0, borderWidth: 1, fill: f, tension: 0.2,
  });
  mount(id, {
    type: 'line',
    data: {
      labels: bands.labels,
      datasets: [
        band(bands.p90, 0.18, false),
        band(bands.p75, 0.28, '-1'),
        { data: bands.p50, borderColor: p.ACCENT, backgroundColor: fill, pointRadius: 0, borderWidth: 2, fill: '-1', tension: 0.2 },
        band(bands.p25, 0.28, '-1'),
        band(bands.p10, 0.18, '-1'),
      ],
    },
    options: {
      ...common(),
      scales: { ...common().scales, y: { ...common().scales.y, ticks: { ...common().scales.y.ticks, callback: (v) => fmtMoney(v) } } },
    },
  });
}

export function renderHistogram(id, values, { bins = 26, asPercent = true } = {}) {
  const p = c();
  const min = Math.min(...values), max = Math.max(...values);
  const step = (max - min) / bins || 0.01;
  const hist = new Array(bins).fill(0);
  values.forEach((v) => { hist[Math.min(bins - 1, Math.max(0, Math.floor((v - min) / step)))]++; });
  mount(id, {
    type: 'bar',
    data: {
      labels: hist.map((_, i) => (asPercent ? `${((min + i * step) * 100).toFixed(0)}%` : (min + i * step).toFixed(1))),
      datasets: [{
        data: hist,
        backgroundColor: hist.map((_, i) => (min + i * step >= 0 ? p.GOOD : p.BAD)),
        borderRadius: 4, borderSkipped: false,
      }],
    },
    options: common(),
  });
}

export function renderDrawdownHist(id, dds, { bins = 16 } = {}) {
  const p = c();
  const max = Math.max(...dds, 0.01);
  const step = max / bins;
  const hist = new Array(bins).fill(0);
  dds.forEach((v) => { hist[Math.min(bins - 1, Math.floor(v / step))]++; });
  mount(id, {
    type: 'bar',
    data: {
      labels: hist.map((_, i) => `${(i * step * 100).toFixed(0)}%`),
      datasets: [{ data: hist, backgroundColor: p.WARN, borderRadius: 6, borderSkipped: false }],
    },
    options: common(),
  });
}

export function renderScenarios(id, labels, returns) {
  const p = c();
  const tick = { color: p.tick, font: { size: 11 } };
  mount(id, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        data: returns.map((r) => r * 100),
        backgroundColor: returns.map((r) => (r >= 0 ? p.GOOD : p.BAD)),
        borderRadius: 4, borderSkipped: false,
      }],
    },
    options: {
      ...common(),
      indexAxis: 'y',
      scales: {
        x: { type: 'linear', grid: { color: p.grid }, ticks: { ...tick, callback: (v) => `${v}%` } },
        y: { type: 'category', grid: { display: false }, ticks: tick },
      },
    },
  });
}

export function renderStreaks(id, winDist, lossDist, labels, legend) {
  const p = c();
  mount(id, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: legend.win,  data: winDist,  backgroundColor: p.GOOD, borderRadius: 4 },
        { label: legend.loss, data: lossDist, backgroundColor: p.BAD,  borderRadius: 4 },
      ],
    },
    options: {
      ...common(),
      plugins: {
        ...common().plugins,
        legend: { display: true, position: 'bottom', labels: { usePointStyle: true, font: { size: 11 }, color: p.tick } },
      },
    },
  });
}

export function renderRuinProfile(id, profile) {
  const p = c();
  mount(id, {
    type: 'bar',
    data: {
      labels: profile.map((pp) => `-${(pp.threshold * 100).toFixed(0)}%`),
      datasets: [{
        data: profile.map((pp) => pp.probability * 100),
        backgroundColor: profile.map((pp) => (pp.probability > 0.05 ? p.BAD : p.WARN)),
        borderRadius: 4, borderSkipped: false,
      }],
    },
    options: {
      ...common(),
      scales: { ...common().scales, y: { ...common().scales.y, ticks: { ...common().scales.y.ticks, callback: (v) => `${v}%` } } },
    },
  });
}

export function renderPropLadder(id, ladder, recRisk) {
  const p = c();
  mount(id, {
    type: 'bar',
    data: {
      labels: ladder.map((l) => `${(l.risk * 100).toFixed(2)}%`),
      datasets: [{
        data: ladder.map((l) => l.passRate * 100),
        backgroundColor: ladder.map((l) => (Math.abs(l.risk - recRisk) < 1e-9 ? p.ACCENT : p.ACCENT_DIM)),
        borderRadius: 4, borderSkipped: false,
      }],
    },
    options: {
      ...common(),
      scales: { ...common().scales, y: { ...common().scales.y, max: 100, ticks: { ...common().scales.y.ticks, callback: (v) => `${v}%` } } },
    },
  });
}
