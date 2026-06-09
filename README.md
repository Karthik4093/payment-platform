# Payment Orchestration Platform

A production-grade, fault-tolerant payment orchestration platform built with Node.js 22, TypeScript, Fastify, PostgreSQL, Redis, and RabbitMQ.

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Client / Merchant                           │
└────────────────────────────┬────────────────────────────────────────┘
                             │ HTTP
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        API Service (:3000)                          │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────┐              │
│  │   Payment   │  │    Refund    │  │   Webhook    │              │
│  │   Routes    │  │    Routes    │  │   Routes     │              │
│  └──────┬──────┘  └──────┬───────┘  └──────┬───────┘              │
│         │                │                  │                       │
│  ┌──────▼──────┐  ┌──────▼───────┐  ┌──────▼───────┐             │
│  │   Payment   │  │    Refund    │  │   Webhook    │             │
│  │   Service   │  │    Service   │  │   Service    │             │
│  └──────┬──────┘  └──────┬───────┘  └──────┬───────┘             │
│         │ FRAUD CHECK     │ LOCK             │ SIG VERIFY          │
└─────────┼─────────────────┼──────────────────┼─────────────────────┘
          │                 │                  │
          ▼                 ▼                  ▼
┌─────────────┐   ┌──────────────┐   ┌───────────────┐
│  RabbitMQ   │   │ Redis (Lock) │   │  PostgreSQL   │
│  Exchanges  │   │  Idempotency │   │  (Prisma ORM) │
│  Queues:    │   │  Fraud Rate  │   │               │
│  ·pay.proc  │   └──────────────┘   │  merchants    │
│  ·pay.retry │                      │  payments     │
│  ·pay.dlq   │                      │  refunds      │
│  ·ref.proc  │                      │  ledger       │
└──────┬──────┘                      │  saga         │
       │                             │  webhooks     │
       ▼                             │  fraud_alerts │
┌─────────────────────────────────────────────────────────────────────┐
│                      Worker Service                                 │
│  ┌─────────────────────────────────┐ ┌───────────────────────────┐ │
│  │       Payment Worker            │ │      Refund Worker        │ │
│  │  1. Acquire Redis Lock          │ │  1. Acquire Redis Lock    │ │
│  │  2. PENDING → PROCESSING        │ │  2. PENDING → PROCESSING  │ │
│  │  3. Call Gateway Simulator      │ │  3. Call Gateway /refund  │ │
│  │  4a. SUCCESS: → AUTH→CAP→SUC   │ │  4. Update Refund + Pmnt  │ │
│  │      Record Ledger Entries      │ │  5. Record Ledger Entry   │ │
│  │      Trigger Saga Orchestrator  │ │  6. Release Lock          │ │
│  │  4b. FAIL: → RETRYING (exp.    │ │                           │ │
│  │      backoff) or → FAILED(DLQ) │ └───────────────────────────┘ │
│  │  5. Release Lock                │                               │
│  └─────────────────────────────────┘                               │
└─────────────────────────────────────────────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────────────────────────────────────┐
│                   Gateway Simulator (:3001)                         │
│   POST /gateway/pay    → 70% SUCCESS | 20% FAIL | 10% TIMEOUT      │
│   POST /gateway/refund → 95% SUCCESS | 5% FAIL                     │
│   POST /inventory/*    → Reserve / Release (10% fail)               │
│   POST /shipping/*     → Create / Cancel (15% fail)                 │
│   Sends signed webhooks back to API (/webhooks/payment)             │
└─────────────────────────────────────────────────────────────────────┘
```

## Saga Pattern Flow

```
Payment SUCCESS
      │
      ▼
┌─────────────────┐   success   ┌─────────────────┐   success   ┌──────────────┐
│ PAYMENT_PROCESSED├───────────►│ INVENTORY_RESERVED├───────────►│SHIPMENT_CREAT│
│    (completed)   │            │  POST /inventory  │            │POST /shipping│
└─────────────────┘            │     /reserve      │            │   /create    │
                                └────────┬──────────┘            └──────┬───────┘
                                         │ failure                      │ failure
                                         ▼                              ▼
                              ┌─────────────────────────────────────────────────┐
                              │              COMPENSATION (reverse order)        │
                              │  cancel shipment → release inventory → refund   │
                              └─────────────────────────────────────────────────┘
```

## Ledger Accounting

Double-entry bookkeeping — every monetary event produces exactly two entries:

```
Payment Success ($10.00):
  DEBIT  MERCHANT_BALANCE_{merchantId}   $10.00
  CREDIT PLATFORM_CASH                   $10.00

Refund ($10.00):
  DEBIT  PLATFORM_CASH                   $10.00
  CREDIT MERCHANT_BALANCE_{merchantId}   $10.00

Balance = Σ credits − Σ debits per account
```

## Retry Strategy

Exponential backoff via RabbitMQ delay queues (no plugin required):

| Attempt | Delay | Queue             |
|---------|-------|-------------------|
| 1       | 1s    | payment.delay.1s  |
| 2       | 2s    | payment.delay.2s  |
| 3       | 4s    | payment.delay.4s  |
| 4       | 8s    | payment.delay.8s  |
| 5       | 16s   | payment.delay.16s |
| > 5     | —     | payment.deadletter|

Each delay queue has `x-message-ttl` set and dead-letters back to `payment.process`.

## Payment State Machine

```
PENDING ──► PROCESSING ──► AUTHORIZED ──► CAPTURED ──► SUCCESS ──► REFUND_PENDING ──► REFUNDED
                │                                                           ▲
                ├──► RETRYING ─────────────────────────────────────────────┘
                │        │
                │        └──► FAILED (max retries)
                │
                └──► FAILED (first attempt, max retries exceeded)
```

Invalid transitions throw `StateMachineError` (HTTP 422).

## Quick Start

### Prerequisites
- Docker + Docker Compose
- Node.js 22+

### 1. Clone & Configure
```bash
git clone <repo>
cd payment-platform
cp .env.example .env
```

### 2. Start All Services
```bash
docker compose up -d
```

This starts: PostgreSQL, Redis, RabbitMQ, API (×1), Worker (×2), Gateway Simulator.

Database migrations and seeding run automatically via the `migrate` service.

### 3. Access Services
| Service           | URL                              |
|-------------------|----------------------------------|
| UI Dashboard      | http://localhost:3000            |
| API               | http://localhost:3000/api        |
| Swagger Docs      | http://localhost:3000/docs       |
| RabbitMQ Admin    | http://localhost:15672           |
| Gateway Simulator | http://localhost:3001            |

RabbitMQ credentials: `payments_user` / `payments_pass`

## Local Development

```bash
# Install dependencies
npm install

# Generate Prisma client
npm run db:generate

# Push schema to database (requires running postgres)
npm run db:push
npm run db:seed

# Start services in separate terminals
npm run dev:api
npm run dev:worker
npm run dev:gateway
```

## API Reference

### Create Payment
```http
POST /api/payments
Idempotency-Key: <unique-uuid>
Content-Type: application/json

{
  "merchantId": "merchant_1",
  "amount": 1000,
  "currency": "USD"
}

→ 202 { "paymentId": "uuid", "status": "PENDING", "amount": 1000, "currency": "USD" }
```

### Get Payment
```http
GET /api/payments/:id
→ 200 { "paymentId": "...", "status": "SUCCESS", ... }
```

### List Payments
```http
GET /api/payments?merchantId=merchant_1&limit=50&offset=0
→ 200 { "data": [...], "limit": 50, "offset": 0 }
```

### Initiate Refund
```http
POST /api/payments/:id/refund
Content-Type: application/json

{ "reason": "Customer request" }

→ 202 { "refundId": "uuid", "status": "PENDING", ... }
```

### Webhook Endpoint
```http
POST /webhooks/payment
X-Signature: sha256=<hmac-sha256-hex>
Content-Type: application/json

{
  "eventId": "unique-uuid",
  "eventType": "payment.success",
  "paymentId": "...",
  "status": "SUCCESS",
  "gatewayRef": "gw_...",
  "amount": 1000,
  "currency": "USD",
  "timestamp": "ISO8601"
}
```

Webhook signature: `HMAC-SHA256(body, WEBHOOK_SECRET)` in hex, prefixed with `sha256=`.

### Health Check
```http
GET /health
→ { "status": "healthy", "checks": { "postgres": "ok", "redis": "ok", "rabbitmq": "ok" } }
```

## Testing

### Unit Tests (no external deps)
```bash
npm run test:unit
```
Covers: state machine, fraud engine, ledger service, crypto utilities.

### Integration Tests (requires PostgreSQL)
```bash
# Start DB first
docker compose up -d postgres redis

npm run test:integration
```
Covers: payment creation, idempotency, webhook processing, refund logic.

### Concurrency / Stress Tests
```bash
npm run test:concurrency
```
Simulates:
- 1000 concurrent payment requests → verifies 0 duplicates
- 100 simultaneous same-key requests → verifies 1 payment created
- 100 concurrent refund attempts → verifies exactly 1 succeeds

## Scaling Workers

To scale payment processing workers:

```bash
# Docker Compose (set replicas in docker-compose.yml)
docker compose up -d --scale worker=5

# Or run additional worker processes
NODE_ENV=production node dist/services/worker/index.js
```

Workers compete for messages via RabbitMQ's fair dispatch (`prefetch: 10`). Redis distributed locking prevents double-processing when multiple workers pick the same payment.

## Production Deployment

### Environment Variables
See `.env.example` for all required variables. Key settings for production:

```bash
NODE_ENV=production
DATABASE_URL=postgresql://user:pass@db-host:5432/payments_db
REDIS_URL=redis://redis-host:6379
RABBITMQ_URL=amqp://user:pass@mq-host:5672
WEBHOOK_SECRET=<strong-random-secret>
REDIS_LOCK_TTL_MS=30000
RETRY_MAX_ATTEMPTS=5
```

### Checklist
- [ ] Change `WEBHOOK_SECRET` to a strong random value
- [ ] Enable TLS on all service connections
- [ ] Set `LOG_LEVEL=warn` for production
- [ ] Configure database connection pooling
- [ ] Set up monitoring (Prometheus / Grafana)
- [ ] Configure DLQ alerting for failed payments
- [ ] Enable RabbitMQ persistence and mirrored queues

## Module Structure

```
src/
├── common/
│   ├── db/        prisma.ts         — Prisma client singleton
│   ├── queue/     rabbitmq.ts       — RabbitMQ connection & topology
│   │              types.ts          — Queue names and message types
│   ├── redis/     client.ts         — Redis singleton
│   │              lock.ts           — Distributed locking (SET NX + Lua)
│   ├── logger/    index.ts          — Pino logger with redaction
│   └── utils/     errors.ts         — Typed AppError hierarchy
│                  crypto.ts         — HMAC signing & verification
│                  correlation.ts    — Correlation ID generation
│
├── modules/
│   ├── payment/   state-machine     — Strict transition validation
│   │              repository        — DB queries
│   │              service           — Business logic + idempotency
│   │              routes            — Fastify route handlers
│   ├── refund/    service           — Race-safe refund with DB lock + Redis lock
│   ├── ledger/    service           — Double-entry accounting
│   ├── fraud/     service           — Rule-based fraud detection (Redis counters)
│   ├── webhook/   service           — HMAC verify + event deduplication
│   ├── gateway/   client            — Gateway HTTP client with timeout
│   └── saga/      orchestrator      — Payment→Inventory→Shipping + compensation
│
├── workers/
│   ├── payment.worker.ts            — Consume payment.process queue
│   └── refund.worker.ts             — Consume refund.process queue
│
└── services/
    ├── api/       app.ts, index.ts  — Fastify API server
    ├── worker/    index.ts          — Worker startup
    └── gateway-simulator/           — Fake payment + inventory + shipping

public/                              — Plain HTML/CSS/JS dashboard UI
prisma/   schema.prisma, seed.ts
tests/
  unit/          state-machine, fraud, ledger, crypto
  integration/   payments, webhooks, refunds
  concurrency/   1000-req stress test
```

## Design Decisions

**Why RabbitMQ delay queues instead of plugins?**
Multiple fixed-TTL queues (`payment.delay.1s`, `.2s`, `.4s`…) with dead-letter routing back to the main queue. No external plugin needed, works on any RabbitMQ installation.

**Why BigInt for amounts?**
Storing amounts in the smallest currency unit (cents) as `BIGINT` eliminates all floating-point arithmetic issues.

**Why idempotency key in both Redis and PostgreSQL?**
PostgreSQL provides durable, crash-safe storage. The unique constraint on `idempotency_keys.key` ensures only one payment is created even under concurrent requests — the DB transaction is the final arbiter.

**Why double-entry ledger instead of stored balances?**
Balances computed from immutable ledger entries provide a complete audit trail. No balance can go out of sync because balances are never stored — they're always derived.

**Why two layers of locking for refunds?**
1. PostgreSQL transaction + `SELECT FOR UPDATE` (implicit via Prisma transaction) prevents the race at DB level.
2. Redis distributed lock provides fast-fail before hitting the DB, reducing contention under load.
