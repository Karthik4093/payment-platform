import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import staticFiles from '@fastify/static';
import swagger from '@fastify/swagger';
import swaggerUI from '@fastify/swagger-ui';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../../common/logger/index.js';
import { checkDBHealth } from '../../common/db/prisma.js';
import { checkRedisHealth } from '../../common/redis/client.js';
import { checkRabbitMQHealth } from '../../common/queue/rabbitmq.js';
import { paymentRoutes } from '../../modules/payment/payment.routes.js';
import { refundRoutes } from '../../modules/refund/refund.routes.js';
import { webhookRoutes } from '../../modules/webhook/webhook.routes.js';
import { ledgerRoutes } from '../../modules/ledger/ledger.routes.js';
import { sagaRoutes } from '../../modules/saga/saga.routes.js';
import { toHttpError } from '../../common/utils/errors.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export function buildApp() {
  const app = Fastify({
    logger: false, // We use pino directly
    trustProxy: true,
    genReqId: () => crypto.randomUUID(),
  });

  // ── Hooks ─────────────────────────────────────────────────
  app.addHook('onRequest', async (request) => {
    logger.info(
      {
        reqId: request.id,
        method: request.method,
        url: request.url,
        correlationId: (request.headers as Record<string, string>)['x-correlation-id'],
      },
      'incoming request',
    );
  });

  app.addHook('onResponse', async (request, reply) => {
    logger.info(
      {
        reqId: request.id,
        method: request.method,
        url: request.url,
        statusCode: reply.statusCode,
        responseTime: reply.elapsedTime,
      },
      'request completed',
    );
  });

  // ── Plugins ───────────────────────────────────────────────
  app.register(cors, { origin: true });
  app.register(helmet, { contentSecurityPolicy: false });
  app.register(rateLimit, {
    max: 1000,
    timeWindow: '1 minute',
    errorResponseBuilder: () => ({
      error: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many requests, please try again later',
    }),
  });

  // Serve static UI files
  const publicDir = join(__dirname, '..', '..', '..', 'public');
  app.register(staticFiles, {
    root: publicDir,
    prefix: '/',
    decorateReply: false,
  });

  // Swagger / OpenAPI
  app.register(swagger, {
    openapi: {
      openapi: '3.0.0',
      info: {
        title: 'Payment Orchestration Platform API',
        description: 'Production-grade payment orchestration with idempotency, saga, and ledger',
        version: '1.0.0',
      },
      tags: [
        { name: 'Payments', description: 'Payment operations' },
        { name: 'Refunds', description: 'Refund operations' },
        { name: 'Webhooks', description: 'Webhook endpoints' },
        { name: 'Health', description: 'Health checks' },
      ],
    },
  });

  app.register(swaggerUI, {
    routePrefix: '/docs',
    uiConfig: { deepLinking: true },
  });

  // ── Routes ────────────────────────────────────────────────
  app.register(paymentRoutes, { prefix: '/api' });
  app.register(refundRoutes, { prefix: '/api' });
  app.register(webhookRoutes, { prefix: '' });
  app.register(ledgerRoutes, { prefix: '/api' });
  app.register(sagaRoutes, { prefix: '/api' });

  // Health check
  app.get(
    '/health',
    {
      schema: {
        description: 'Service health check',
        tags: ['Health'],
      },
    },
    async (_req, reply) => {
      const [db, redis, mq] = await Promise.all([
        checkDBHealth(),
        checkRedisHealth(),
        checkRabbitMQHealth(),
      ]);

      const healthy = db && redis && mq;
      // Always return HTTP 200 — Render uses /health as a liveness probe.
      // Returning 503 makes Render think the process crashed and restart-loops.
      // Actual dependency status is in the body for monitoring/alerting.
      return reply.code(200).send({
        status: healthy ? 'healthy' : 'degraded',
        checks: {
          postgres: db ? 'ok' : 'error',
          redis: redis ? 'ok' : 'error',
          rabbitmq: mq ? 'ok' : 'error',
        },
        timestamp: new Date().toISOString(),
      });
    },
  );

  // Global error handler
  app.setErrorHandler((err, _request, reply) => {
    const error = toHttpError(err);
    logger.error({ err }, 'Unhandled error');
    return reply.code(error.statusCode).send({
      error: error.code,
      message: error.message,
    });
  });

  return app;
}
