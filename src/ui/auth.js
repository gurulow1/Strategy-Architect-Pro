// License-key authentication. No Firebase.
//
// Modes (determined by the backend at startup):
//   open    — LICENSE_KEYS not set → full access, no key needed
//   license — LICENSE_KEYS set     → 32-char hex key required; backend issues JWT
//
// Token lifecycle:
//   verifyKey(key, rememberMe) → POST /api/verify-license → JWT stored in localStorage
//   Token expiry: 24 h (default) or 7 d (rememberMe=true)
//   hasFullAccess() returns true when no license mode, or when token is valid

const TOKEN_KEY = 'sap_token';

let _mode = 'open';   // 'open' | 'license'
let _initDone = false;
const _subs = new Set();

// ── JWT client-side decode (no signature check — only for expiry inspection) ─
function decodePayload(token) {
  try {
    const b64 = token.split('.')[1];
    return JSON.parse(atob(b64.replace(/-/g, '+').replace(/_/g, '/')));
  } catch { return null; }
}

function isTokenValid() {
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) return false;
  const p = decodePayload(token);
  if (!p?.exp) return false;
  return p.exp * 1000 > Date.now() + 60_000; // 60 s grace buffer
}

// ── Public accessors ──────────────────────────────────────────────────────────
export function getToken() {
  return localStorage.getItem(TOKEN_KEY) || null;
}

export const isLicenseMode  = () => _mode === 'license';
export const hasFullAccess  = () => !isLicenseMode() || isTokenValid();

// Compatibility shims — kept so callers don't need simultaneous edits.
export const isFirebaseEnabled = () => false;
export const isDemoMode        = () => false;
export const canAccess         = (_feature) => hasFullAccess();

// ── Initialisation ────────────────────────────────────────────────────────────
export async function initAuth() {
  if (_initDone) return;
  _initDone = true;
  try {
    const res  = await fetch('/api/auth-mode');
    const data = await res.json();
    _mode = data.mode === 'license' ? 'license' : 'open';
  } catch {
    _mode = 'open'; // fallback so a cold server doesn't lock users out
  }
}

// ── Key verification ──────────────────────────────────────────────────────────
/**
 * Submit a license key. Stores the returned JWT in localStorage on success.
 * @param {string}  key        32-char hex string
 * @param {boolean} rememberMe true → 7-day token; false → 24-hour token
 * @throws {Error} user-facing message on failure
 */
export async function verifyKey(key, rememberMe = true) {
  const res = await fetch('/api/verify-license', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: key.trim(), rememberMe }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Verification failed');
  const { token } = data;
  if (!token) throw new Error('No token in response');
  localStorage.setItem(TOKEN_KEY, token);
  _notify();
}

// ── Sign-out ──────────────────────────────────────────────────────────────────
export function signOutUser() {
  localStorage.removeItem(TOKEN_KEY);
  _notify();
}

// ── Subscriptions ─────────────────────────────────────────────────────────────
export function onAuthChange(fn) {
  _subs.add(fn);
  return () => _subs.delete(fn);
}

function _notify() {
  const state = { hasFullAccess: hasFullAccess() };
  _subs.forEach((fn) => fn(state));
}
