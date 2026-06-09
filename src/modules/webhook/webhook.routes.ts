import type { FastifyInstance } from 'fastify';
import { webhookService } from './webhook.service.js';
import { logger } from '../../common/logger/index.js';
import { toHttpError } from '../../common/utils/errors.js';

export async function webhookRoutes(fastify: FastifyInstance): Promise<void> {
  // POST /webhooks/payment
  fastify.post('/webhooks/payment', {
    schema: { description: 'Receive payment webhook from gateway', tags: ['Webhooks'] },
  }, async (request, reply) => {
    const signatureHeader = (request.headers as Record<string, string>)['x-signature'];
    if (!signatureHeader) {
      return reply.code(400).send({ error: 'MISSING_SIGNATURE', message: 'X-Signature header required' });
    }

    const rawBody = JSON.stringify(request.body);
    if (!webhookService.verifySignature(rawBody, signatureHeader)) {
      logger.warn({ signatureHeader }, 'webhook.invalid_signature');
      return reply.code(401).send({ error: 'INVALID_SIGNATURE', message: 'Webhook signature verification failed' });
    }

    try {
      const result = await webhookService.processEvent(rawBody, request.body as any, signatureHeader);
      if (result.isDuplicate) return reply.send({ received: true, duplicate: true });
      return reply.send({ received: true, processed: result.processed });
    } catch (err) {
      const error = toHttpError(err);
      return reply.code(error.statusCode).send({ error: error.code, message: error.message });
    }
  });

  // GET /api/payments/:id/webhook-events
  fastify.get('/payments/:id/webhook-events', {
    schema: { description: 'List webhook events for a payment', tags: ['Webhooks'] },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    return reply.send({ data: await webhookService.getWebhookEvents(id) });
  });
}
