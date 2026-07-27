// License-key authentication. No Firebase.
//
// Modes (determined by the backend at startup):
//   open    — development-only full access
//   license — one trial run or a server-verified activation key
//
// Token lifecycle:
//   verifyKey(key, rememberMe) → POST /api/verify-license → JWT stored per session/persistently
//   License token expiry: 12 h (session) or 7 d (rememberMe=true)
//   Trial token expiry: 2 h; the first completed workflow consumes the trial

const TOKEN_KEY = 'sap_token';
const DEVICE_KEY = 'sap_device_id';
const API_BASE = import.meta.env.VITE_API_BASE ?? (import.meta.env.DEV ? 'http://localhost:3001' : '');

let _mode = 'unknown';   // 'unknown' | 'open' | 'license' | 'error'
let _initDone = false;
let _trialAvailable = false;
let _trialMarked = false;
let _accessVerified = false;
const _subs = new Set();

function storage(name) {
  try { return globalThis[name] || null; } catch { return null; }
}

function readStoredToken(store) {
  try { return store?.getItem(TOKEN_KEY) || null; } catch { return null; }
}

function clearStoredToken(store) {
  try { store?.removeItem(TOKEN_KEY); } catch { /* storage unavailable */ }
}

// ── JWT client-side decode (no signature check — only for expiry inspection) ─
function decodePayload(token) {
  try {
    const b64 = token.split('.')[1];
    const normalized = b64.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
    return JSON.parse(atob(padded));
  } catch { return null; }
}

function tokenIsValid(token) {
  if (!token) return false;
  const p = decodePayload(token);
  if (!p?.exp) return false;
  return p.exp * 1000 > Date.now() + 60_000; // 60 s grace buffer
}

function accessType() {
  return decodePayload(getToken())?.type || null;
}

export function getDeviceId() {
  const store = storage('localStorage');
  let id = null;
  try { id = store?.getItem(DEVICE_KEY) || null; } catch { id = null; }
  if (!id) {
    id = globalThis.crypto?.randomUUID?.()
      || `device-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    try { store?.setItem(DEVICE_KEY, id); } catch { /* soft trial identity */ }
  }
  return id;
}

// ── Public accessors ──────────────────────────────────────────────────────────
export function getToken() {
  const sessionToken = readStoredToken(storage('sessionStorage'));
  if (tokenIsValid(sessionToken)) return sessionToken;
  const persistentToken = readStoredToken(storage('localStorage'));
  return tokenIsValid(persistentToken) ? persistentToken : null;
}

// Unknown/error states stay locked; only an explicit backend "open" response
// grants access without a verified token.
export const isLicenseMode  = () => _mode !== 'open';
export const hasFullAccess  = () => _mode === 'open'
  || (_mode === 'license' && _accessVerified && ['license', 'trial'].includes(accessType()));
export const hasLicenseAccess = () => _mode === 'open'
  || (_accessVerified && accessType() === 'license');
export const hasTrialAccess = () => _accessVerified && accessType() === 'trial';
export const isTrialAvailable = () => _trialAvailable;

// Compatibility shims — kept so callers don't need simultaneous edits.
export const isFirebaseEnabled = () => false;
export const isDemoMode        = () => hasTrialAccess();
export const canAccess         = (_feature) => hasFullAccess();

// ── Initialisation ────────────────────────────────────────────────────────────
export async function initAuth() {
  if (_initDone) return;
  _initDone = true;
  try {
    const res  = await fetch(`${API_BASE}/api/auth-mode`, { signal: AbortSignal.timeout(8_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.mode !== 'open' && data.mode !== 'license') throw new Error('Invalid auth mode');
    _mode = data.mode;
    _accessVerified = data.mode === 'open';
    _trialAvailable = Boolean(data.trial?.enabled);

    const token = getToken();
    if (token) {
      const session = await fetch(`${API_BASE}/api/session`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(8_000),
      });
      const state = await session.json().catch(() => ({}));
      if (!session.ok || !state.authenticated) {
        clearStoredToken(storage('localStorage'));
        clearStoredToken(storage('sessionStorage'));
      } else {
        _accessVerified = true;
      }
    }
  } catch {
    _mode = 'error';
    _trialAvailable = false;
    _accessVerified = false;
  }
}

// ── Key verification ──────────────────────────────────────────────────────────
/**
 * Submit a license key. Stores the returned JWT in sessionStorage/localStorage.
 * @param {string}  key        Short formatted activation key (legacy keys also work)
 * @param {boolean} rememberMe true → 7-day token; false → 12-hour token
 * @throws {Error} user-facing message on failure
 */
export async function verifyKey(key, rememberMe = true) {
  const res = await fetch(`${API_BASE}/api/verify-license`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: key.trim(), rememberMe }),
    credentials: 'include',
    signal: AbortSignal.timeout(12_000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Verification failed');
  const { token } = data;
  if (!tokenIsValid(token)) throw new Error('Invalid token in response');
  const target = storage(rememberMe ? 'localStorage' : 'sessionStorage');
  if (!target) throw new Error('Browser storage unavailable');
  try {
    target.setItem(TOKEN_KEY, token);
  } catch {
    throw new Error('Browser storage unavailable');
  }
  clearStoredToken(storage(rememberMe ? 'sessionStorage' : 'localStorage'));
  _mode = 'license';
  _accessVerified = true;
  _trialMarked = false;
  _notify();
}

export async function startTrial() {
  const res = await fetch(`${API_BASE}/api/trial/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceId: getDeviceId() }),
    credentials: 'include',
    signal: AbortSignal.timeout(12_000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Trial could not be started');
  if (!tokenIsValid(data.token)) throw new Error('Invalid trial token');
  const target = storage('sessionStorage');
  if (!target) throw new Error('Browser storage unavailable');
  target.setItem(TOKEN_KEY, data.token);
  clearStoredToken(storage('localStorage'));
  _mode = data.access === 'open' ? 'open' : 'license';
  _accessVerified = true;
  _trialMarked = false;
  _notify();
}

export async function completeTrial() {
  if (!hasTrialAccess() || _trialMarked) return;
  const token = getToken();
  try {
    const response = await fetch(`${API_BASE}/api/trial/complete`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: '{}',
      credentials: 'include',
      signal: AbortSignal.timeout(8_000),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok !== true) {
      throw new Error(data.error || 'Trial could not be completed');
    }
    _trialMarked = true;
  } catch (error) {
    // Fail closed: the server may have consumed the one-time session even if
    // the response was lost. A fresh /start can only resume the original TTL.
    clearStoredToken(storage('sessionStorage'));
    _accessVerified = false;
    _notify();
    throw error;
  }
}

// ── Sign-out ──────────────────────────────────────────────────────────────────
export function signOutUser() {
  clearStoredToken(storage('localStorage'));
  clearStoredToken(storage('sessionStorage'));
  _trialMarked = false;
  _accessVerified = false;
  _notify();
}

// ── Subscriptions ─────────────────────────────────────────────────────────────
export function onAuthChange(fn) {
  _subs.add(fn);
  return () => _subs.delete(fn);
}

function _notify() {
  const state = {
    hasFullAccess: hasFullAccess(),
    hasLicenseAccess: hasLicenseAccess(),
    hasTrialAccess: hasTrialAccess(),
  };
  _subs.forEach((fn) => fn(state));
}
