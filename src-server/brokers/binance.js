import crypto from 'crypto';

// Binance Futures realized-PnL history → normalized trades.
// Read-only: hits /fapi/v1/income (incomeType=REALIZED_PNL). Spot PnL would
// require reconstructing positions from fills, so it's explicitly unsupported.
// API key/secret are passed per request and never stored or logged.

export async function fetchBinanceTrades({ apiKey, apiSecret, accountType = 'futures', daysBack = 90 } = {}) {
  if (!apiKey || !apiSecret) return { error: 'missing_credentials', trades: [] };
  if (accountType !== 'futures') return { error: 'spot_not_supported', trades: [] };

  const ts = Date.now();
  const startTime = ts - Math.max(1, daysBack) * 24 * 60 * 60 * 1000;
  const params = `incomeType=REALIZED_PNL&startTime=${startTime}&limit=1000&timestamp=${ts}&recvWindow=10000`;
  const signature = crypto.createHmac('sha256', apiSecret).update(params).digest('hex');
  const url = `https://fapi.binance.com/fapi/v1/income?${params}&signature=${signature}`;

  let res;
  try {
    res = await fetch(url, { headers: { 'X-MBX-APIKEY': apiKey } });
  } catch (_) {
    return { error: 'network_error', trades: [] };
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    return { error: err.msg || `HTTP ${res.status}`, trades: [] };
  }

  const data = await res.json().catch(() => []);
  if (!Array.isArray(data)) return { error: 'bad_response', trades: [] };

  const trades = data
    .filter((item) => item.incomeType === 'REALIZED_PNL' && parseFloat(item.income) !== 0)
    .map((item) => ({
      date: new Date(item.time).toISOString(),
      pnl: parseFloat(item.income),
      r: null,
      direction: null,        // income endpoint doesn't carry side
      symbol: item.symbol || null,
    }));

  return { error: null, trades, source: 'Binance Futures', count: trades.length };
}
