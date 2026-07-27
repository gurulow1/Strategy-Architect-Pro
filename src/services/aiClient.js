// Thin client for the /api/ai backend.
// Auto-detects the current UI language and injects it into every request.
import { getToken } from '../ui/auth.js';

// URL resolution priority:
//   1. VITE_API_BASE env var (required for the split Vercel + Railway release)
//   2. Empty string in other production builds → same-origin/self-hosted API.
//   3. http://localhost:3001 in Vite dev mode (import.meta.env.DEV === true).
const API_BASE = import.meta.env.VITE_API_BASE ?? (import.meta.env.DEV ? 'http://localhost:3001' : '');

// Read language from the same key i18n.js writes (localStorage 'sap_lang').
// Falls back through window.__i18n, the <html lang> attribute, then 'en'.
function currentLang() {
  try {
    const stored = localStorage.getItem('sap_lang');
    if (stored) return stored;
  } catch (_) { /* no localStorage */ }
  return (
    (typeof window !== 'undefined' && window.__i18n?.lang) ||
    document.documentElement.lang?.split('-')[0] ||
    'en'
  );
}

const FALLBACK = {
  network: { en: 'AI service unreachable.',              ru: 'AI сервис недоступен.' },
  server:  { en: 'AI service temporarily unavailable.', ru: 'AI сервис временно недоступен.' },
  quota:   { en: 'Daily AI limit reached. Try again tomorrow.', ru: 'Дневной лимит ИИ исчерпан. Попробуйте завтра.' },
};

/**
 * Call an AI feature on the backend.
 * Language is auto-detected from the UI; callers never set it manually.
 *
 * @param {string} feature  parseJournal | generateSummary | answerQuestion | explainWeaknesses
 * @param {object} payload  Feature payload (lang injected automatically)
 * @returns {Promise<object>}
 * @throws {Error} Network failure or non-2xx response
 */
export async function callAI(feature, payload) {
  const lang = currentLang();
  let response;

  const headers = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  try {
    response = await fetch(`${API_BASE}/api/ai`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ feature, payload: { ...payload, lang } }),
      signal: AbortSignal.timeout(35_000),
    });
  } catch (_) {
    throw new Error(FALLBACK.network[lang] || FALLBACK.network.en);
  }

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    if (data?.code === 'AI_DAILY_LIMIT') {
      throw new Error(FALLBACK.quota[lang] || FALLBACK.quota.en);
    }
    throw new Error(data?.error || FALLBACK.server[lang] || FALLBACK.server.en);
  }

  return data;
}
