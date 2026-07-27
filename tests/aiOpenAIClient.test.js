import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getOpenAIProviderStatus,
  probeOpenAIProvider,
  requestStructuredResponse,
  resolveAIProvider,
} from '../src-server/openaiClient.js';

const TEST_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: { answer: { type: 'string' } },
  required: ['answer'],
};

function response(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(payload),
    text: vi.fn().mockResolvedValue(JSON.stringify(payload)),
  };
}

function completed(json = { answer: 'ok' }) {
  return {
    status: 'completed',
    output: [{
      type: 'message',
      content: [{ type: 'output_text', text: JSON.stringify(json) }],
    }],
  };
}

function request(overrides = {}) {
  return requestStructuredResponse({
    system: 'system rules',
    user: '{"question":"data"}',
    schemaName: 'test_answer',
    schema: TEST_SCHEMA,
    maxOutputTokens: 321,
    retryDelayMs: 0,
    ...overrides,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_BASE_URL;
  delete process.env.OPENAI_MODEL;
});

describe('OpenAI Responses client', () => {
  it('probes configured model access without an inference request', async () => {
    process.env.OPENAI_API_KEY = 'sk-test-only';
    process.env.OPENAI_MODEL = 'gpt-5-mini';
    const fetchMock = vi.fn().mockResolvedValue(response({ id: 'gpt-5-mini' }));

    await expect(probeOpenAIProvider({ fetchImpl: fetchMock })).resolves.toMatchObject({
      state: 'ready',
      httpStatus: 200,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.openai.com/v1/models/gpt-5-mini',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(getOpenAIProviderStatus().state).toBe('ready');
  });

  it.each([
    [401, 'invalid_credentials'],
    [404, 'invalid_model'],
    [503, 'unavailable'],
  ])('classifies provider probe HTTP %s as %s', async (status, state) => {
    process.env.OPENAI_API_KEY = 'sk-test-only';
    const fetchMock = vi.fn().mockResolvedValue(response({}, status));
    await expect(probeOpenAIProvider({ fetchImpl: fetchMock })).resolves.toMatchObject({
      state,
      httpStatus: status,
    });
  });

  it('auto-detects an OpenRouter key and uses its Responses API model slug', async () => {
    process.env.OPENAI_API_KEY = 'sk-or-v1-test-only';
    const fetchMock = vi.fn().mockResolvedValue(response(completed()));
    vi.stubGlobal('fetch', fetchMock);

    await expect(request()).resolves.toEqual({ answer: 'ok' });
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('https://openrouter.ai/api/v1/responses');
    expect(JSON.parse(options.body).model).toBe('openai/gpt-5-mini');
  });

  it('checks both the OpenRouter key and selected model without inference', async () => {
    process.env.OPENAI_API_KEY = 'sk-or-v1-test-only';
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ data: { label: 'masked' } }))
      .mockResolvedValueOnce(response({ data: { id: 'openai/gpt-5-mini' } }));

    await expect(probeOpenAIProvider({ fetchImpl: fetchMock })).resolves.toMatchObject({
      state: 'ready',
      provider: 'openrouter',
      model: 'openai/gpt-5-mini',
    });
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'https://openrouter.ai/api/v1/key',
      'https://openrouter.ai/api/v1/model/openai/gpt-5-mini',
    ]);
  });

  it('rejects arbitrary API bases before sending a secret', async () => {
    process.env.OPENAI_API_KEY = 'sk-test-only';
    process.env.OPENAI_BASE_URL = 'https://evil.example.test/v1';
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    expect(() => resolveAIProvider()).toThrow(/approved OpenAI or OpenRouter/);
    await expect(request()).rejects.toThrow(/approved OpenAI or OpenRouter/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends the required Responses API contract and parses output_text', async () => {
    process.env.OPENAI_API_KEY = 'sk-test-only';
    const fetchMock = vi.fn().mockResolvedValue(response(completed()));
    vi.stubGlobal('fetch', fetchMock);

    await expect(request()).resolves.toEqual({ answer: 'ok' });

    const [url, options] = fetchMock.mock.calls[0];
    const body = JSON.parse(options.body);
    expect(url).toBe('https://api.openai.com/v1/responses');
    expect(options.method).toBe('POST');
    expect(options.signal).toBeInstanceOf(AbortSignal);
    expect(body).toMatchObject({
      model: 'gpt-5-mini',
      store: false,
      input: [
        { role: 'system', content: 'system rules' },
        { role: 'user', content: '{"question":"data"}' },
      ],
      max_output_tokens: 321,
      text: {
        format: {
          type: 'json_schema',
          name: 'test_answer',
          schema: TEST_SCHEMA,
          strict: true,
        },
      },
    });
  });

  it.each([
    ['missing required field', {}, /\$\.answer: required/],
    ['wrong field type', { answer: 42 }, /\$\.answer: expected string/],
    ['unexpected field', { answer: 'ok', secret: 'extra' }, /\$: additional property/],
  ])('rejects provider output that violates the strict schema: %s', async (_case, output, error) => {
    process.env.OPENAI_API_KEY = 'sk-test-only';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(completed(output))));

    await expect(request({ maxRetries: 0 })).rejects.toThrow(error);
  });

  it('honors OPENAI_MODEL', async () => {
    process.env.OPENAI_API_KEY = 'sk-test-only';
    process.env.OPENAI_MODEL = 'gpt-5-mini-custom';
    const fetchMock = vi.fn().mockResolvedValue(response(completed()));
    vi.stubGlobal('fetch', fetchMock);

    await request();
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).model).toBe('gpt-5-mini-custom');
  });

  it('passes only a validated, opaque safety identifier', async () => {
    process.env.OPENAI_API_KEY = 'sk-test-only';
    const fetchMock = vi.fn().mockResolvedValue(response(completed()));
    vi.stubGlobal('fetch', fetchMock);

    await request({ safetyIdentifier: 'a'.repeat(64) });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).safety_identifier).toBe('a'.repeat(64));
  });

  it.each([429, 503])('retries bounded transient HTTP %s responses', async (status) => {
    process.env.OPENAI_API_KEY = 'sk-test-only';
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ error: 'temporary' }, status))
      .mockResolvedValueOnce(response(completed()));
    vi.stubGlobal('fetch', fetchMock);

    await expect(request({ maxRetries: 1 })).resolves.toEqual({ answer: 'ok' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('caps retries even when a caller requests more', async () => {
    process.env.OPENAI_API_KEY = 'sk-test-only';
    const fetchMock = vi.fn().mockResolvedValue(response({ error: 'temporary' }, 503));
    vi.stubGlobal('fetch', fetchMock);

    await expect(request({ maxRetries: 99 })).rejects.toThrow('OpenAI API 503');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('never exposes a masked API-key suffix from provider errors', async () => {
    process.env.OPENAI_API_KEY = 'sk-project-secret-value-7a92';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({
      error: {
        message: 'Incorrect API key provided: sk-project-********7a92',
        code: 'invalid_api_key',
      },
    }, 401)));

    await expect(request({ maxRetries: 0 })).rejects.toThrow(
      'OpenAI API 401: OpenAI rejected the configured API key',
    );
    await expect(request({ maxRetries: 0 })).rejects.not.toThrow(/7a92/);
  });

  it.each([
    [
      'incomplete',
      { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } },
      /response incomplete: max_output_tokens/,
    ],
    [
      'refusal',
      {
        status: 'completed',
        output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'not allowed' }] }],
      },
      /refused the request: not allowed/,
    ],
    ['missing output_text', { status: 'completed', output: [] }, /did not contain output_text/],
  ])('rejects an explicit %s response', async (_case, payload, error) => {
    process.env.OPENAI_API_KEY = 'sk-test-only';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(payload)));
    await expect(request({ maxRetries: 0 })).rejects.toThrow(error);
  });

  it('aborts a request that exceeds its timeout', async () => {
    process.env.OPENAI_API_KEY = 'sk-test-only';
    vi.stubGlobal('fetch', vi.fn((_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
      }, { once: true });
    })));

    await expect(request({ timeoutMs: 5, maxRetries: 0 })).rejects.toThrow(
      'OpenAI request timed out after 5ms',
    );
  });

  it('keeps the timeout active while reading the response body', async () => {
    process.env.OPENAI_API_KEY = 'sk-test-only';
    vi.stubGlobal('fetch', vi.fn(async (_url, { signal }) => ({
      ok: true,
      status: 200,
      json: () => new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      }),
    })));

    await expect(request({ timeoutMs: 5, maxRetries: 0 })).rejects.toThrow(
      'OpenAI request timed out after 5ms',
    );
  });
});
