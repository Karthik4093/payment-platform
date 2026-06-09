import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { refundService } from './refund.service.js';
import { parseCorrelationId } from '../../common/utils/correlation.js';
import { toHttpError } from '../../common/utils/errors.js';

export async function refundRoutes(fastify: FastifyInstance): Promise<void> {
  // POST /api/payments/:id/refund
  fastify.post('/payments/:id/refund', {
    schema: { description: 'Initiate a refund for a payment', tags: ['Refunds'] },
  }, async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const body = (request.body ?? {}) as { amount?: number; reason?: string };
      const correlationId = parseCorrelationId((request.headers as Record<string, string>)['x-correlation-id']);
      const refund = await refundService.createRefund({ paymentId: id, amount: body.amount, reason: body.reason, correlationId });
      return reply.code(202).send(refund);
    } catch (err) {
      const error = toHttpError(err);
      return reply.code(error.statusCode).send({ error: error.code, message: error.message });
    }
  });

  // GET /api/payments/:id/refunds
  fastify.get('/payments/:id/refunds', {
    schema: { description: 'List refunds for a payment', tags: ['Refunds'] },
  }, async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      return reply.send({ data: await refundService.listRefunds(id) });
    } catch (err) {
      const error = toHttpError(err);
      return reply.code(error.statusCode).send({ error: error.code, message: error.message });
    }
  });

  // GET /api/refunds/:id
  fastify.get('/refunds/:id', {
    schema: { description: 'Get refund by ID', tags: ['Refunds'] },
  }, async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      return reply.send(await refundService.getRefund(id));
    } catch (err) {
      const error = toHttpError(err);
      return reply.code(error.statusCode).send({ error: error.code, message: error.message });
    }
  });
}
