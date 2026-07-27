// Thin client for the non-AI backend endpoints (integrations probe, Telegram,
// broker import). Mirrors aiClient.js's URL + auth conventions so dev/prod and
// license-mode auth behave identically across the app.
import { getToken } from '../ui/auth.js';

const API_BASE = import.meta.env.VITE_API_BASE ?? (import.meta.env.DEV ? 'http://localhost:3001' : '');

function headers() {
  const h = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

export async function apiPost(path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(body || {}),
    signal: AbortSignal.timeout(30_000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data;
}

export async function apiGet(path) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: headers(),
    signal: AbortSignal.timeout(15_000),
  });
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
