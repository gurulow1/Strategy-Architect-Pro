# CURSOR_PROMPT_6 — Fix Kelly inflation + Sensitivity table range

## Context

Two targeted fixes. All tests must keep passing.

---

## SECTION 1 — Fix Kelly when rBasis === 'normalized'

### Problem

In `src/analysis/report.js` line 101:
```js
const effRr = realStats ? realStats.payoffRatio : rr;
```

When `rBasis === 'normalized'`, `realStats.payoffRatio` = avgWin / avgLoss in raw
currency (e.g. $44 000 / $1 200 = 36.7). Kelly formula then gives 93.6% — a
theoretical maximum that's meaningless for real trading decisions.

The R-multiple sample has already been clipped to MAX_R_NORM = 10 for simulation.
Kelly should be consistent with that clipped distribution.

### Fix in `src/analysis/report.js`

After line 83 (`} = input;`), add the helper:

```js
// When PnL was normalized to R (no explicit R column), the raw payoffRatio is
// inflated by the normalization factor. Compute Kelly-effective RR from the
// clipped sample's own statistics so Kelly is consistent with the simulation.
function clippedStats(sample) {
  if (!Array.isArray(sample) || sample.length === 0) return null;
  const wins  = sample.filter((v) => v > 0);
  const losses = sample.filter((v) => v < 0);
  if (!wins.length || !losses.length) return null;
  const avgWin  = wins.reduce((a, b) => a + b, 0) / wins.length;
  const avgLoss = Math.abs(losses.reduce((a, b) => a + b, 0) / losses.length);
  return {
    winRate:     wins.length / sample.length,
    payoffRatio: avgLoss > 0 ? avgWin / avgLoss : 0,
  };
}
```

Then change lines 100–103:
```js
// was:
// const effWinRate = realStats ? realStats.winRate : winRate;
// const effRr = realStats ? realStats.payoffRatio : rr;
// const kelly = kellySizing(effWinRate, effRr, kellyMode, fixedFraction);

// NEW:
const effWinRate = realStats ? realStats.winRate : winRate;
// When sample was PnL-normalized, use the clipped sample's own RR for Kelly —
// this keeps Kelly consistent with what the Monte Carlo actually simulates.
const kellyStats = (rBasis === 'normalized' && sample && sample.length)
  ? clippedStats(sample)
  : null;
const effRr = kellyStats ? kellyStats.payoffRatio : (realStats ? realStats.payoffRatio : rr);
const kelly = kellySizing(
  kellyStats ? kellyStats.winRate : effWinRate,
  effRr,
  kellyMode,
  fixedFraction,
);
```

**Expected result**: For the BTC journal (clipped to ±10R):
- avgWin from clipped sample ≈ 3–8R, avgLoss ≈ 1R → payoffRatio ≈ 3–8
- Kelly ≈ 60–75% → Half Kelly ≈ 30–37% — still high but physically plausible
  (this is a genuinely strong strategy; Half-Kelly should stay elevated)
- Recommended risk in sensitivity table becomes something sensible like 1–3%

**Do not change** `realStats` — it stays the raw currency figures (expectancy in $,
PF, win rate). Only Kelly sizing uses the clipped RR. The display on the results page
is unaffected: expectancy stays $6,627, PF stays 137.

---

## SECTION 2 — Fix sensitivity table range + practical cap

### Problem 1: `buildLevels` not applied

In `src/ui/workflows/positionCalc.js`, the `buildLevels` function was added but the
module-level `LEVELS` constant is still being read. The pre-computation still uses
the hardcoded array.

**Find this pattern** in `positionCalc.js`:
```js
const LEVELS = [0.0025, 0.005, 0.0075, 0.01, 0.0125, 0.015, 0.02, 0.03];
```
or any hardcoded array used in `precomputeSensitivity`. Replace it so the function
always receives a dynamically built levels array.

**Correct wiring** (in `renderSensitivityPanel`):
```js
const kellyRecommended = report.kelly.recommended > 0 ? report.kelly.recommended : report.spec.risk;
const dynLevels = buildLevels(kellyRecommended);
const levels = precomputeSensitivity(report, dynLevels);
```

Make sure `precomputeSensitivity(report, levels)` uses the `levels` parameter, not a
module-level constant.

### Problem 2: Range cap

`buildLevels` currently caps at `min(rec * 2, 0.05)`. For Kelly recommended = 30–37%,
this gives max = 5%. Good. But the sensitivity table should always stay in a
**practically tradeable range**: cap at **3%** maximum regardless of Kelly.

The purpose of this table is to help the trader choose a risk level they would actually
use. Showing simulated returns at 5% risk with a 89% WR strategy produces +100,000%
which is useless noise.

**Replace the cap in `buildLevels`:**
```js
function buildLevels(kellyRisk) {
  const rec = kellyRisk > 0 ? kellyRisk : 0.01;
  // Always show a practically useful range: 0.25% to max 3%.
  // The actual Kelly may be above this range — that's fine, see the warning note.
  const PRACTICAL_MAX = 0.03;
  const minLevel = 0.0025;
  const step = (PRACTICAL_MAX - minLevel) / 7;
  return Array.from({ length: 8 }, (_, i) =>
    Math.round((minLevel + step * i) * 10000) / 10000
  );
}
```

This gives a clean fixed range 0.25%–3% in 8 steps. The Kelly ★ marks whichever level
is closest to `kellyRecommended` within this range.

### Problem 3: Kelly warning when Kelly > 3%

When the recommended Kelly level (Half-Kelly) exceeds the table's practical max (3%),
add a clear explanatory note. Without this, the ★ at 3% looks like a bug.

**Add below the sensitivity table**, in `renderSensitivityBlock`:
```js
const kellyAbove = kellyRecommended > 0.03;
const kellyNote = kellyAbove
  ? `<div class="notice warn" style="margin-top:10px;font-size:12px;">
      ${t('risk_sens_kelly_above', {
        kelly: fmtPct(kellyRecommended, 1),
        practical: '3%',
      })}
     </div>`
  : `<div class="risk-sens-legend muted small" style="margin-top:8px;">
      ${t('risk_sens_kelly_note', { kelly: fmtPct(kellyRecommended, 2) })}
     </div>`;
```

**i18n keys:**
```js
// ru.js
risk_sens_kelly_above: 'Kelly-оптимум ({kelly}) выше практического диапазона таблицы ({practical}). '
  + 'Такой риск теоретически максимален, но реальная торговля требует 1–2%. '
  + 'Звёздочка (★) отмечает ближайший уровень в таблице.',

// en.js
risk_sens_kelly_above: 'Kelly optimum ({kelly}) is above the table\'s practical range ({practical}). '
  + 'This is a theoretical maximum — real trading should use 1–2%. '
  + 'The star (★) marks the closest level in the table.',
```

---

## SECTION 3 — Recovery calculator edge case

When `expectancy` is very large (e.g. $6,627/trade), `tradesNeeded` rounds to 0 or 1
which looks confusing. Fix the display:

In `updateRecovery` in `positionCalc.js`:
```js
// After computing tradesNeeded:
const tradesDisplay = tradesNeeded !== null
  ? (tradesNeeded <= 1
      ? t('recovery_less_than_one')      // "< 1 сделки при текущем матожидании"
      : `~${tradesNeeded} ${t('recovery_trades_unit')}`)
  : t('recovery_trades_na');
```

**i18n keys:**
```js
// ru.js
recovery_less_than_one: '< 1 сделки (матожидание покрывает просадку за одну сделку)',
// en.js
recovery_less_than_one: '< 1 trade (single trade expectancy covers this drawdown)',
```

---

## Verification

1. Upload MT5 BTC journal → Kelly shows realistic value (not 93.6%) ✓
2. Kelly recommended ≈ 30–40% → Half-Kelly ≈ 15–20% → notice shown in table ✓
3. Sensitivity table always shows 0.25%–3% in 8 rows ✓
4. ★ marks whichever row is closest to Half-Kelly recommendation ✓
5. Expected returns in table are large but not +100,000% ✓
6. Recovery calc shows "< 1 сделки" when expectancy covers the whole drawdown ✓
7. All existing tests pass ✓
8. Quick Check (no rBasis) — Kelly unchanged, no regression ✓
