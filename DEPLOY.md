# Deployment Guide — Strategy Architect Pro

Backend → Railway | Frontend → Vercel

---

## Prerequisites

- GitHub repository with this code pushed
- Railway account (railway.app)
- Vercel account (vercel.com)
- Groq API key (free at console.groq.com)

---

## Step 1 — Push code to GitHub

```bash
git add .
git commit -m "production setup"
git push origin main
```

Make sure `.env` is in `.gitignore` (never commit secrets).
Commit `.env.example` and `.env.production.example` — they are safe.

---

## Step 2 — Deploy backend on Railway

1. Go to [railway.app](https://railway.app) → **New Project**
2. Choose **Deploy from GitHub repo** → select your repository
3. Railway detects `railway.json` automatically — no extra config needed

---

## Step 3 — Add environment variables on Railway

In your Railway project → **Variables** tab, add:

| Variable | Value |
|---|---|
| `GROQ_API_KEY` | your Groq API key |
| `GROQ_MODEL` | `llama-3.1-8b-instant` |
| `PRODUCTION_ORIGIN` | *(leave blank for now — fill in after Vercel deploy)* |

Railway injects `PORT` automatically — do **not** add it manually.

Click **Deploy** and wait for the build to finish.

---

## Step 4 — Copy Railway URL

After a successful deploy, Railway shows a public URL:
```
https://your-project-name.up.railway.app
```

Verify the backend is alive:
```
https://your-project-name.up.railway.app/health
```
Should return `{"status":"ok"}`.

---

## Step 5 — Deploy frontend on Vercel

1. Go to [vercel.com](https://vercel.com) → **Add New Project**
2. Import your GitHub repository
3. Vercel auto-detects Vite — leave build settings as default
4. Click **Deploy** — no environment variables needed

> **How routing works:** `vercel.json` (committed to the repo) tells Vercel to
> proxy all `/api/ai` requests to the Railway backend automatically. The
> frontend calls `/api/ai` as a relative URL, so no API URL is ever baked into
> the build. If you ever need to override this (e.g. a staging environment),
> add `VITE_API_BASE=https://your-backend.up.railway.app` in the Vercel
> project settings — that takes precedence over the proxy.

---

## Step 6 — Wire CORS (lock down the backend)

Once Vercel gives you your frontend URL (e.g. `https://sap.vercel.app`):

1. Go back to Railway → **Variables**
2. Set `PRODUCTION_ORIGIN` = `https://sap.vercel.app`
3. Railway redeploys automatically

This restricts the backend to only accept requests from your frontend.

---

## Step 7 — Smoke test

Open your Vercel frontend URL:

- [ ] App loads, tabs visible
- [ ] Quick Check → Run analysis → report appears
- [ ] Journal Analysis tab → drop a CSV → AI parses it → confirm → report appears
- [ ] AI Summary card appears after report
- [ ] **💬 Ask AI** button works (bottom-right corner)
- [ ] Prop Challenge → run → Prop Coach card appears

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| "AI сервис не настроен" | `GROQ_API_KEY` not set on Railway | Add the variable and redeploy |
| CORS error in browser console | `PRODUCTION_ORIGIN` mismatch | Set it to the exact Vercel URL (no trailing slash) |
| `/health` returns 404 | Deploy failed / wrong start command | Check Railway build logs |
| AI calls fail on Vercel | `vercel.json` rewrite not deployed | Confirm `vercel.json` is committed and Vercel redeployed |
| 429 quota error | Groq rate limit hit | Wait 60 s, or upgrade to a paid Groq plan |
