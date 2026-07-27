# Production deployment

Frontend: Vercel. Backend and PostgreSQL: Railway.

## Requirements

- Node.js 22–26
- OpenAI or OpenRouter API key
- Railway project with PostgreSQL
- Vercel project

Never commit `.env`, plaintext activation keys, database URLs, bot tokens, or
JWT secrets.

## 1. Prepare secrets locally

Generate a JWT signing secret:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Generate an activation key and its SHA-256 hash:

```bash
node scripts/generate-license-key.mjs
```

Give the short key to the customer once. Put only the printed hash in
`LICENSE_KEY_HASHES`, as a JSON array:

```text
["<64-character-sha256-hash>"]
```

## 2. Deploy the backend to Railway

1. Create a Railway project from this repository.
2. Add a PostgreSQL service to the same project and environment.
3. Add these backend variables:

| Variable | Value |
|---|---|
| `NODE_ENV` | `production` |
| `APP_MODE` | `license` |
| `OPENAI_API_KEY` | OpenAI project key or OpenRouter `sk-or-v1` key |
| `OPENAI_MODEL` | `gpt-5-mini` direct, or `openai/gpt-5-mini` through OpenRouter |
| `OPENAI_BASE_URL` | empty for auto-detection, or an approved exact API base |
| `AI_DAILY_LIMIT_LICENSE` | `200` |
| `AI_DAILY_LIMIT_TRIAL` | `20` |
| `JWT_SECRET` | generated secret |
| `ALLOWED_ORIGINS` | exact Vercel origin, no trailing slash |
| `LICENSE_KEY_HASHES` | JSON array of activation-key hashes |
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` (replace `Postgres` with the actual database-service name) |
| `DATABASE_TLS_REJECT_UNAUTHORIZED` | `false` for Railway's private PostgreSQL URL |
| `DATABASE_CONNECTION_TIMEOUT_MS` | `5000` |
| `DATABASE_QUERY_TIMEOUT_MS` | `10000` |
| `DATABASE_IDLE_TIMEOUT_MS` | `30000` |
| `ENABLE_BETA_BROKERS` | `false` |

Railway supplies `PORT`. Database variables belong to the database service, so
the backend must receive the explicit reference variable shown above; adding a
database alone does not copy `DATABASE_URL` into the application service.
Use `DATABASE_URL`, not `DATABASE_PUBLIC_URL`, so traffic stays on Railway's
encrypted private network.

The committed
`railway.json` starts the server and uses `/ready` as its health check, so a
release is not considered ready when storage is unavailable or AI credentials
or the selected model are invalid. OpenRouter keys are detected by their
`sk-or-v1` prefix. To pin routing explicitly, use one of
`https://api.openai.com/v1`, `https://openrouter.ai/api/v1`, or
`https://eu.openrouter.ai/api/v1`; arbitrary bases are rejected so an
accidental configuration cannot exfiltrate the provider key.
Database TLS is always enabled and verifies the server certificate by default.
Railway's private PostgreSQL service uses its managed SSL image and an internal
certificate chain, so this deployment sets
`DATABASE_TLS_REJECT_UNAUTHORIZED=false` while the connection remains inside
Railway's encrypted private network. Never use that opt-out for a database
reached over the public internet.
SSL query parameters embedded in `DATABASE_URL` do not override this setting.

For multiple production origins, use a comma-separated list:

```text
https://app.example.com,https://www.example.com
```

Do not add `APP_MODE=open` in production. Do not add wildcard origins.

## 3. Optional integrations

Telegram requires all three values:

| Variable | Value |
|---|---|
| `TELEGRAM_BOT_TOKEN` | token from BotFather |
| `TELEGRAM_WEBHOOK_URL` | public Railway backend origin |
| `TELEGRAM_WEBHOOK_SECRET` | a separate random secret |

Generate the webhook secret with the same `node:crypto` command used above.
Keep `ENABLE_BETA_BROKERS=false` until each broker path has passed a separate
production review. `MT_PUSH_TOKEN` is required only for the MetaTrader beta;
generate it separately and keep it at least 32 bytes long. MetaTrader push
tokens expire and are rejected as soon as their license is revoked.
cTrader remains disabled.

## 4. Deploy the frontend to Vercel

Import the same repository as a Vite project and set this build-time variable:

| Variable | Value |
|---|---|
| `VITE_API_BASE` | exact public Railway HTTPS origin, without credentials, path, query, hash, or trailing slash |

Deploy, then update Railway `ALLOWED_ORIGINS` to the exact final Vercel or
custom-domain origin and redeploy the backend. `vercel.json` contains no
hard-coded backend URL or API proxy. A Vercel production build now fails
immediately if `VITE_API_BASE` is missing or is not an exact HTTPS origin.
Preview deployments are not blocked by this guard; set their own
`VITE_API_BASE` when they must use a remote backend.

Non-Vercel production builds may omit `VITE_API_BASE` only when the frontend
and API are intentionally served from the same origin.

Provider domains (`*.vercel.app` and `*.up.railway.app`) are suitable for
staging. Before a public launch, use same-site custom domains such as
`app.example.com` and `api.example.com`. The signed device cookie must cross
from the frontend to the API; browsers that block third-party cookies may
otherwise register a new licensed device on a later activation.

## 5. Release checks

Run locally before every release:

```bash
npm ci
npm test
npm run build
npm audit
```

Then verify production:

- `GET /health` returns `{"status":"ok"}`.
- `GET /ready` returns `{"status":"ready","storage":"postgres"}`.
- Temporarily unavailable PostgreSQL makes `GET /ready` return HTTP 503.
- The site loads on desktop and mobile without console or CORS errors.
- A fresh browser can start one two-hour trial session and complete a full
  end-to-end audit.
- After its first completed analysis the trial cannot be restarted; its current
  session remains usable until the two-hour token expires.
- Reissuing `/trial/start` never extends the original expiry, and rotating
  client-generated device IDs is bounded by the privacy-preserving network
  abuse limit.
- After the trial session expires, further use asks for an activation key.
- A valid activation key restores access after a reload and refreshes the
  signed HttpOnly licensed-device grant without consuming another device slot.
- An invalid or revoked key is rejected.
- AI parsing, summary, weakness analysis, and chat return structured results.
- Telegram is hidden or disabled unless fully configured.
- Broker beta and cTrader are not exposed.

## 6. Operations

- Enable Railway PostgreSQL backups before launch.
- Keep staging and production databases, OpenAI keys, JWT secrets, and origins
  separate.
- Rotate a leaked activation key by removing or revoking its hash; never log
  the plaintext key.
- Monitor `/ready`, HTTP 5xx, OpenAI 429/5xx, database saturation, and trial or
  license rejection spikes. Alert on `AI_DAILY_LIMIT` spikes before raising a
  quota.
- Re-run tests, build, and dependency audit for every dependency update.

## 7. International launch checklist

- Publish and review the included Terms of Service and Privacy Policy. Add the
  operator's lawful name or entity, country, and business address before
  accepting payments; the current Telegram support contact is not a complete
  international merchant identity.
- Disclose the essential signed trial/device cookies and that the application
  stores only HMAC-derived network abuse identifiers, not raw IP or user-agent
  values, in its access store.
- List the selected AI gateway/provider and hosting/database vendors as
  processors or subprocessors as applicable. Confirm their retention and
  international-transfer settings for the launch regions.
- Keep the in-product “not financial advice” notice, but have counsel review
  marketing claims and local rules for analytics offered to traders.
