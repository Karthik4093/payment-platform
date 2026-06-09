import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { randomUUID } from 'crypto';
import { createHmac } from 'crypto';

vi.mock('../../src/common/queue/rabbitmq.js', () => ({
  publishToQueue: vi.fn(async () => true),
  publishToDelayQueue: vi.fn(async () => true),
  QUEUES: { PAYMENT_PROCESS: 'payment.process', REFUND_PROCESS: 'refund.process', PAYMENT_DEADLETTER: 'payment.deadletter' },
  connectRabbitMQ: vi.fn(),
  checkRabbitMQHealth: vi.fn(async () => true),
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

const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET ?? 'super-secret-webhook-signing-key-change-in-production';

function makeSignature(payload: string): string {
  return `sha256=${createHmac('sha256', WEBHOOK_SECRET).update(payload).digest('hex')}`;
}

describe('Webhook Processing (Integration)', () => {
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

  it('accepts webhook with valid signature', async () => {
    const payment = await createTestPayment('merchant_1', 'CAPTURED');

    const payload = {
      eventId: randomUUID(),
      eventType: 'payment.success',
      paymentId: payment.id,
      status: 'SUCCESS',
      gatewayRef: `gw_${randomUUID().slice(0, 8)}`,
      amount: 1000,
      currency: 'USD',
      timestamp: new Date().toISOString(),
    };
    const body = JSON.stringify(payload);
    const signature = makeSignature(body);

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/payment',
      headers: { 'Content-Type': 'application/json', 'X-Signature': signature },
      body,
    });

    expect(res.statusCode).toBe(200);
    const resBody = JSON.parse(res.body);
    expect(resBody.received).toBe(true);
  });

  it('rejects webhook with invalid signature', async () => {
    const payment = await createTestPayment('merchant_1');
    const payload = {
      eventId: randomUUID(),
      eventType: 'payment.success',
      paymentId: payment.id,
      status: 'SUCCESS',
      gatewayRef: 'gw_123',
      amount: 1000,
      currency: 'USD',
      timestamp: new Date().toISOString(),
    };

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/payment',
      headers: { 'Content-Type': 'application/json', 'X-Signature': 'sha256=invalid_signature' },
      body: JSON.stringify(payload),
    });

    expect(res.statusCode).toBe(401);
  });

  it('deduplicates webhook events with same eventId', async () => {
    const payment = await createTestPayment('merchant_1', 'CAPTURED');
    const eventId = randomUUID();

    const payload = {
      eventId,
      eventType: 'payment.success',
      paymentId: payment.id,
      status: 'SUCCESS',
      gatewayRef: 'gw_abc',
      amount: 1000,
      currency: 'USD',
      timestamp: new Date().toISOString(),
    };
    const body = JSON.stringify(payload);
    const signature = makeSignature(body);
    const headers = { 'Content-Type': 'application/json', 'X-Signature': signature };

    const first = await app.inject({ method: 'POST', url: '/webhooks/payment', headers, body });
    const second = await app.inject({ method: 'POST', url: '/webhooks/payment', headers, body });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(JSON.parse(second.body).duplicate).toBe(true);
  });
});
