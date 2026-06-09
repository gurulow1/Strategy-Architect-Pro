// Gemini client — direct REST calls with an OAuth 2.0 Bearer token.
//
// The @google/generative-ai SDK only accepts API keys (AIza... format).
// Google AI Studio now issues OAuth 2.0 access tokens (AQ.*** format) that
// require an Authorization: Bearer header — so we call the REST API directly
// with fetch() instead of using the SDK.
//
// Public interface is unchanged: getModel(lang) returns an object with
// generateContent(prompt), compatible with aiService.js's geminiJSON() helper.

const API_BASE   = 'https://generativelanguage.googleapis.com/v1beta/models';
const MODEL_NAME = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

const SYSTEM_INSTRUCTIONS = {
  ru: `Ты — аналитический помощник для трейдеров. Отвечай ТОЛЬКО на русском языке. НИКОГДА не давай торговых рекомендаций (buy/sell/hold). НИКОГДА не прогнозируй движение рынка. Ты только интерпретируешь уже посчитанные метрики. Если данных недостаточно — скажи это прямо.`,
  en: `You are an analytical assistant for traders. Respond ONLY in English. NEVER give trading recommendations (buy/sell/hold). NEVER forecast market movements. You only interpret already-computed metrics. If there is insufficient data, say so directly.`,
};

// One model-like object per language key — reused across requests.
const modelCache = new Map();

// ── Core fetch wrapper ───────────────────────────────────────────────────────

async function callGemini(accessToken, systemPrompt, userPrompt) {
  const url = `${API_BASE}/${MODEL_NAME}:generateContent`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({
      // system_instruction is the v1beta REST field for system prompts.
      system_instruction: {
        parts: [{ text: systemPrompt }],
      },
      contents: [
        {
          role:  'user',
          parts: [{ text: userPrompt }],
        },
      ],
      generationConfig: {
        responseMimeType: 'application/json',
      },
    }),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`Gemini API ${response.status}: ${errText.slice(0, 300)}`);
  }

  const data = await response.json();
  // Standard v1beta response shape: candidates[0].content.parts[0].text
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!text) throw new Error('Empty response from Gemini API');
  return text;
}

// ── Public API ───────────────────────────────────────────────────────────────

export function getModel(lang = 'en') {
  const key = SYSTEM_INSTRUCTIONS[lang] ? lang : 'en';

  if (modelCache.has(key)) return modelCache.get(key);

  const systemPrompt = SYSTEM_INSTRUCTIONS[key];

  const model = {
    async generateContent(prompt) {
      // Read the token on every call — OAuth tokens expire (~1 h).
      // If the server is restarted with a fresh token it just works.
      const accessToken = process.env.GEMINI_API_KEY;
      if (!accessToken) throw new Error('GEMINI_API_KEY is not configured');

      const text = await callGemini(accessToken, systemPrompt, prompt);

      // Return shape expected by aiService.js → geminiJSON():
      //   result.response.text()  →  raw JSON string from the model
      return {
        response: { text: () => text },
      };
    },
  };

  modelCache.set(key, model);
  return model;
}
