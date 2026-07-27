const PROVIDER_BASES = Object.freeze({
  openai: 'https://api.openai.com/v1',
  openrouter: 'https://openrouter.ai/api/v1',
  openrouterEu: 'https://eu.openrouter.ai/api/v1',
});
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_RETRY_DELAY_MS = 250;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let providerStatus = Object.freeze({
  state: 'unchecked',
  checkedAt: null,
});

function setProviderStatus(state, httpStatus = null, provider = null) {
  providerStatus = Object.freeze({
    state,
    checkedAt: new Date().toISOString(),
    ...(Number.isInteger(httpStatus) ? { httpStatus } : {}),
    ...(provider ? { provider: provider.provider, model: provider.model } : {}),
  });
  return providerStatus;
}

export function getOpenAIProviderStatus() {
  return providerStatus;
}

export function resolveAIProvider(env = process.env) {
  const apiKey = String(env.OPENAI_API_KEY || '').trim();
  const configuredBase = String(env.OPENAI_BASE_URL || '').trim();
  let provider;
  let baseUrl;

  if (configuredBase) {
    const allowed = Object.entries(PROVIDER_BASES)
      .find(([, candidate]) => candidate === configuredBase);
    if (!allowed) {
      throw new Error('OPENAI_BASE_URL must be an approved OpenAI or OpenRouter API base URL');
    }
    provider = allowed[0].startsWith('openrouter') ? 'openrouter' : 'openai';
    baseUrl = configuredBase;
  } else if (apiKey.startsWith('sk-or-v1-')) {
    provider = 'openrouter';
    baseUrl = PROVIDER_BASES.openrouter;
  } else {
    provider = 'openai';
    baseUrl = PROVIDER_BASES.openai;
  }

  let model = String(env.OPENAI_MODEL || 'gpt-5-mini').trim();
  if (provider === 'openrouter' && model === 'gpt-5-mini') model = 'openai/gpt-5-mini';
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(model)) {
    throw new Error('OPENAI_MODEL is invalid');
  }

  return Object.freeze({ provider, baseUrl, model, apiKey });
}

/**
 * Validate credentials/model access without spending inference tokens.
 * Authentication/configuration failures are distinct from temporary provider
 * or network outages so readiness checks do not create restart loops.
 */
export async function probeOpenAIProvider({
  fetchImpl = fetch,
  timeoutMs = 5_000,
} = {}) {
  let provider;
  try {
    provider = resolveAIProvider();
  } catch {
    return setProviderStatus('invalid_configuration');
  }
  const { apiKey } = provider;
  if (!apiKey) return setProviderStatus('missing', null, provider);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const urls = provider.provider === 'openrouter'
    ? [
      `${provider.baseUrl}/key`,
      `${provider.baseUrl}/model/${provider.model}`,
    ]
    : [`${provider.baseUrl}/models/${encodeURIComponent(provider.model)}`];
  let response = null;
  try {
    for (const url of urls) {
      response = await fetchImpl(url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: controller.signal,
      });
      if (!response.ok) break;
    }
  } catch {
    clearTimeout(timer);
    return setProviderStatus('unavailable', null, provider);
  }
  clearTimeout(timer);

  if (response.ok) return setProviderStatus('ready', response.status, provider);
  if (response.status === 401 || response.status === 403) {
    return setProviderStatus('invalid_credentials', response.status, provider);
  }
  if (response.status === 404) return setProviderStatus('invalid_model', response.status, provider);
  return setProviderStatus('unavailable', response.status, provider);
}

function safeErrorText(text, apiKey) {
  const source = String(text || '');
  if (/incorrect api key|invalid_api_key/i.test(source)) {
    return 'OpenAI rejected the configured API key';
  }
  return source
    .split(apiKey).join('[REDACTED]')
    .replace(/\bsk-[A-Za-z0-9_-]+\b/g, '[REDACTED]')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED]')
    .replace(/\*{4,}[A-Za-z0-9_-]{0,16}/g, '[REDACTED]')
    .slice(0, 300);
}

function extractOutputText(response) {
  if (response?.status === 'incomplete') {
    const reason = response.incomplete_details?.reason || 'unknown reason';
    throw new Error(`OpenAI response incomplete: ${reason}`);
  }

  if (response?.status && response.status !== 'completed') {
    throw new Error(`OpenAI response ended with status: ${response.status}`);
  }

  const content = Array.isArray(response?.output)
    ? response.output.flatMap((item) => Array.isArray(item?.content) ? item.content : [])
    : [];

  const refusal = content.find((item) => item?.type === 'refusal');
  if (refusal) {
    throw new Error(`OpenAI refused the request: ${refusal.refusal || 'no reason provided'}`);
  }

  if (typeof response?.output_text === 'string' && response.output_text.trim()) {
    return response.output_text.trim();
  }

  const text = content
    .filter((item) => item?.type === 'output_text' && typeof item.text === 'string')
    .map((item) => item.text)
    .join('')
    .trim();

  if (!text) throw new Error('OpenAI response did not contain output_text');
  return text;
}

function jsonType(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (Number.isInteger(value)) return 'integer';
  if (typeof value === 'number') return 'number';
  return typeof value;
}

function schemaError(value, schema, path = '$') {
  if (!schema || typeof schema !== 'object') return `${path}: invalid schema`;
  if (Array.isArray(schema.anyOf)) {
    return schema.anyOf.some((candidate) => schemaError(value, candidate, path) === null)
      ? null
      : `${path}: did not match any allowed shape`;
  }
  if (Array.isArray(schema.enum)
    && !schema.enum.some((allowed) => Object.is(value, allowed))) {
    return `${path}: value is not allowed`;
  }

  const actual = jsonType(value);
  const allowedTypes = Array.isArray(schema.type) ? schema.type : [schema.type];
  const typeMatches = allowedTypes.includes(actual)
    || (actual === 'integer' && allowedTypes.includes('number'));
  if (schema.type && !typeMatches) return `${path}: expected ${allowedTypes.join('|')}`;

  if (actual === 'object') {
    const properties = schema.properties || {};
    for (const key of schema.required || []) {
      if (!Object.hasOwn(value, key)) return `${path}.${key}: required`;
    }
    if (schema.additionalProperties === false) {
      const extra = Object.keys(value).find((key) => !Object.hasOwn(properties, key));
      if (extra) return `${path}: additional property`;
    }
    for (const [key, child] of Object.entries(properties)) {
      if (!Object.hasOwn(value, key)) continue;
      const error = schemaError(value[key], child, `${path}.${key}`);
      if (error) return error;
    }
  }

  if (actual === 'array') {
    if (Number.isInteger(schema.minItems) && value.length < schema.minItems) {
      return `${path}: too few items`;
    }
    if (Number.isInteger(schema.maxItems) && value.length > schema.maxItems) {
      return `${path}: too many items`;
    }
    for (let index = 0; index < value.length; index += 1) {
      const error = schemaError(value[index], schema.items, `${path}[${index}]`);
      if (error) return error;
    }
  }

  return null;
}

/**
 * Call the OpenAI Responses API and return a JSON object constrained by the
 * supplied strict schema.
 */
export async function requestStructuredResponse({
  system,
  user,
  schemaName,
  schema,
  maxOutputTokens,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxRetries = DEFAULT_MAX_RETRIES,
  retryDelayMs = DEFAULT_RETRY_DELAY_MS,
  safetyIdentifier,
}) {
  let provider;
  try {
    provider = resolveAIProvider();
  } catch (error) {
    setProviderStatus('invalid_configuration');
    throw error;
  }
  const { apiKey } = provider;
  if (!apiKey) {
    setProviderStatus('missing', null, provider);
    throw new Error('OPENAI_API_KEY is not configured');
  }
  if (!Number.isInteger(maxOutputTokens) || maxOutputTokens < 1) {
    throw new TypeError('maxOutputTokens must be a positive integer');
  }
  const retryCount = Number.isInteger(maxRetries)
    ? Math.max(0, Math.min(maxRetries, DEFAULT_MAX_RETRIES))
    : DEFAULT_MAX_RETRIES;

  const body = JSON.stringify({
    model: provider.model,
    store: false,
    ...(typeof safetyIdentifier === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(safetyIdentifier)
      ? { safety_identifier: safetyIdentifier }
      : {}),
    input: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    max_output_tokens: maxOutputTokens,
    text: {
      format: {
        type: 'json_schema',
        name: schemaName,
        schema,
        strict: true,
      },
    },
  });

  for (let attempt = 0; attempt <= retryCount; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response;

    try {
      response = await fetch(`${provider.baseUrl}/responses`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body,
        signal: controller.signal,
      });
    } catch (error) {
      clearTimeout(timer);
      setProviderStatus('unavailable', null, provider);
      if (controller.signal.aborted) {
        throw new Error(`OpenAI request timed out after ${timeoutMs}ms`);
      }
      throw new Error(
        `OpenAI request failed: ${safeErrorText(error?.message || 'network error', apiKey)}`,
      );
    }

    if (!response.ok) {
      const retryable = response.status === 429 || response.status >= 500;
      const details = typeof response.text === 'function'
        ? await response.text().catch(() => '')
        : '';
      clearTimeout(timer);
      if (controller.signal.aborted) {
        throw new Error(`OpenAI request timed out after ${timeoutMs}ms`);
      }
      if (retryable && attempt < retryCount) {
        setProviderStatus('unavailable', response.status, provider);
        if (retryDelayMs > 0) await sleep(retryDelayMs * (2 ** attempt));
        continue;
      }

      if (response.status === 401 || response.status === 403) {
        setProviderStatus('invalid_credentials', response.status, provider);
      } else if (response.status === 404) {
        setProviderStatus('invalid_model', response.status, provider);
      } else {
        setProviderStatus('unavailable', response.status, provider);
      }
      throw new Error(`OpenAI API ${response.status}: ${safeErrorText(details, apiKey)}`);
    }

    setProviderStatus('ready', response.status, provider);
    let data;
    try {
      data = await response.json();
    } catch (_) {
      clearTimeout(timer);
      if (controller.signal.aborted) {
        throw new Error(`OpenAI request timed out after ${timeoutMs}ms`);
      }
      throw new Error('OpenAI API returned invalid JSON');
    }
    clearTimeout(timer);
    if (controller.signal.aborted) {
      throw new Error(`OpenAI request timed out after ${timeoutMs}ms`);
    }

    const outputText = extractOutputText(data);
    let parsed;
    try {
      parsed = JSON.parse(outputText);
    } catch (_) {
      throw new Error('OpenAI output_text was not valid JSON');
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('OpenAI output_text did not contain a JSON object');
    }
    const validationError = schemaError(parsed, schema);
    if (validationError) {
      throw new Error(`OpenAI output_text did not match the JSON schema (${validationError})`);
    }
    return parsed;
  }

  throw new Error('OpenAI request failed after retries');
}

export function getModel(safetyIdentifier) {
  return Object.freeze({
    generateJSON(options) {
      return requestStructuredResponse({ ...options, safetyIdentifier });
    },
  });
}
