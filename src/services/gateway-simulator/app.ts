import Fastify from 'fastify';
import { randomUUID } from 'crypto';
import { createHmac } from 'crypto';
import { logger } from '../../common/logger/index.js';

const WEBHOOK_URL = process.env.WEBHOOK_URL ?? 'http://localhost:3000/webhooks/payment';
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET ?? 'change-me';

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function randomInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function signPayload(payload: string): string {
  return createHmac('sha256', WEBHOOK_SECRET).update(payload).digest('hex');
}

async function sendWebhook(payload: Record<string, unknown>) {
  const body = JSON.stringify(payload);
  const signature = `sha256=${signPayload(body)}`;

  try {
    const res = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Signature': signature,
      },
      body,
    });
    logger.info({ status: res.status, eventId: payload.eventId }, 'Webhook sent');
  } catch (err) {
    logger.warn({ err, eventId: payload.eventId }, 'Webhook delivery failed');
  }
}

export function buildGatewayApp() {
  const app = Fastify({ logger: false });

  // ── Payment Processing ─────────────────────────────────────
  app.post('/gateway/pay', async (request, reply) => {
    const body = request.body as {
      paymentId: string;
      amount: number;
      currency: string;
      merchantId: string;
    };

    // Simulate network latency: 500ms – 5000ms
    const latency = randomInt(500, 5000);
    await sleep(latency);

    // Weighted random outcome: 70% SUCCESS, 20% FAILURE, 10% TIMEOUT
    const roll = Math.random();

    if (roll < 0.10) {
      // Simulate gateway timeout — we've already slept, just return timeout
      logger.info({ paymentId: body.paymentId, latency }, 'Gateway: TIMEOUT');
      await sleep(5000); // Additional delay to trigger client timeout
      return reply.code(504).send({ outcome: 'TIMEOUT', errorCode: 'GATEWAY_TIMEOUT', errorMessage: 'Gateway timed out' });
    }

    if (roll < 0.30) {
      logger.info({ paymentId: body.paymentId, latency }, 'Gateway: FAILURE');
      const gatewayRef = `gw_fail_${randomUUID().slice(0, 8)}`;

      // Fire webhook for failure
      setImmediate(() =>
        sendWebhook({
          eventId: randomUUID(),
          eventType: 'payment.failed',
          paymentId: body.paymentId,
          status: 'FAILED',
          gatewayRef,
          amount: body.amount,
          currency: body.currency,
          timestamp: new Date().toISOString(),
        }),
      );

      return reply.send({
        outcome: 'FAILURE',
        gatewayRef,
        errorCode: 'CARD_DECLINED',
        errorMessage: 'Card was declined by issuer',
      });
    }

    // SUCCESS
    const gatewayRef = `gw_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
    logger.info({ paymentId: body.paymentId, gatewayRef, latency }, 'Gateway: SUCCESS');

    // Fire webhook asynchronously
    setImmediate(() =>
      sendWebhook({
        eventId: randomUUID(),
        eventType: 'payment.success',
        paymentId: body.paymentId,
        status: 'SUCCESS',
        gatewayRef,
        amount: body.amount,
        currency: body.currency,
        timestamp: new Date().toISOString(),
      }),
    );

    return reply.send({
      outcome: 'SUCCESS',
      gatewayRef,
      errorCode: null,
      errorMessage: null,
    });
  });

  // ── Refund Processing ──────────────────────────────────────
  app.post('/gateway/refund', async (request, reply) => {
    const body = request.body as {
      refundId: string;
      paymentId: string;
      amount: number;
      gatewayRef: string;
    };

    await sleep(randomInt(200, 1500));

    const roll = Math.random();
    if (roll < 0.05) {
      return reply.send({
        outcome: 'FAILURE',
        gatewayRef: null,
        errorCode: 'REFUND_FAILED',
        errorMessage: 'Refund rejected by gateway',
      });
    }

    const refundGatewayRef = `gw_ref_${randomUUID().slice(0, 8)}`;

    setImmediate(() =>
      sendWebhook({
        eventId: randomUUID(),
        eventType: 'payment.refunded',
        paymentId: body.paymentId,
        status: 'REFUNDED',
        gatewayRef: refundGatewayRef,
        amount: body.amount,
        currency: 'USD',
        timestamp: new Date().toISOString(),
      }),
    );

    return reply.send({
      outcome: 'SUCCESS',
      gatewayRef: refundGatewayRef,
      errorCode: null,
      errorMessage: null,
    });
  });

  // ── Inventory Service ──────────────────────────────────────
  app.post('/inventory/reserve', async (request, reply) => {
    const body = request.body as { paymentId: string; amount: number; currency: string };
    await sleep(randomInt(100, 500));

    // 10% failure rate
    if (Math.random() < 0.10) {
      return reply.send({ success: false, error: 'Out of stock' });
    }

    const reservationId = `res_${randomUUID().slice(0, 8)}`;
    logger.info({ paymentId: body.paymentId, reservationId }, 'Inventory reserved');
    return reply.send({ success: true, reservationId });
  });

  app.post('/inventory/release', async (request, reply) => {
    const body = request.body as { reservationId: string };
    await sleep(randomInt(50, 200));
    logger.info({ reservationId: body.reservationId }, 'Inventory released');
    return reply.send({ success: true });
  });

  // ── Shipping Service ──────────────────────────────────────
  app.post('/shipping/create', async (request, reply) => {
    const body = request.body as { paymentId: string; reservationId: string; amount: number };
    await sleep(randomInt(200, 800));

    // 15% failure rate
    if (Math.random() < 0.15) {
      return reply.send({ success: false, error: 'Carrier unavailable' });
    }

    const shipmentId = `ship_${randomUUID().slice(0, 8)}`;
    logger.info({ paymentId: body.paymentId, shipmentId }, 'Shipment created');
    return reply.send({ success: true, shipmentId });
  });

  app.post('/shipping/cancel', async (request, reply) => {
    const body = request.body as { shipmentId: string };
    await sleep(randomInt(50, 200));
    logger.info({ shipmentId: body.shipmentId }, 'Shipment cancelled');
    return reply.send({ success: true });
  });

  // ── Health ─────────────────────────────────────────────────
  app.get('/health', async (_req, reply) => {
    return reply.send({ status: 'healthy', service: 'gateway-simulator' });
  });

  return app;
}
