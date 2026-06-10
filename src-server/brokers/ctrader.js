// cTrader Open API v2 — OAuth 2.0 flow + closed-deal history.
// Requires CTRADER_CLIENT_ID / CTRADER_CLIENT_SECRET in env. The access token
// lives only in the browser (URL hash → memory), never on the server.

const CTRADER_AUTH_URL = 'https://connect.ctrader.com/oauth/authorize';
const CTRADER_TOKEN_URL = 'https://connect.ctrader.com/oauth/token';
const CTRADER_API_BASE = 'https://api.spotware.com/connect';

export function isCTraderConfigured() {
  return Boolean(process.env.CTRADER_CLIENT_ID && process.env.CTRADER_CLIENT_SECRET);
}

export function getAuthUrl(redirectUri, state) {
  const params = new URLSearchParams({
    client_id: process.env.CTRADER_CLIENT_ID || '',
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'accounts',
    state,
  });
  return `${CTRADER_AUTH_URL}?${params}`;
}

export async function exchangeCode(code, redirectUri) {
  const res = await fetch(CTRADER_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: process.env.CTRADER_CLIENT_ID || '',
      client_secret: process.env.CTRADER_CLIENT_SECRET || '',
    }),
  });
  return res.json().catch(() => ({}));
}

export async function fetchCTraderTrades(accessToken, accountId, daysBack = 90) {
  if (!accessToken || !accountId) return { error: 'missing_params', trades: [] };
  const from = Date.now() - Math.max(1, daysBack) * 24 * 60 * 60 * 1000;
  const url = `${CTRADER_API_BASE}/accounts/${accountId}/history?from=${from}&to=${Date.now()}`;

  let res;
  try {
    res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  } catch (_) {
    return { error: 'network_error', trades: [] };
  }
  if (!res.ok) return { error: `HTTP ${res.status}`, trades: [] };

  const data = await res.json().catch(() => ({}));
  const trades = (data.deal || [])
    .filter((d) => d.closingOrder)
    .map((d) => ({
      date: new Date(d.closeTimestamp).toISOString(),
      pnl: (Number(d.grossProfit) || 0) / 100, // cTrader returns money in cents
      r: null,
      direction: d.tradeSide === 'BUY' ? 'long' : 'short',
      symbol: d.symbolName || null,
    }))
    .filter((t) => Number.isFinite(t.pnl) && t.pnl !== 0);

  return { error: null, trades, source: 'cTrader', count: trades.length };
}
