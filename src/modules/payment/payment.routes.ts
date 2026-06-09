import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { paymentService } from './payment.service.js';
import { createPaymentSchema } from './payment.schema.js';
import { parseCorrelationId } from '../../common/utils/correlation.js';
import { toHttpError, ValidationError, NotFoundError } from '../../common/utils/errors.js';
import { paymentRepository } from './payment.repository.js';

export async function paymentRoutes(fastify: FastifyInstance): Promise<void> {
  // POST /api/payments
  fastify.post('/payments', {
    schema: { description: 'Create a new payment', tags: ['Payments'] },
  }, async (request, reply) => {
    const idempotencyKey = (request.headers as Record<string, string>)['idempotency-key'];
    if (!idempotencyKey) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: 'Idempotency-Key header is required' });
    }

    const parsed = createPaymentSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.message, details: parsed.error.errors });
    }

    try {
      const correlationId = parseCorrelationId((request.headers as Record<string, string>)['x-correlation-id']);
      const payment = await paymentService.createPayment({ ...parsed.data, idempotencyKey, correlationId });
      return reply.code(202).send({
        paymentId: payment.paymentId,
        status: payment.status,
        amount: payment.amount,
        currency: payment.currency,
        correlationId: payment.correlationId,
        createdAt: payment.createdAt.toISOString(),
      });
    } catch (err) {
      const error = toHttpError(err);
      return reply.code(error.statusCode).send({ error: error.code, message: error.message });
    }
  });

  // GET /api/payments/:id
  fastify.get('/payments/:id', {
    schema: { description: 'Get payment by ID', tags: ['Payments'] },
  }, async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const payment = await paymentService.getPayment(id);
      return reply.send(payment);
    } catch (err) {
      const error = toHttpError(err);
      return reply.code(error.statusCode).send({ error: error.code, message: error.message });
    }
  });

  // GET /api/payments/:id/attempts
  fastify.get('/payments/:id/attempts', {
    schema: { description: 'Get payment attempts', tags: ['Payments'] },
  }, async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      return reply.send(await paymentRepository.getAttempts(id));
    } catch (err) {
      const error = toHttpError(err);
      return reply.code(error.statusCode).send({ error: error.code, message: error.message });
    }
  });

  // GET /api/payments
  fastify.get('/payments', {
    schema: { description: 'List payments for a merchant', tags: ['Payments'] },
  }, async (request, reply) => {
    try {
      const q = request.query as { merchantId?: string; limit?: string; offset?: string };
      if (!q.merchantId) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: 'merchantId query param required' });
      const payments = await paymentService.listPayments(q.merchantId, parseInt(q.limit ?? '50'), parseInt(q.offset ?? '0'));
      return reply.send({ data: payments, limit: parseInt(q.limit ?? '50'), offset: parseInt(q.offset ?? '0') });
    } catch (err) {
      const error = toHttpError(err);
      return reply.code(error.statusCode).send({ error: error.code, message: error.message });
    }
  });
}
