import { randomUUID } from 'crypto';
import { prisma } from '../../common/db/prisma.js';
import { publishToQueue, QUEUES } from '../../common/queue/rabbitmq.js';
import { logger } from '../../common/logger/index.js';
import { NotFoundError, ConflictError } from '../../common/utils/errors.js';
import { PaymentStateMachine } from './payment.state-machine.js';
import { paymentRepository } from './payment.repository.js';
import { fraudService } from '../fraud/fraud.service.js';
import type { CreatePaymentInput, PaymentResponse } from './payment.types.js';
import type { PaymentStatus } from '@prisma/client';

function toPaymentResponse(p: {
  id: string;
  merchantId: string;
  amount: bigint;
  currency: string;
  status: PaymentStatus;
  retryCount: number;
  gatewayRef: string | null;
  correlationId: string | null;
  failureReason: string | null;
  createdAt: Date;
  updatedAt: Date;
  processedAt: Date | null;
}): PaymentResponse {
  return {
    paymentId: p.id,
    merchantId: p.merchantId,
    amount: Number(p.amount),
    currency: p.currency,
    status: p.status,
    retryCount: p.retryCount,
    gatewayRef: p.gatewayRef,
    correlationId: p.correlationId,
    failureReason: p.failureReason,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    processedAt: p.processedAt,
  };
}

export class PaymentService {
  async createPayment(input: CreatePaymentInput): Promise<PaymentResponse> {
    // 1. Check idempotency key
    const existing = await prisma.idempotencyKey.findUnique({
      where: { key: input.idempotencyKey },
    });
    if (existing) {
      logger.info({ key: input.idempotencyKey }, 'Idempotency key hit — returning cached response');
      return existing.response as PaymentResponse;
    }

    // 2. Fraud pre-check
    await fraudService.checkPrePayment(input.merchantId, input.amount);

    // 3. Create payment + idempotency key atomically
    const payment = await prisma.$transaction(async (tx) => {
      const p = await tx.payment.create({
        data: {
          merchantId: input.merchantId,
          amount: BigInt(input.amount),
          currency: input.currency,
          correlationId: input.correlationId,
          metadata: input.metadata ?? {},
        },
      });

      const response = toPaymentResponse(p);

      await tx.idempotencyKey.create({
        data: {
          key: input.idempotencyKey,
          merchantId: input.merchantId,
          paymentId: p.id,
          response: response as unknown as Record<string, unknown>,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24h TTL
        },
      });

      return p;
    });

    const response = toPaymentResponse(payment);

    logger.info(
      { paymentId: payment.id, merchantId: input.merchantId, correlationId: input.correlationId },
      'payment.created',
    );

    // 4. Publish to queue for async processing
    await publishToQueue(QUEUES.PAYMENT_PROCESS, {
      paymentId: payment.id,
      merchantId: payment.merchantId,
      amount: Number(payment.amount),
      currency: payment.currency,
      retryCount: 0,
      correlationId: input.correlationId,
      scheduledAt: new Date().toISOString(),
    });

    return response;
  }

  async getPayment(id: string): Promise<PaymentResponse> {
    const payment = await paymentRepository.findById(id);
    if (!payment) throw new NotFoundError('Payment', id);
    return toPaymentResponse(payment);
  }

  async listPayments(merchantId: string, limit = 50, offset = 0): Promise<PaymentResponse[]> {
    const payments = await paymentRepository.findByMerchant(merchantId, limit, offset);
    return payments.map(toPaymentResponse);
  }

  async transitionState(
    paymentId: string,
    toStatus: PaymentStatus,
    extras: Partial<{
      gatewayRef: string;
      failureReason: string;
      retryCount: number;
      processedAt: Date;
    }> = {},
  ): Promise<PaymentResponse> {
    const payment = await paymentRepository.findByIdOrThrow(paymentId);
    PaymentStateMachine.assertTransition(payment.status, toStatus);

    const updated = await paymentRepository.updateStatus(paymentId, toStatus, extras);
    logger.info(
      { paymentId, from: payment.status, to: toStatus },
      `payment.${toStatus.toLowerCase()}`,
    );
    return toPaymentResponse(updated);
  }
}

export const paymentService = new PaymentService();
