// Chart.js wrappers. Presentation only — every renderer receives ready data.
import Chart from 'chart.js/auto';
import { fmtMoney } from './format.js';

const GOOD = 'rgba(5,150,105,.82)';
const BAD = 'rgba(220,38,38,.82)';
const WARN = 'rgba(217,119,6,.82)';
const ACCENT = 'rgba(29,78,216,.9)';

const registry = {};

const common = {
  responsive: true,
  maintainAspectRatio: false,
  animation: { duration: 350 },
  plugins: {
    legend: { display: false },
    tooltip: {
      backgroundColor: 'rgba(16,24,40,.96)', padding: 10, cornerRadius: 10,
      displayColors: false, titleFont: { size: 12, weight: '700' }, bodyFont: { size: 12 },
    },
  },
  scales: {
    x: { grid: { color: 'rgba(16,24,40,.05)' }, ticks: { color: '#667085', font: { size: 10 } } },
    y: { grid: { color: 'rgba(16,24,40,.05)' }, ticks: { color: '#667085', font: { size: 10 } } },
  },
};

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

export function renderEquity(id, bands) {
  const band = (data, alpha, fill) => ({
    data, borderColor: `rgba(29,78,216,${alpha})`, backgroundColor: 'rgba(29,78,216,.05)',
    pointRadius: 0, borderWidth: 1, fill, tension: 0.2,
  });
  mount(id, {
    type: 'line',
    data: {
      labels: bands.labels,
      datasets: [
        band(bands.p90, 0.18, false),
        band(bands.p75, 0.28, '-1'),
        { data: bands.p50, borderColor: ACCENT, backgroundColor: 'rgba(29,78,216,.10)', pointRadius: 0, borderWidth: 2, fill: '-1', tension: 0.2 },
        band(bands.p25, 0.28, '-1'),
        band(bands.p10, 0.18, '-1'),
      ],
    },
    options: {
      ...common,
      scales: { ...common.scales, y: { ...common.scales.y, ticks: { ...common.scales.y.ticks, callback: (v) => fmtMoney(v) } } },
    },
  });
}

export function renderHistogram(id, values, { bins = 26, asPercent = true } = {}) {
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
        backgroundColor: hist.map((_, i) => (min + i * step >= 0 ? GOOD : BAD)),
        borderRadius: 6, borderSkipped: false,
      }],
    },
    options: common,
  });
}

export function renderDrawdownHist(id, dds, { bins = 16 } = {}) {
  const max = Math.max(...dds, 0.01);
  const step = max / bins;
  const hist = new Array(bins).fill(0);
  dds.forEach((v) => { hist[Math.min(bins - 1, Math.floor(v / step))]++; });
  mount(id, {
    type: 'bar',
    data: {
      labels: hist.map((_, i) => `${(i * step * 100).toFixed(0)}%`),
      datasets: [{ data: hist, backgroundColor: WARN, borderRadius: 6, borderSkipped: false }],
    },
    options: common,
  });
}

// Horizontal stress scenarios: mean return per scenario, baseline first.
// Explicit scale types are required: with indexAxis 'y' the category axis is Y
// and the value axis is X — Chart.js will not infer this from a merged config.
export function renderScenarios(id, labels, returns) {
  const tick = { color: '#667085', font: { size: 11 } };
  mount(id, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        data: returns.map((r) => r * 100),
        backgroundColor: returns.map((r) => (r >= 0 ? GOOD : BAD)),
        borderRadius: 6, borderSkipped: false,
      }],
    },
    options: {
      ...common,
      indexAxis: 'y',
      scales: {
        x: { type: 'linear', grid: { color: 'rgba(16,24,40,.05)' }, ticks: { ...tick, callback: (v) => `${v}%` } },
        y: { type: 'category', grid: { display: false }, ticks: tick },
      },
    },
  });
}

export function renderStreaks(id, winDist, lossDist, labels, legend) {
  mount(id, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: legend.win, data: winDist, backgroundColor: GOOD, borderRadius: 4 },
        { label: legend.loss, data: lossDist, backgroundColor: BAD, borderRadius: 4 },
      ],
    },
    options: { ...common, plugins: { ...common.plugins, legend: { display: true, position: 'bottom', labels: { usePointStyle: true, font: { size: 11 } } } } },
  });
}

export function renderRuinProfile(id, profile) {
  mount(id, {
    type: 'bar',
    data: {
      labels: profile.map((p) => `-${(p.threshold * 100).toFixed(0)}%`),
      datasets: [{
        data: profile.map((p) => p.probability * 100),
        backgroundColor: profile.map((p) => (p.probability > 0.05 ? BAD : WARN)),
        borderRadius: 6, borderSkipped: false,
      }],
    },
    options: {
      ...common,
      scales: { ...common.scales, y: { ...common.scales.y, ticks: { ...common.scales.y.ticks, callback: (v) => `${v}%` } } },
    },
  });
}

export function renderPropLadder(id, ladder, recRisk) {
  mount(id, {
    type: 'bar',
    data: {
      labels: ladder.map((l) => `${(l.risk * 100).toFixed(2)}%`),
      datasets: [{
        data: ladder.map((l) => l.passRate * 100),
        backgroundColor: ladder.map((l) => (Math.abs(l.risk - recRisk) < 1e-9 ? ACCENT : 'rgba(29,78,216,.35)')),
        borderRadius: 6, borderSkipped: false,
      }],
    },
    options: {
      ...common,
      scales: { ...common.scales, y: { ...common.scales.y, max: 100, ticks: { ...common.scales.y.ticks, callback: (v) => `${v}%` } } },
    },
  });
}
