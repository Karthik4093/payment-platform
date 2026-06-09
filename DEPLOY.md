# 🚀 Free Deployment Guide

## Option A — Render (Easiest, Click Below)

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/Karthik4093/payment-platform)

**→ https://render.com/deploy?repo=https://github.com/Karthik4093/payment-platform**

After clicking:
1. Sign in with GitHub
2. It reads `render.yaml` automatically
3. Click **"Apply"** — services deploy in ~5 minutes
4. Your URLs: `https://payment-api.onrender.com` and `https://payment-gateway.onrender.com`

---

## Option B — Railway (More powerful, no sleep)

**Step 1** — Sign up at https://railway.app with GitHub

**Step 2** — Click: https://railway.app/new/github

**Step 3** — Select `Karthik4093/payment-platform`

**Step 4** — Add plugins: PostgreSQL + Redis (click "+ New" → Plugin)

**Step 5** — Create 3 services with these start commands:

| Service | Start Command |
|---|---|
| `payment-api` | `npx prisma migrate deploy && node dist/services/api/index.js` |
| `payment-worker` | `node dist/services/worker/index.js` |
| `payment-gateway` | `node dist/services/gateway-simulator/index.js` |

Build command for all: `npm ci && npx prisma generate && npm run build`

**Step 6** — Set environment variables (Railway dashboard → Variables):

```env
NODE_ENV=production
LOG_LEVEL=info
WEBHOOK_SECRET=<generate a random 32-char string>
FRAUD_MAX_PAYMENTS_PER_MINUTE=10
FRAUD_MAX_FAILURES_PER_5_MINUTES=5
FRAUD_MAX_AMOUNT=100000
RETRY_MAX_ATTEMPTS=5
RETRY_BASE_DELAY_MS=1000
WORKER_CONCURRENCY=5

# Auto-provided by Railway plugins:
DATABASE_URL=${{Postgres.DATABASE_URL}}
REDIS_URL=${{Redis.REDIS_URL}}

# Add after getting CloudAMQP free account (https://cloudamqp.com):
RABBITMQ_URL=amqps://YOUR_CLOUDAMQP_URL

# Set after gateway deploys (replace with your Railway gateway URL):
GATEWAY_URL=https://payment-gateway-production-xxxx.up.railway.app
WEBHOOK_URL=https://payment-api-production-xxxx.up.railway.app/webhooks/payment
INVENTORY_SERVICE_URL=https://payment-gateway-production-xxxx.up.railway.app/inventory
SHIPPING_SERVICE_URL=https://payment-gateway-production-xxxx.up.railway.app/shipping
```

**Your Railway URLs will look like:**
- API: `https://payment-api-production-<random>.up.railway.app`
- Gateway: `https://payment-gateway-production-<random>.up.railway.app`

---

## Option C — GitHub Actions Auto-Deploy (Recommended for ongoing updates)

1. Go to **https://railway.app/account/tokens** → Create token → Copy it
2. Go to **https://github.com/Karthik4093/payment-platform/settings/secrets/actions**
3. Add secret: `RAILWAY_TOKEN` = your token
4. Push any commit → GitHub Actions deploys automatically

---

## Free Database Services

| Service | Free Tier | Sign Up |
|---|---|---|
| **Neon** (PostgreSQL) | 512MB, always-on | https://neon.tech |
| **Upstash** (Redis) | 10k req/day, 256MB | https://upstash.com |
| **CloudAMQP** (RabbitMQ) | 1M msg/month | https://cloudamqp.com |

---

## Test Your Deployment

Once deployed, run these curl commands:

```bash
# Health check
curl https://payment-api.onrender.com/health

# Create payment
curl -X POST https://payment-api.onrender.com/api/payments \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: test-$(date +%s)" \
  -d '{"merchantId":"merchant_1","amount":1000,"currency":"USD"}'

# View dashboard
open https://payment-api.onrender.com

# View API docs
open https://payment-api.onrender.com/docs
```
