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

vi.mock('../../src/common/redis/client.js', () => ({
  getRedisClient: () => ({
    incr: vi.fn(async () => 1),
    expire: vi.fn(async () => 1),
    get: vi.fn(async () => '0'),
    ping: vi.fn(async () => 'PONG'),
    set: vi.fn(async () => 'OK'),
    eval: vi.fn(async () => 1),
    quit: vi.fn(),
  }),
  disconnectRedis: vi.fn(),
  checkRedisHealth: vi.fn(async () => true),
}));

import { buildApp } from '../../src/services/api/app.js';
import { testPrisma, cleanupDatabase, createTestMerchant, createTestPayment } from '../helpers/test-setup.js';

describe('Refund System (Integration)', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    try {
      await testPrisma.$connect();
      app = buildApp();
      await app.ready();
    } catch { /* DB not available */ }
  });

  afterAll(async () => {
    await app?.close();
    await testPrisma.$disconnect();
  });

  beforeEach(async () => {
    try {
      await cleanupDatabase();
      await createTestMerchant('merchant_1');
    } catch { /* DB not available */ }
  });

  it('creates a refund for a SUCCESS payment', async () => {
    const payment = await createTestPayment('merchant_1', 'SUCCESS');

    const res = await app.inject({
      method: 'POST',
      url: `/api/payments/${payment.id}/refund`,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'Customer request' }),
    });

    expect(res.statusCode).toBe(202);
    const body = JSON.parse(res.body);
    expect(body.refundId).toBeDefined();
    expect(body.paymentId).toBe(payment.id);
    expect(body.status).toBe('PENDING');
  });

  it('rejects refund for non-SUCCESS payment', async () => {
    const payment = await createTestPayment('merchant_1', 'PENDING');

    const res = await app.inject({
      method: 'POST',
      url: `/api/payments/${payment.id}/refund`,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(res.statusCode).toBe(409);
  });

  it('prevents double refund on the same payment', async () => {
    const payment = await createTestPayment('merchant_1', 'SUCCESS');

    const first = await app.inject({
      method: 'POST',
      url: `/api/payments/${payment.id}/refund`,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'First refund' }),
    });

    expect(first.statusCode).toBe(202);

    // Second refund attempt should fail
    const second = await app.inject({
      method: 'POST',
      url: `/api/payments/${payment.id}/refund`,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'Second refund attempt' }),
    });

    expect(second.statusCode).toBe(409);
  });

  it('returns 404 for refund on non-existent payment', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/payments/${randomUUID()}/refund`,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(res.statusCode).toBe(404);
  });

  it('lists refunds for a payment', async () => {
    const payment = await createTestPayment('merchant_1', 'SUCCESS');

    // Create a refund
    await app.inject({
      method: 'POST',
      url: `/api/payments/${payment.id}/refund`,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'Test refund' }),
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/payments/${payment.id}/refunds`,
    });

    expect(res.statusCode).toBe(200);
    const { data } = JSON.parse(res.body);
    expect(data.length).toBeGreaterThanOrEqual(1);
  });
});
