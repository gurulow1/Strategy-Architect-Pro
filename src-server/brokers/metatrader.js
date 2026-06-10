// MetaTrader has no public REST API — the only path is an Expert Advisor (EA)
// running in the user's terminal that pushes closed-deal history to us.
// This module is the server-side inbox: the EA POSTs to /api/broker/mt/push,
// the frontend later pulls the latest snapshot via /api/broker/mt/fetch.
//
// Stored in memory only, keyed by MT account id. No credentials involved.

const mtStore = new Map(); // accountId(string) → { trades, updatedAt, source }

// Normalize whatever the EA sent into the app's trade shape, dropping junk.
function normalize(trades) {
  if (!Array.isArray(trades)) return [];
  return trades
    .map((t) => ({
      date: t.date ?? null,
      pnl: Number(t.pnl),
      r: null,
      direction: t.direction === 'long' || t.direction === 'short' ? t.direction : null,
      symbol: t.symbol ?? null,
    }))
    .filter((t) => Number.isFinite(t.pnl));
}

export function storeMTData(accountId, trades) {
  const clean = normalize(trades);
  mtStore.set(String(accountId), { trades: clean, updatedAt: Date.now(), source: 'MetaTrader' });
  return clean.length;
}

export function getMTData(accountId) {
  return mtStore.get(String(accountId)) || null;
}
