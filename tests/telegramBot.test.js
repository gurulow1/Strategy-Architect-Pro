import { afterEach, describe, expect, it, vi } from 'vitest';
import { sendMessage, setWebhook } from '../src-server/telegramBot.js';

const originalToken = process.env.TELEGRAM_BOT_TOKEN;

afterEach(() => {
  if (originalToken === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
  else process.env.TELEGRAM_BOT_TOKEN = originalToken;
  vi.unstubAllGlobals();
});

describe('Telegram Bot API', () => {
  it('registers the webhook with a secret and a network timeout', async () => {
    process.env.TELEGRAM_BOT_TOKEN = '123:test-token';
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, result: true }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    await setWebhook('https://api.example.test/api/telegram/webhook', 'secret_token_1234567890123456789');

    const [, options] = fetchMock.mock.calls[0];
    expect(JSON.parse(options.body)).toEqual({
      url: 'https://api.example.test/api/telegram/webhook',
      secret_token: 'secret_token_1234567890123456789',
    });
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  it('rejects a failed webhook registration', async () => {
    process.env.TELEGRAM_BOT_TOKEN = '123:test-token';
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 502,
      json: async () => ({ ok: false }),
    })));

    await expect(setWebhook('https://api.example.test/hook', 's'.repeat(40)))
      .rejects.toThrow(/setWebhook failed/);
  });

  it('does not report a failed message delivery as successful', async () => {
    process.env.TELEGRAM_BOT_TOKEN = '123:test-token';
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ ok: false, description: 'chat not found' }),
    })));

    await expect(sendMessage(123, 'test')).rejects.toThrow(/sendMessage failed/);
  });
});
