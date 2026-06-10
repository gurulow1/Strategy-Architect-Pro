import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import os from 'os';
import path from 'path';
import { fetchBinanceTrades } from '../src-server/brokers/binance.js';
import { fetchBybitTrades } from '../src-server/brokers/bybit.js';
import { storeMTData, getMTData } from '../src-server/brokers/metatrader.js';

// ── Telegram link store (file path redirected to a temp file) ────────────────
describe('telegram store', () => {
  let store;
  beforeAll(async () => {
    process.env.TG_STORE_PATH = path.join(os.tmpdir(), `tg-test-${Date.now()}.json`);
    store = await import('../src-server/telegramStore.js');
  });

  it('links a chat id via a one-time code', () => {
    const code = store.createLinkCode('acct-1');
    expect(typeof code).toBe('string');
    expect(store.linkByCode(code, 555)).toBe('acct-1');
    expect(store.getChatId('acct-1')).toBe(555);
    expect(store.hasLinked('acct-1')).toBe(true);
  });

  it('rejects an unknown or reused code', () => {
    const code = store.createLinkCode('acct-2');
    store.linkByCode(code, 777);
    expect(store.linkByCode(code, 888)).toBeNull(); // already consumed
    expect(store.linkByCode('NOPE12', 1)).toBeNull();
  });

  it('unlinks and exposes a chatId map for /stop lookups', () => {
    store.createLinkCode('acct-3');
    const c = store.createLinkCode('acct-3');
    store.linkByCode(c, 999);
    const pairs = [...store.getChatIdMap()];
    expect(pairs.some(([k, v]) => k === 'acct-3' && v === 999)).toBe(true);
    store.unlinkKey('acct-3');
    expect(store.getChatId('acct-3')).toBeNull();
  });
});

// ── Broker connectors (network mocked) ───────────────────────────────────────
describe('broker connectors', () => {
  const realFetch = global.fetch;
  afterEach(() => { global.fetch = realFetch; vi.restoreAllMocks(); });

  it('binance: requires credentials', async () => {
    const r = await fetchBinanceTrades({ apiKey: '', apiSecret: '' });
    expect(r.error).toBe('missing_credentials');
  });

  it('binance: rejects spot', async () => {
    const r = await fetchBinanceTrades({ apiKey: 'k', apiSecret: 's', accountType: 'spot' });
    expect(r.error).toBe('spot_not_supported');
  });

  it('binance: normalizes realized-PnL income, dropping zero/non-PnL rows', async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ([
        { incomeType: 'REALIZED_PNL', income: '12.5', time: 1700000000000, symbol: 'BTCUSDT' },
        { incomeType: 'REALIZED_PNL', income: '0', time: 1700000001000, symbol: 'BTCUSDT' },
        { incomeType: 'COMMISSION', income: '-1', time: 1700000002000, symbol: 'BTCUSDT' },
      ]),
    }));
    const r = await fetchBinanceTrades({ apiKey: 'k', apiSecret: 's', daysBack: 30 });
    expect(r.error).toBeNull();
    expect(r.trades).toHaveLength(1);
    expect(r.trades[0]).toMatchObject({ pnl: 12.5, symbol: 'BTCUSDT', r: null });
    expect(r.source).toBe('Binance Futures');
  });

  it('bybit: maps closed-pnl and infers position side from closing order', async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ retCode: 0, result: { list: [
        { updatedTime: '1700000000000', closedPnl: '5', side: 'Sell', symbol: 'ETHUSDT' },
        { updatedTime: '1700000001000', closedPnl: '0', side: 'Buy', symbol: 'ETHUSDT' },
      ] } }),
    }));
    const r = await fetchBybitTrades({ apiKey: 'k', apiSecret: 's' });
    expect(r.error).toBeNull();
    expect(r.trades).toHaveLength(1);
    expect(r.trades[0]).toMatchObject({ pnl: 5, direction: 'long', symbol: 'ETHUSDT' });
  });

  it('bybit: surfaces API error codes', async () => {
    global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ retCode: 10003, retMsg: 'bad key' }) }));
    const r = await fetchBybitTrades({ apiKey: 'k', apiSecret: 's' });
    expect(r.error).toBe('bad key');
  });

  it('metatrader store normalizes and drops non-numeric pnl', () => {
    const n = storeMTData('42', [
      { date: '2026.01.01 10:00', pnl: 10, symbol: 'BTCUSD', direction: 'long' },
      { date: 'x', pnl: 'NaNval', symbol: 'X', direction: 'weird' },
    ]);
    expect(n).toBe(1);
    const data = getMTData('42');
    expect(data.trades).toHaveLength(1);
    expect(data.trades[0]).toMatchObject({ pnl: 10, direction: 'long', r: null });
  });
});
