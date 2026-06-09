import type { FastifyInstance } from 'fastify';
import { sagaOrchestrator } from './saga.orchestrator.js';
import { toHttpError } from '../../common/utils/errors.js';

export async function sagaRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/payments/:id/saga', {
    schema: { description: 'Get saga status for a payment', tags: ['Saga'] },
  }, async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const saga = await sagaOrchestrator.getSagaStatus(id);
      if (!saga) return reply.send(null);
      return reply.send({
        sagaId: saga.id,
        paymentId: saga.paymentId,
        status: saga.status,
        currentStep: saga.currentStep,
        steps: saga.steps,
        compensation: saga.compensation,
        startedAt: saga.startedAt,
        completedAt: saga.completedAt,
      });
    } catch (err) {
      const error = toHttpError(err);
      return reply.code(error.statusCode).send({ error: error.code, message: error.message });
    }
  });
}
