// Telegram Bot API wrapper. Stateless — reads the token from env on each call,
// so the rest of the server never has to care whether Telegram is configured.
// Every function is a no-op (returns null) when TELEGRAM_BOT_TOKEN is unset.

const TG_BASE = 'https://api.telegram.org/bot';

export function isTelegramConfigured() {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN);
}

// Send a chat message. Returns the Telegram response JSON, or null if disabled.
export async function sendMessage(chatId, text, parseMode = 'HTML') {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || chatId == null) return null;
  try {
    const res = await fetch(`${TG_BASE}${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: parseMode, disable_web_page_preview: true }),
    });
    return await res.json().catch(() => null);
  } catch (_) {
    return null;
  }
}

// Long-poll updates (used only when no webhook is configured).
export async function getUpdates(offset = 0) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return [];
  try {
    const res = await fetch(`${TG_BASE}${token}/getUpdates?offset=${offset}&timeout=10`);
    const data = await res.json();
    return data.ok ? data.result : [];
  } catch (_) {
    return [];
  }
}

// Resolve the bot's @username (for "open bot" deep-links in the UI). Cached.
let _cachedUsername;
export async function getBotUsername() {
  if (_cachedUsername !== undefined) return _cachedUsername;
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) { _cachedUsername = null; return null; }
  try {
    const res = await fetch(`${TG_BASE}${token}/getMe`);
    const data = await res.json();
    _cachedUsername = data.ok ? data.result.username : null;
  } catch (_) {
    _cachedUsername = null;
  }
  return _cachedUsername;
}

// Register the webhook (idempotent). Call once at startup.
export async function setWebhook(url) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || !url) return null;
  try {
    const res = await fetch(`${TG_BASE}${token}/setWebhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    return await res.json().catch(() => null);
  } catch (_) {
    return null;
  }
}
