/**
 * Concurrency stress test — 1000 simultaneous payment requests.
 * Verifies: no duplicate payments, no double charges, no double refunds.
 *
 * Requires a running test database (TEST_DATABASE_URL or DATABASE_URL).
 * Run with: vitest run tests/concurrency --timeout=120000
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { randomUUID } from 'crypto';

vi.mock('../../src/common/queue/rabbitmq.js', () => ({
  publishToQueue: vi.fn(async () => true),
  publishToDelayQueue: vi.fn(async () => true),
  QUEUES: { PAYMENT_PROCESS: 'payment.process', REFUND_PROCESS: 'refund.process', PAYMENT_DEADLETTER: 'payment.deadletter' },
  connectRabbitMQ: vi.fn(),
  checkRabbitMQHealth: vi.fn(async () => true),
}));

vi.mock('../../src/common/redis/lock.js', () => ({
  withLock: vi.fn(async (_key: string, fn: () => Promise<any>) => fn()),
  acquireLock: vi.fn(async () => ({ acquired: true, token: 'tok', release: async () => true })),
}));

vi.mock('../../src/common/redis/client.js', () => {
  const store: Record<string, number> = {};
  return {
    getRedisClient: () => ({
      incr: vi.fn(async (k: string) => { store[k] = (store[k] ?? 0) + 1; return store[k]; }),
      expire: vi.fn(async () => 1),
      get: vi.fn(async () => '0'),
      ping: vi.fn(async () => 'PONG'),
      set: vi.fn(async () => 'OK'),
      eval: vi.fn(async () => 1),
      quit: vi.fn(),
    }),
    disconnectRedis: vi.fn(),
    checkRedisHealth: vi.fn(async () => true),
  };
});

import { buildApp } from '../../src/services/api/app.js';
import { testPrisma, cleanupDatabase, createTestMerchant, createTestPayment } from '../helpers/test-setup.js';

describe('Concurrency Stress Tests', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let dbAvailable = false;

  beforeAll(async () => {
    try {
      await testPrisma.$connect();
      dbAvailable = true;
      app = buildApp();
      await app.ready();
    } catch {
      console.warn('⚠️  Database not available — stress tests will be skipped');
    }
  });

  afterAll(async () => {
    await app?.close();
    await testPrisma.$disconnect();
  });

  beforeEach(async () => {
    if (!dbAvailable) return;
    await cleanupDatabase();
    await createTestMerchant('merchant_1');
    await createTestMerchant('merchant_2');
  });

  it('handles 1000 concurrent payment requests without duplicates', async () => {
    if (!dbAvailable) {
      console.log('Skipping — DB not available');
      return;
    }

    const CONCURRENCY = 1000;
    const merchantId = 'merchant_1';

    // Each request gets a unique idempotency key → 1000 distinct payments
    const requests = Array.from({ length: CONCURRENCY }, () => ({
      idempotencyKey: randomUUID(),
      amount: 100,
    }));

    const results = await Promise.allSettled(
      requests.map((req) =>
        app.inject({
          method: 'POST',
          url: '/api/payments',
          headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': req.idempotencyKey,
          },
          body: JSON.stringify({ merchantId, amount: req.amount, currency: 'USD' }),
        }),
      ),
    );

    const successes = results.filter(
      (r) => r.status === 'fulfilled' && r.value.statusCode === 202,
    );

    console.log(`✅ Successful payments: ${successes.length}/${CONCURRENCY}`);

    // All 1000 should succeed
    expect(successes.length).toBe(CONCURRENCY);

    // Verify all payment IDs are unique
    const paymentIds = successes
      .filter((r): r is PromiseFulfilledResult<any> => r.status === 'fulfilled')
      .map((r) => JSON.parse(r.value.body).paymentId);

    const uniqueIds = new Set(paymentIds);
    expect(uniqueIds.size).toBe(CONCURRENCY);
    console.log(`✅ All ${CONCURRENCY} payment IDs are unique`);
  }, 120_000);

  it('idempotency prevents duplicate payments from same key', async () => {
    if (!dbAvailable) return;

    const idempotencyKey = randomUUID();
    const CONCURRENCY = 100;

    // All 100 requests use the SAME idempotency key
    const results = await Promise.allSettled(
      Array.from({ length: CONCURRENCY }, () =>
        app.inject({
          method: 'POST',
          url: '/api/payments',
          headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': idempotencyKey,
          },
          body: JSON.stringify({ merchantId: 'merchant_1', amount: 500, currency: 'USD' }),
        }),
      ),
    );

    const successes = results
      .filter((r): r is PromiseFulfilledResult<any> => r.status === 'fulfilled' && r.value.statusCode === 202)
      .map((r) => JSON.parse(r.value.body));

    // All should return the same payment ID
    const paymentIds = new Set(successes.map((b) => b.paymentId));
    expect(paymentIds.size).toBe(1); // Only ONE unique payment created
    console.log(`✅ 100 concurrent requests with same key → 1 unique payment (${[...paymentIds][0]})`);
  }, 60_000);

  it('prevents double refund under 100 simultaneous requests', async () => {
    if (!dbAvailable) return;

    const payment = await createTestPayment('merchant_1', 'SUCCESS');
    const CONCURRENCY = 100;

    const results = await Promise.allSettled(
      Array.from({ length: CONCURRENCY }, () =>
        app.inject({
          method: 'POST',
          url: `/api/payments/${payment.id}/refund`,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason: 'Concurrent refund test' }),
        }),
      ),
    );

    const successes = results
      .filter((r): r is PromiseFulfilledResult<any> => r.status === 'fulfilled')
      .filter((r) => r.value.statusCode === 202);

    const failures = results
      .filter((r): r is PromiseFulfilledResult<any> => r.status === 'fulfilled')
      .filter((r) => r.value.statusCode === 409);

    console.log(`✅ Refund successes: ${successes.length}, Refund conflicts: ${failures.length}`);

    // Exactly ONE refund should succeed
    expect(successes.length).toBe(1);
    expect(failures.length).toBe(CONCURRENCY - 1);

    // Verify only 1 refund in DB
    const dbRefunds = await testPrisma.refund.count({
      where: { paymentId: payment.id },
    });
    expect(dbRefunds).toBe(1);
    console.log('✅ Exactly 1 refund created in database');
  }, 60_000);

  it('handles mixed concurrent payment and query operations', async () => {
    if (!dbAvailable) return;

    const createRequests = Array.from({ length: 50 }, () =>
      app.inject({
        method: 'POST',
        url: '/api/payments',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() },
        body: JSON.stringify({ merchantId: 'merchant_1', amount: 200, currency: 'USD' }),
      }),
    );

    const listRequests = Array.from({ length: 50 }, () =>
      app.inject({ method: 'GET', url: '/api/payments?merchantId=merchant_1&limit=10' }),
    );

    const healthRequests = Array.from({ length: 20 }, () =>
      app.inject({ method: 'GET', url: '/health' }),
    );

    const results = await Promise.allSettled([...createRequests, ...listRequests, ...healthRequests]);

    const errors = results.filter((r) => r.status === 'rejected');
    expect(errors.length).toBe(0);
    console.log(`✅ ${results.length} mixed concurrent requests completed without errors`);
  }, 60_000);
});
