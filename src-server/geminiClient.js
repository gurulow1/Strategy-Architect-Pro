// Groq client — OpenAI-compatible REST API via fetch().
// Public interface: getModel(lang) → { generateContent(prompt) }
// Drop-in for the old Gemini client; aiService.js needs no changes.

const API_BASE   = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL_NAME = process.env.GROQ_MODEL || 'llama-3.1-8b-instant';

const SYSTEM_INSTRUCTIONS = {
  ru: `Ты — аналитический помощник для трейдеров. Отвечай ТОЛЬКО на русском языке. НИКОГДА не давай торговых рекомендаций (buy/sell/hold). НИКОГДА не прогнозируй движение рынка. Ты только интерпретируешь уже посчитанные метрики. Если данных недостаточно — скажи это прямо. Отвечай ТОЛЬКО валидным JSON, без markdown, без обёртки в code blocks.`,
  en: `You are an analytical assistant for traders. Respond ONLY in English. NEVER give trading recommendations (buy/sell/hold). NEVER forecast market movements. You only interpret already-computed metrics. If there is insufficient data, say so directly. Respond ONLY with valid JSON, no markdown, no code blocks.`,
};

// One model-like object per language key — reused across requests.
const modelCache = new Map();

// ── Core fetch wrapper ───────────────────────────────────────────────────────

async function callGroq(apiKey, systemPrompt, userPrompt) {
  const response = await fetch(API_BASE, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({
      model:           MODEL_NAME,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userPrompt   },
      ],
      response_format: { type: 'json_object' },
      temperature:     0.2,
    }),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`Groq API ${response.status}: ${errText.slice(0, 300)}`);
  }

  const data    = await response.json();
  const content = data?.choices?.[0]?.message?.content;

  if (!content) throw new Error('Empty response from Groq');

  // Strip accidental markdown fences defensively.
  return content
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
}

// ── Public API ───────────────────────────────────────────────────────────────

export function getModel(lang = 'en') {
  const key = SYSTEM_INSTRUCTIONS[lang] ? lang : 'en';

  if (modelCache.has(key)) return modelCache.get(key);

  const systemPrompt = SYSTEM_INSTRUCTIONS[key];

  const model = {
    async generateContent(prompt) {
      // Read key on every call so a server restart with a new key just works.
      const apiKey = process.env.GROQ_API_KEY;
      if (!apiKey) throw new Error('GROQ_API_KEY is not configured');

      const text = await callGroq(apiKey, systemPrompt, prompt);

      // Return shape expected by aiService.js → geminiJSON():
      //   result.response.text()  →  raw JSON string
      return {
        response: { text: () => text },
      };
    },
  };

  modelCache.set(key, model);
  return model;
}
