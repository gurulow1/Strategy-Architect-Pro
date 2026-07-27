import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { escapeAttr, escapeHtml, safeExternalUrl } from '../src/ui/safeDom.js';

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
}

function jwt(expOffsetSeconds = 3600, type = 'license') {
  const payload = Buffer.from(JSON.stringify({
    exp: Math.floor(Date.now() / 1000) + expOffsetSeconds,
    type,
  })).toString('base64url');
  return `header.${payload}.signature`;
}

describe('safe DOM helpers', () => {
  it('escapes executable markup and quoted attributes', () => {
    const attack = `"><img src=x onerror="globalThis.pwned=1">&'`;
    expect(escapeHtml(attack)).toBe(
      '&quot;&gt;&lt;img src=x onerror=&quot;globalThis.pwned=1&quot;&gt;&amp;&#39;',
    );
    expect(escapeAttr(attack)).toBe(escapeHtml(attack));
  });

  it('allows only HTTPS URLs from an explicit host allowlist', () => {
    expect(safeExternalUrl('javascript:alert(1)', { allowedHosts: ['t.me'] })).toBeNull();
    expect(safeExternalUrl('https://evil.test/', { allowedHosts: ['t.me'] })).toBeNull();
    expect(safeExternalUrl('https://t.me/example?start=a b', { allowedHosts: ['t.me'] }))
      .toBe('https://t.me/example?start=a%20b');
  });
});

describe('auth security', () => {
  let local;
  let session;

  beforeEach(() => {
    vi.resetModules();
    local = memoryStorage();
    session = memoryStorage();
    vi.stubGlobal('localStorage', local);
    vi.stubGlobal('sessionStorage', session);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('stays locked when auth-mode cannot be verified', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const auth = await import('../src/ui/auth.js');

    await auth.initAuth();

    expect(auth.isLicenseMode()).toBe(true);
    expect(auth.hasFullAccess()).toBe(false);
  });

  it('recovers from an auth-mode outage after the server verifies a key', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const auth = await import('../src/ui/auth.js');
    await auth.initAuth();

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ token: jwt() }),
    }));
    await auth.verifyKey('ABCD-EFGH-JKMP-QRST-VWXY', false);

    expect(auth.hasFullAccess()).toBe(true);
    expect(session.getItem('sap_token')).toBe(auth.getToken());
    expect(fetch.mock.calls[0][1].credentials).toBe('include');
    expect(JSON.parse(fetch.mock.calls[0][1].body)).not.toHaveProperty('deviceId');
  });

  it('stores a trial token for the current browser session only', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ mode: 'license', trial: { enabled: true } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ token: jwt(7200, 'trial'), access: 'trial' }),
      });
    vi.stubGlobal('fetch', fetchMock);
    const auth = await import('../src/ui/auth.js');

    await auth.initAuth();
    await auth.startTrial();

    expect(auth.hasTrialAccess()).toBe(true);
    expect(auth.hasFullAccess()).toBe(true);
    expect(local.getItem('sap_token')).toBeNull();
    expect(session.getItem('sap_token')).toBe(auth.getToken());
    expect(fetchMock.mock.calls[1][1].credentials).toBe('include');
  });

  it('fails closed when trial completion cannot be confirmed by the server', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ mode: 'license', trial: { enabled: true } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ token: jwt(7200, 'trial'), access: 'trial' }),
      })
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: 'Trial state unavailable' }),
      });
    vi.stubGlobal('fetch', fetchMock);
    const auth = await import('../src/ui/auth.js');

    await auth.initAuth();
    await auth.startTrial();
    await expect(auth.completeTrial()).rejects.toThrow('Trial state unavailable');

    expect(auth.getToken()).toBeNull();
    expect(auth.hasFullAccess()).toBe(false);
    expect(fetchMock.mock.calls[2][1].credentials).toBe('include');
  });

  it('keeps an existing persistent token only after server verification', async () => {
    const legacyToken = jwt();
    local.setItem('sap_token', legacyToken);
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ mode: 'license' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ authenticated: true, type: 'license' }),
      }));
    const auth = await import('../src/ui/auth.js');

    await auth.initAuth();

    expect(auth.getToken()).toBe(legacyToken);
    expect(auth.hasFullAccess()).toBe(true);
  });

  it('uses session storage unless remember-me is enabled and clears both on logout', async () => {
    const sessionToken = jwt();
    const persistentToken = jwt(7200);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ mode: 'license' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ token: sessionToken }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ token: persistentToken }) });
    vi.stubGlobal('fetch', fetchMock);
    const auth = await import('../src/ui/auth.js');

    await auth.initAuth();
    await auth.verifyKey('temporary', false);
    expect(session.getItem('sap_token')).toBe(sessionToken);
    expect(local.getItem('sap_token')).toBeNull();
    expect(auth.getToken()).toBe(sessionToken);

    await auth.verifyKey('remembered', true);
    expect(local.getItem('sap_token')).toBe(persistentToken);
    expect(session.getItem('sap_token')).toBeNull();
    expect(auth.getToken()).toBe(persistentToken);

    auth.signOutUser();
    expect(local.getItem('sap_token')).toBeNull();
    expect(session.getItem('sap_token')).toBeNull();
  });
});
