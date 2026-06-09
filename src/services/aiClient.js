// Thin client for the /api/ai backend.
// Auto-detects the current UI language and injects it into every request.

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:3001';

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

  try {
    response = await fetch(`${API_BASE}/api/ai`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
