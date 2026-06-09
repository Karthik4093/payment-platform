/**
 * Integration tests for payment creation.
 * Requires a running PostgreSQL instance.
 * Set TEST_DATABASE_URL or DATABASE_URL to point to a test database.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { randomUUID } from 'crypto';

// Mock external deps (RabbitMQ, Redis) for integration tests
vi.mock('../../src/common/queue/rabbitmq.js', () => ({
  publishToQueue: vi.fn(async () => true),
  publishToDelayQueue: vi.fn(async () => true),
  QUEUES: {
    PAYMENT_PROCESS: 'payment.process',
    PAYMENT_DEADLETTER: 'payment.deadletter',
    REFUND_PROCESS: 'refund.process',
  },
  connectRabbitMQ: vi.fn(async () => {}),
  checkRabbitMQHealth: vi.fn(async () => true),
}));

vi.mock('../../src/common/redis/client.js', () => {
  const store: Record<string, number> = {};
  return {
    getRedisClient: () => ({
      incr: vi.fn(async (k: string) => { store[k] = (store[k] ?? 0) + 1; return store[k]; }),
      expire: vi.fn(async () => 1),
      get: vi.fn(async () => '0'),
      ping: vi.fn(async () => 'PONG'),
      quit: vi.fn(async () => {}),
      set: vi.fn(async () => 'OK'),
      eval: vi.fn(async () => 1),
    }),
    disconnectRedis: vi.fn(async () => {}),
    checkRedisHealth: vi.fn(async () => true),
  };
});

import { buildApp } from '../../src/services/api/app.js';
import { testPrisma, cleanupDatabase, createTestMerchant } from '../helpers/test-setup.js';

describe('Payment Creation (Integration)', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    try {
      await testPrisma.$connect();
      app = buildApp();
      await app.ready();
    } catch (e) {
      console.warn('DB not available — skipping integration tests');
    }
  });

  afterAll(async () => {
    await app?.close();
    await testPrisma.$disconnect();
  });

  beforeEach(async () => {
    try {
      await cleanupDatabase();
      await createTestMerchant('merchant_1');
    } catch {
      // DB not available
    }
  });

  it('creates a payment and returns 202 with PENDING status', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/payments',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': randomUUID(),
        'X-Correlation-Id': randomUUID(),
      },
      body: JSON.stringify({
        merchantId: 'merchant_1',
        amount: 1000,
        currency: 'USD',
      }),
    });

    expect(response.statusCode).toBe(202);
    const body = JSON.parse(response.body);
    expect(body.paymentId).toBeDefined();
    expect(body.status).toBe('PENDING');
    expect(body.amount).toBe(1000);
    expect(body.currency).toBe('USD');
  });

  it('returns same response for duplicate idempotency key', async () => {
    const idempotencyKey = randomUUID();
    const headers = {
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
    };
    const body = JSON.stringify({ merchantId: 'merchant_1', amount: 500, currency: 'USD' });

    const first = await app.inject({ method: 'POST', url: '/api/payments', headers, body });
    const second = await app.inject({ method: 'POST', url: '/api/payments', headers, body });

    expect(first.statusCode).toBe(202);
    expect(second.statusCode).toBe(202);

    const firstBody = JSON.parse(first.body);
    const secondBody = JSON.parse(second.body);

    expect(firstBody.paymentId).toBe(secondBody.paymentId);
  });

  it('retrieves payment by ID', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/payments',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() },
      body: JSON.stringify({ merchantId: 'merchant_1', amount: 2000, currency: 'USD' }),
    });

    const { paymentId } = JSON.parse(createRes.body);

    const getRes = await app.inject({ method: 'GET', url: `/api/payments/${paymentId}` });
    expect(getRes.statusCode).toBe(200);

    const payment = JSON.parse(getRes.body);
    expect(payment.paymentId).toBe(paymentId);
  });

  it('returns 404 for non-existent payment', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/payments/${randomUUID()}`,
    });
    expect(res.statusCode).toBe(404);
  });

  it('rejects payment with missing idempotency key', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/payments',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ merchantId: 'merchant_1', amount: 1000, currency: 'USD' }),
    });
    expect(res.statusCode).toBe(400);
  });

  it('lists payments for a merchant', async () => {
    // Create 3 payments
    for (let i = 0; i < 3; i++) {
      await app.inject({
        method: 'POST',
        url: '/api/payments',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() },
        body: JSON.stringify({ merchantId: 'merchant_1', amount: 100 * (i + 1), currency: 'USD' }),
      });
    }

    const res = await app.inject({
      method: 'GET',
      url: '/api/payments?merchantId=merchant_1&limit=10',
    });

    expect(res.statusCode).toBe(200);
    const { data } = JSON.parse(res.body);
    expect(data.length).toBeGreaterThanOrEqual(3);
  });
});
