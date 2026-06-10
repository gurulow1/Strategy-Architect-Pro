// In-memory map of accountKey ↔ Telegram chatId, with JSON file persistence so
// links survive a server restart. `accountKey` is an opaque, stable per-client
// id supplied by the frontend (we never store the raw license key here).
//
// Also holds short-lived one-time link codes (TTL 10 min) used to bind a
// Telegram chat to an account via the bot's /start <code> command.

import { readFileSync, writeFileSync, existsSync } from 'fs';

const STORE_PATH = process.env.TG_STORE_PATH || './tg-store.json';
const store = new Map();        // accountKey → chatId
const pendingCodes = new Map(); // CODE → { accountKey, expires }
const CODE_TTL_MS = 10 * 60 * 1000;

function persist() {
  try {
    writeFileSync(STORE_PATH, JSON.stringify(Object.fromEntries(store)));
  } catch (_) { /* best-effort — a read-only FS shouldn't crash the server */ }
}

function load() {
  if (!existsSync(STORE_PATH)) return;
  try {
    const obj = JSON.parse(readFileSync(STORE_PATH, 'utf8'));
    for (const [k, v] of Object.entries(obj)) store.set(k, v);
  } catch (_) { /* corrupt file — start empty */ }
}

load();

// Drop expired pending codes so the Map can't grow unbounded.
function prunePending() {
  const now = Date.now();
  for (const [code, entry] of pendingCodes) {
    if (now > entry.expires) pendingCodes.delete(code);
  }
}

// Create a one-time code (e.g. "A3K9XZ") that the user sends to the bot.
export function createLinkCode(accountKey) {
  prunePending();
  let code;
  do { code = Math.random().toString(36).slice(2, 8).toUpperCase(); }
  while (pendingCodes.has(code));
  pendingCodes.set(code, { accountKey, expires: Date.now() + CODE_TTL_MS });
  return code;
}

// Bind a chatId to the account that owns `code`. Returns accountKey or null.
export function linkByCode(code, chatId) {
  if (!code) return null;
  prunePending();
  const entry = pendingCodes.get(String(code).toUpperCase());
  if (!entry || Date.now() > entry.expires) return null;
  store.set(entry.accountKey, chatId);
  pendingCodes.delete(String(code).toUpperCase());
  persist();
  return entry.accountKey;
}

export function getChatId(accountKey) {
  return accountKey != null && store.has(accountKey) ? store.get(accountKey) : null;
}

export function hasLinked(accountKey) { return store.has(accountKey); }

export function unlinkKey(accountKey) {
  if (store.delete(accountKey)) persist();
}

// Iterator over [accountKey, chatId] pairs — used to unlink by chatId (/stop).
export function getChatIdMap() { return store.entries(); }
