// Firebase Auth with graceful demo-mode fallback.
//
// When VITE_FIREBASE_API_KEY is not set, the module boots in "open mode":
// no authentication required, all features accessible (dev / no-auth deploy).
//
// When Firebase IS configured:
//   authenticated user → full access
//   demo session       → Quick Check only; Journal capped at 5 trades; no AI chat
//   neither            → auth overlay shown; user must choose Demo or Sign In

const FB_ENABLED = Boolean(import.meta.env.VITE_FIREBASE_API_KEY);

let _auth = null;
let _user = null;   // Firebase User or null
let _demo = false;  // true = user chose "Try Demo"
const _subs = new Set();

// ── Public state ──────────────────────────────────────────────────────────────
export const isFirebaseEnabled = () => FB_ENABLED;
export const currentUser       = () => _user;
export const isAuthenticated   = () => Boolean(_user);
export const isDemoMode        = () => _demo;

/** True when the user may access everything (no Firebase, or logged in). */
export const hasFullAccess = () => !FB_ENABLED || Boolean(_user);

/**
 * Gate check for a specific feature.
 * @param {'quick'|'journal'|'robustness'|'prop'|'ai'} feature
 */
export function canAccess(feature) {
  if (!FB_ENABLED) return true;            // open mode: everything available
  if (_user)       return true;            // logged in: everything available
  if (_demo)       return feature === 'quick'; // demo: quick check only
  return false;                            // no auth, no demo: nothing yet
}

// ── Initialisation ────────────────────────────────────────────────────────────
let _initPromise = null;

export function initAuth() {
  if (_initPromise) return _initPromise;
  _initPromise = (async () => {
    if (!FB_ENABLED) return null;
    const [{ initializeApp }, { getAuth, onAuthStateChanged }] = await Promise.all([
      import('firebase/app'),
      import('firebase/auth'),
    ]);
    const app = initializeApp({
      apiKey:     import.meta.env.VITE_FIREBASE_API_KEY,
      authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
      projectId:  import.meta.env.VITE_FIREBASE_PROJECT_ID,
    });
    _auth = getAuth(app);
    // Resolve after the first auth-state emission (persisted session or null).
    return new Promise((resolve) => {
      const unsub = onAuthStateChanged(_auth, (user) => {
        _user = user;
        _demo = false;
        unsub();
        resolve(user);
        _notify();
        // After first resolution, keep listening for later sign-in / sign-out.
        onAuthStateChanged(_auth, (u) => { _user = u; _demo = false; _notify(); });
      });
    });
  })();
  return _initPromise;
}

// ── Auth operations ───────────────────────────────────────────────────────────
export async function signIn(email, password) {
  const { signInWithEmailAndPassword } = await import('firebase/auth');
  const cred = await signInWithEmailAndPassword(_auth, email.trim(), password);
  _user = cred.user; _demo = false; _notify();
  return _user;
}

export async function register(email, password) {
  const { createUserWithEmailAndPassword } = await import('firebase/auth');
  const cred = await createUserWithEmailAndPassword(_auth, email.trim(), password);
  _user = cred.user; _demo = false; _notify();
  return _user;
}

export async function signOutUser() {
  if (!_auth) return;
  const { signOut } = await import('firebase/auth');
  await signOut(_auth);
  _user = null; _demo = false; _notify();
}

export async function resetPassword(email) {
  const { sendPasswordResetEmail } = await import('firebase/auth');
  await sendPasswordResetEmail(_auth, email.trim());
}

export async function signInWithGoogle() {
  const { GoogleAuthProvider, signInWithPopup } = await import('firebase/auth');
  const cred = await signInWithPopup(_auth, new GoogleAuthProvider());
  _user = cred.user; _demo = false; _notify();
  return _user;
}

/** Enter demo mode: Quick Check only, 5-trade journal limit, no AI chat. */
export function startDemo() {
  _user = null; _demo = true; _notify();
}

// ── Subscriptions ─────────────────────────────────────────────────────────────
export function onAuthChange(fn) {
  _subs.add(fn);
  return () => _subs.delete(fn);
}

function _notify() {
  const state = { user: _user, demo: _demo, hasFullAccess: hasFullAccess() };
  _subs.forEach((fn) => fn(state));
}

// ── Firebase ID token (for future server-side verification) ───────────────────
export async function getIdToken() {
  if (!_user) return null;
  return _user.getIdToken();
}
