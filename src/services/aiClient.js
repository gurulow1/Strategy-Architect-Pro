// Thin client for the /api/ai backend.
// Auto-detects the current UI language and injects it into every request.

// URL resolution priority:
//   1. VITE_API_BASE env var (explicit override — set in Vercel/CI if needed)
//   2. Empty string in production builds → calls /api/ai relative to the
//      current domain; vercel.json rewrites that to the Railway backend.
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
};

// Stable per-browser session id, used by the server's per-session rate limiter.
// Generated once and persisted in localStorage; falls back to a transient id.
function sessionId() {
  try {
    let id = localStorage.getItem('sap_sid');
    if (!id) {
      id = (typeof crypto !== 'undefined' && crypto.randomUUID)
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      localStorage.setItem('sap_sid', id);
    }
    return id;
  } catch (_) {
    return 'anon';
  }
}

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

  const headers = { 'Content-Type': 'application/json', 'X-Session-Id': sessionId() };
  try { const tok = localStorage.getItem('sap_token'); if (tok) headers['Authorization'] = `Bearer ${tok}`; } catch (_) { /* no localStorage */ }

  try {
    response = await fetch(`${API_BASE}/api/ai`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ feature, payload: { ...payload, lang } }),
    });
  } catch (_) {
    throw new Error(FALLBACK.network[lang] || FALLBACK.network.en);
  }

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data?.error || FALLBACK.server[lang] || FALLBACK.server.en);
  }

  return data;
}
