import type { FastifyInstance } from 'fastify';
import { ledgerService } from './ledger.service.js';
import { toHttpError } from '../../common/utils/errors.js';

export async function ledgerRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/payments/:id/ledger', {
    schema: { description: 'Get ledger entries for a payment', tags: ['Ledger'] },
  }, async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      return reply.send({ data: await ledgerService.getLedgerEntries(id) });
    } catch (err) {
      const error = toHttpError(err);
      return reply.code(error.statusCode).send({ error: error.code, message: error.message });
    }
  });

  fastify.get('/merchants/:id/balance', {
    schema: { description: 'Get merchant account balance', tags: ['Ledger'] },
  }, async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const q = request.query as { currency?: string };
      const balance = await ledgerService.getMerchantBalance(id, q.currency ?? 'USD');
      return reply.send({ merchantId: id, accountId: balance.accountId, currency: balance.currency, balance: balance.balance.toString() });
    } catch (err) {
      const error = toHttpError(err);
      return reply.code(error.statusCode).send({ error: error.code, message: error.message });
    }
  });
}
