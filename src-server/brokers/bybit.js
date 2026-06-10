import crypto from 'crypto';

// Bybit v5 closed-PnL history → normalized trades.
// Uses /v5/position/closed-pnl (linear/USDT perps), which returns realized PnL
// per closed position — exactly the per-trade series we want.
// Read-only; credentials are passed per request and never stored or logged.

const RECV_WINDOW = '5000';

export async function fetchBybitTrades({ apiKey, apiSecret, daysBack = 90 } = {}) {
  if (!apiKey || !apiSecret) return { error: 'missing_credentials', trades: [] };

  const ts = Date.now().toString();
  const startTime = Date.now() - Math.max(1, daysBack) * 24 * 60 * 60 * 1000;
  const query = `category=linear&limit=200&startTime=${startTime}`;
  // v5 GET signature: timestamp + apiKey + recvWindow + queryString
  const sign = crypto.createHmac('sha256', apiSecret)
    .update(`${ts}${apiKey}${RECV_WINDOW}${query}`).digest('hex');

  const url = `https://api.bybit.com/v5/position/closed-pnl?${query}`;
  let res;
  try {
    res = await fetch(url, {
      headers: {
        'X-BAPI-API-KEY': apiKey,
        'X-BAPI-TIMESTAMP': ts,
        'X-BAPI-SIGN': sign,
        'X-BAPI-RECV-WINDOW': RECV_WINDOW,
      },
    });
  } catch (_) {
    return { error: 'network_error', trades: [] };
  }
  if (!res.ok) return { error: `HTTP ${res.status}`, trades: [] };

  const data = await res.json().catch(() => ({}));
  if (data.retCode !== 0) return { error: data.retMsg || 'bybit_error', trades: [] };

  const trades = (data.result?.list || [])
    .map((item) => ({
      date: new Date(parseInt(item.updatedTime || item.createdTime, 10)).toISOString(),
      pnl: parseFloat(item.closedPnl || 0),
      r: null,
      // Bybit reports the side of the CLOSING order; the position side is the opposite.
      direction: item.side === 'Sell' ? 'long' : 'short',
      symbol: item.symbol || null,
    }))
    .filter((t) => Number.isFinite(t.pnl) && t.pnl !== 0);

  return { error: null, trades, source: 'Bybit', count: trades.length };
}
