// Gemini client via @google/generative-ai.
// Public interface: getModel(lang) → object with generateContent(prompt).
// Compatible with aiService.js's geminiJSON() helper without any changes there.

import { GoogleGenerativeAI } from '@google/generative-ai';

const MODEL_NAME = process.env.GEMINI_MODEL || 'gemini-3.1-flash';

const SYSTEM_INSTRUCTIONS = {
  ru: `Ты — аналитический помощник для трейдеров. Отвечай ТОЛЬКО на русском языке. НИКОГДА не давай торговых рекомендаций (buy/sell/hold). НИКОГДА не прогнозируй движение рынка. Ты только интерпретируешь уже посчитанные метрики. Если данных недостаточно — скажи это прямо.`,
  en: `You are an analytical assistant for traders. Respond ONLY in English. NEVER give trading recommendations (buy/sell/hold). NEVER forecast market movements. You only interpret already-computed metrics. If there is insufficient data, say so directly.`,
};

// One model instance per language — reused across requests.
const modelCache = new Map();

export function getModel(lang = 'en') {
  const key = SYSTEM_INSTRUCTIONS[lang] ? lang : 'en';

  if (modelCache.has(key)) return modelCache.get(key);

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is not configured');

  const genAI = new GoogleGenerativeAI(apiKey);

  // apiVersion:'v1' — stable 1.x models live on the v1 endpoint.
  // Without this the SDK defaults to v1beta, which returns 404 for gemini-1.5-*.
  const model = genAI.getGenerativeModel({
    model: MODEL_NAME,
    systemInstruction: SYSTEM_INSTRUCTIONS[key],
    generationConfig: {
      responseMimeType: 'application/json',
    },
  }, {
    apiVersion: 'v1beta'
  });

  modelCache.set(key, model);
  return model;
}
