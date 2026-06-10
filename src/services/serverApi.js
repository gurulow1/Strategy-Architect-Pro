// Thin client for the non-AI backend endpoints (integrations probe, Telegram,
// broker import). Mirrors aiClient.js's URL + auth conventions so dev/prod and
// license-mode auth behave identically across the app.

const API_BASE = import.meta.env.VITE_API_BASE ?? (import.meta.env.DEV ? 'http://localhost:3001' : '');

// Stable, opaque per-browser id reused as the Telegram "account key" — we never
// store the raw license key. Same key aiClient.js uses for rate limiting.
export function accountKey() {
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

function headers() {
  const h = { 'Content-Type': 'application/json' };
  try { const t = localStorage.getItem('sap_token'); if (t) h.Authorization = `Bearer ${t}`; } catch (_) { /* none */ }
  return h;
}

export async function apiPost(path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST', headers: headers(), body: JSON.stringify(body || {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data;
}

export async function apiGet(path) {
  const res = await fetch(`${API_BASE}${path}`, { headers: headers() });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data;
}

// Cached integrations probe (which features the server has configured).
let _integrations;
export async function getIntegrations() {
  if (_integrations) return _integrations;
  try {
    _integrations = await apiGet('/api/integrations');
  } catch (_) {
    _integrations = { telegram: { enabled: false, botUsername: null }, brokers: {} };
  }
  return _integrations;
}

export { API_BASE };
