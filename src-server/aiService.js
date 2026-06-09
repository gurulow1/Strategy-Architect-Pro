// AI feature handlers.
// Each is: async (domain-specific args, model, lang) → plain object (will be JSON-serialised).
// All throws are caught by the router and mapped to 503.

// ── Helpers ───────────────────────────────────────────────────────────────────

const LANG_NAMES = { en: 'English', ru: 'Russian' };
const ln = (lang) => LANG_NAMES[lang] || 'English';

// Neutralise prompt-injection attempts in free-text user input before it is
// embedded in an LLM prompt. Strips control chars, defangs role markers and
// "ignore previous instructions"-style overrides, and hard-caps the length.
function sanitizeUserText(input, maxLen = 1000) {
  if (typeof input !== 'string') return '';
  let s = input.replace(/[\u0000-\u001F\u007F]/g, ' '); // strip control chars
  const patterns = [
    /ignore\s+(all|any|the)?\s*(previous|above|prior|earlier)\s+(instructions?|prompts?|messages?)/gi,
    /disregard\s+(all|any|the)?\s*(previous|above|prior|earlier)\s+(instructions?|prompts?|messages?)/gi,
    /forget\s+(all|everything|previous|prior)/gi,
    /you\s+are\s+now\b/gi,
    /act\s+as\s+(an?|the)\b/gi,
    /override\s+(the|your|all)?\s*(instructions?|rules?|system)/gi,
    /^\s*(system|assistant|developer|user)\s*:/gim,
    /<\/?(system|assistant|user|developer)>/gi,
  ];
  for (const re of patterns) s = s.replace(re, '[filtered]');
  return s.trim().slice(0, maxLen);
}

// Call Groq and parse the JSON response.
// The model is configured with response_format: json_object,
// but we strip any accidental markdown fences defensively.
async function groqJSON(model, prompt) {
  const result = await model.generateContent(prompt);
  const raw = result.response.text();
  const text = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  return JSON.parse(text);
}

// ── Verdict — deterministic, AI never overrides this ─────────────────────────

function computeVerdict(metrics, diag) {
  const expectancy   = metrics?.expectancy   ?? 0;
  const profitFactor = metrics?.profitFactor ?? 0;
  const riskOfRuin   = metrics?.riskOfRuin   ?? 0;

  if (expectancy <= 0) return 'no_edge';
  if (riskOfRuin > 0.15 || (Number.isFinite(profitFactor) && profitFactor < 1.2)) return 'weak';
  if (diag?.edgeDecay?.detected || diag?.concentrationRisk?.detected) return 'fragile';
  if (
    Number.isFinite(profitFactor) && profitFactor > 1.5 &&
    riskOfRuin < 0.05 &&
    diag?.sampleQuality?.sufficient
  ) return 'strong';
  return 'weak';
}

// ── Handler 1: parseJournal ───────────────────────────────────────────────────

export async function parseJournal(rawText, model, lang) {
  if (!rawText || typeof rawText !== 'string' || !rawText.trim()) {
    return { trades: [], detected_columns: {}, warnings: [] };
  }

  const language = ln(lang);
  const prompt = `You are parsing a broker trade history export. Detect the format and extract every closed trade.

Supported formats: MT4/MT5 history HTML/text report, Bybit order history CSV, Binance trading history CSV, ATAS export, Quantower export, cTrader, NinjaTrader, generic CSV/TSV with date/pnl/profit columns. Delimiter may be comma, semicolon, or tab.

PARSING RULES — handle messy real-world files:
- HEADER ROWS: an export may have MULTIPLE leading title/preamble rows before the real column header (e.g. "Account Statement", "Closed Transactions:"). Detect the real header row dynamically — it is the row whose cells name columns (contains words like Instrument/Инструмент, Date/Дата, Time, Profit/Прибыль/PnL/P&L, Direction/Type/Side, Volume/Size/Lot). Skip everything above it. Also skip any REPEATED header rows that appear again further down (paginated reports).
- COLUMN ORDER: columns may appear in ANY order and there may be extra columns you don't need — map by header name, not by position.
- NUMBERS: quantities/volumes/lots may be FRACTIONAL (e.g. 0.1, 0.2, 4.73, 17.14) — parse them as floats, never round to integers. Tolerate thousands separators (1,234.50), European decimal commas (12,5), currency symbols ($, €, ₽), and parenthesised negatives (123.45) meaning -123.45.
- MIXED INSTRUMENTS: a file may mix forex (standard 100k lots), crypto (units as-is, e.g. 0.1 BTC), indices and metals (own contract sizes). Do NOT try to convert position size to a common unit — only the realized PnL and (if present) R-multiple matter for analysis. Read PnL directly from the profit/PnL column.
- DIRECTION: map buy/long → "long", sell/short → "short"; otherwise null.

Normalize each trade to exactly this shape (null for unavailable fields):
- date: ISO 8601 string (YYYY-MM-DD or YYYY-MM-DDTHH:mm:ss) or null
- pnl: number — positive = profit, negative = loss, in account currency or R-multiples
- r_multiple: explicit R value or null
- direction: "long" | "short" | null
- duration_minutes: integer or null

ROW VALIDATION:
- Skip any row where PnL (and R-multiple) are missing, empty, or non-numeric — do NOT emit it and do NOT guess a value.
- Count skipped data rows and, if any were skipped, add ONE warning summarising how many and why.

Return ONLY valid JSON matching this schema (no extra text, no markdown):
{"trades":[{"date":null,"pnl":0,"r_multiple":null,"direction":null,"duration_minutes":null}],"detected_columns":{"format":"<broker name or generic>"},"warnings":[]}

All strings in the warnings array MUST be written in ${language} language.
If the input is not a recognisable trade journal, return an empty trades array and a warning in ${language}.

---
${rawText.slice(0, 48000)}`;

  return groqJSON(model, prompt);
}

// ── Handler 2: generateSummary ────────────────────────────────────────────────

export async function generateSummary(metrics, diagnostics, model, lang) {
  const verdict  = computeVerdict(metrics, diagnostics);
  const language = ln(lang);

  const diagSummary = {
    strengths:          (diagnostics?.strengths   ?? []).map(s => s.key),
    weaknesses:         (diagnostics?.weaknesses  ?? []).map(w => w.key),
    riskFlags:          (diagnostics?.riskFlags   ?? []).map(f => f.key),
    edgeDecay:          diagnostics?.edgeDecay?.detected          ? diagnostics.edgeDecay.reasonKey          : null,
    concentrationRisk:  diagnostics?.concentrationRisk?.detected  ? diagnostics.concentrationRisk.reasonKey  : null,
    sampleCount:        diagnostics?.sampleQuality?.tradeCount    ?? 0,
    sampleSufficient:   diagnostics?.sampleQuality?.sufficient    ?? false,
    feeSensitivity:     diagnostics?.feeSensitivity?.detected     ?? false,
  };

  const prompt = `Analyze this trading strategy and produce an honest assessment in ${language}. The verdict is already determined — do NOT change it.

VERDICT (fixed): ${verdict}

METRICS:
- Expectancy per trade: ${metrics?.expectancy ?? 'N/A'}
- Profit factor:        ${metrics?.profitFactor ?? 'N/A'}
- Risk of ruin:         ${metrics?.riskOfRuin ?? 'N/A'}
- Win rate:             ${metrics?.winRate ?? 'N/A'}
- Trade count:          ${metrics?.tradeCount ?? 'N/A'}
- Max drawdown:         ${metrics?.maxDrawdown ?? 'N/A'}

DIAGNOSTICS SUMMARY:
${JSON.stringify(diagSummary, null, 2)}

Return ONLY valid JSON (no extra text, no markdown). Every string value MUST be written in ${language}:
{"headline":"<one sentence>","verdict":"${verdict}","strengths":["<up to 3 items>"],"weaknesses":["<up to 3 items>"],"biggest_risk":"<one sentence>","sample_warning":${diagSummary.sampleSufficient ? 'null' : '"<warning string>"'},"recommended_action":"<one concrete sentence>"}

Rules:
- verdict field MUST equal exactly "${verdict}" — never change it
- Strengths and weaknesses: maximum 3 items each
- Be honest and direct — no motivational language
- If trade count < 30, sample_warning must be non-null
- All text fields in ${language}`;

  const data = await groqJSON(model, prompt);
  // Hard-enforce: AI must not override the deterministic verdict.
  data.verdict = verdict;
  return data;
}

// ── Handler 3: answerQuestion ─────────────────────────────────────────────────

export async function answerQuestion(question, metrics, tradeHistory, diagnostics, model, lang) {
  const language    = ln(lang);
  const recentTrades = Array.isArray(tradeHistory) ? tradeHistory.slice(-100) : [];
  // Sanitize the free-text question before embedding it in the prompt.
  const safeQuestion = sanitizeUserText(question);

  const prompt = `Answer the following question about a trading strategy using ONLY the data provided below. Respond entirely in ${language}.

QUESTION: ${safeQuestion}

METRICS:
${JSON.stringify(metrics ?? {}, null, 2)}

${recentTrades.length > 0
  ? `RECENT TRADES (last ${recentTrades.length}):\n${JSON.stringify(recentTrades)}`
  : '(No trade history provided)'}

DIAGNOSTICS:
${JSON.stringify(diagnostics ?? {}, null, 2)}

Return ONLY valid JSON (no extra text, no markdown):
{"answer":"<2-4 sentences in ${language}>","evidence":["<specific stat or number>"],"confidence":"high"|"medium"|"low","caveat":null,"navigation":null}

Rules:
- Only reference data that appears explicitly above
- If the question cannot be answered from the available data, say so clearly in the answer field
- confidence: "high" if data answers it directly, "medium" if inferential, "low" if speculative
- evidence: list specific numbers from the metrics — not general statements
- caveat: null or one sentence in ${language} about limitations
- All text in ${language}

NAVIGATION HINT (optional):
If your answer references a specific parameter the user should look at, set the "navigation" field to help them navigate directly to it.
Otherwise set "navigation": null.

Valid navigation object shape: {"tab":"<tab-id>","highlight":"<element-id>"}

Valid tab IDs:          quick | journal | robustness | prop
Valid highlight IDs:
  quick tab     → qc-winrate, qc-rr, qc-risk, qc-cost, qc-capital, qc-trades
  results cards → kpi-expectancy, kpi-pf, kpi-ruin, kpi-dd, kpi-pop, kpi-kelly, kpi-sig
  prop tab      → pp-daily, pp-max, pp-target

Only use a highlight ID that is genuinely relevant to your answer.
If the answer is general (no specific parameter), set navigation: null.`;

  return groqJSON(model, prompt);
}

// ── Handler 4: explainWeaknesses ──────────────────────────────────────────────

export async function explainWeaknesses(diagnostics, model, lang) {
  const language = ln(lang);

  const issues = {
    weaknesses:        diagnostics?.weaknesses        ?? [],
    riskFlags:         diagnostics?.riskFlags         ?? [],
    breakpoints:       diagnostics?.breakpoints       ?? [],
    edgeDecay:         diagnostics?.edgeDecay,
    concentrationRisk: diagnostics?.concentrationRisk,
    feeSensitivity:    diagnostics?.feeSensitivity,
    sampleQuality:     diagnostics?.sampleQuality,
  };

  const hasIssues =
    issues.weaknesses.length > 0 ||
    issues.riskFlags.length  > 0 ||
    issues.breakpoints.length > 0 ||
    issues.edgeDecay?.detected ||
    issues.concentrationRisk?.detected ||
    issues.feeSensitivity?.detected ||
    !issues.sampleQuality?.sufficient;

  if (!hasIssues) {
    return { findings: [] };
  }

  const prompt = `Convert these trading strategy diagnostic findings (English machine keys) into clear, actionable explanations in ${language}.

DIAGNOSTIC DATA:
${JSON.stringify(issues, null, 2)}

For each real issue — items in weaknesses/riskFlags/breakpoints arrays, or sub-objects with detected:true, or sampleQuality.sufficient === false — produce one finding object.
Skip anything with detected:false and empty arrays.
Sort results: "critical" first, then "warning", then "info".

Return ONLY valid JSON (no extra text, no markdown):
{"findings":[{"type":"<key>","severity":"critical"|"warning"|"info","description":"<explanation in ${language}>","evidence":"<specific numbers/data in ${language}>","action":"<concrete step in ${language}>"}]}

Severity mapping:
- critical: negative_expectancy, high_risk_of_ruin, ruin_exceeds_10pct
- warning:  low_profit_factor, edge decay (detected:true), concentration risk (detected:true), fee sensitivity (detected:true), prop violation flags
- info:     insufficient sample, low_win_rate, kelly_exceeds_limit, drawdown_near_prop_limit
All text in ${language}.`;

  return groqJSON(model, prompt);
}
