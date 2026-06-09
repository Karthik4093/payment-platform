import { prisma } from '../../common/db/prisma.js';
import { withLock } from '../../common/redis/lock.js';
import { publishToQueue, QUEUES } from '../../common/queue/rabbitmq.js';
import { logger } from '../../common/logger/index.js';
import { NotFoundError, ConflictError, LockError } from '../../common/utils/errors.js';
import { PaymentStateMachine } from '../payment/payment.state-machine.js';
import { paymentRepository } from '../payment/payment.repository.js';
import { refundRepository } from './refund.repository.js';
import type { CreateRefundInput, RefundResponse } from './refund.types.js';

function toRefundResponse(r: {
  id: string;
  paymentId: string;
  amount: bigint;
  status: import('@prisma/client').RefundStatus;
  reason: string | null;
  gatewayRef: string | null;
  createdAt: Date;
  updatedAt: Date;
}): RefundResponse {
  return {
    refundId: r.id,
    paymentId: r.paymentId,
    amount: Number(r.amount),
    status: r.status,
    reason: r.reason,
    gatewayRef: r.gatewayRef,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

export class RefundService {
  async createRefund(input: CreateRefundInput): Promise<RefundResponse> {
    // Acquire distributed lock on the payment to prevent double-refund races
    const lockKey = `refund:${input.paymentId}`;

    let refund: RefundResponse;
    try {
      refund = await withLock(
        lockKey,
        async () => {
          return await this._createRefundInLock(input);
        },
        15_000,
        5,
      );
    } catch (err) {
      if ((err as Error).message?.includes('Could not acquire lock')) {
        throw new LockError(`refund for payment ${input.paymentId}`);
      }
      throw err;
    }

    // Publish to queue for async processing
    await publishToQueue(QUEUES.REFUND_PROCESS, {
      refundId: refund.refundId,
      paymentId: input.paymentId,
      amount: refund.amount,
      currency: 'USD',
      correlationId: input.correlationId,
    });

    logger.info(
      { refundId: refund.refundId, paymentId: input.paymentId },
      'refund.created',
    );

    return refund;
  }

  private async _createRefundInLock(input: CreateRefundInput): Promise<RefundResponse> {
    return await prisma.$transaction(async (tx) => {
      // Fetch latest payment state inside the transaction
      const payment = await tx.payment.findUnique({
        where: { id: input.paymentId },
      });

      if (!payment) throw new NotFoundError('Payment', input.paymentId);

      // Only refund SUCCESS payments
      if (payment.status !== 'SUCCESS') {
        throw new ConflictError(
          `Payment ${input.paymentId} is in state ${payment.status}, not refundable`,
        );
      }

      // Check for existing non-failed refunds (prevent double-refund)
      const existingRefunds = await tx.refund.count({
        where: {
          paymentId: input.paymentId,
          status: { in: ['SUCCESS', 'PROCESSING', 'PENDING'] },
        },
      });
      if (existingRefunds > 0) {
        throw new ConflictError(
          `Refund already exists for payment ${input.paymentId}`,
        );
      }

      // Validate refund amount
      const refundAmount = BigInt(input.amount ?? Number(payment.amount));
      if (refundAmount > payment.amount) {
        throw new ConflictError('Refund amount exceeds payment amount');
      }

      // Check sum of prior successful refunds won't exceed payment
      const priorRefunds = await tx.refund.aggregate({
        where: { paymentId: input.paymentId, status: 'SUCCESS' },
        _sum: { amount: true },
      });
      const priorTotal = priorRefunds._sum.amount ?? BigInt(0);
      if (priorTotal + refundAmount > payment.amount) {
        throw new ConflictError('Cumulative refunds would exceed payment amount');
      }

      // Transition payment to REFUND_PENDING
      PaymentStateMachine.assertTransition(payment.status, 'REFUND_PENDING');
      await tx.payment.update({
        where: { id: input.paymentId },
        data: { status: 'REFUND_PENDING' },
      });

      // Create the refund record
      const refund = await tx.refund.create({
        data: {
          paymentId: input.paymentId,
          amount: refundAmount,
          reason: input.reason,
          status: 'PENDING',
        },
      });

      return toRefundResponse(refund);
    });
  }

  async getRefund(id: string): Promise<RefundResponse> {
    const refund = await refundRepository.findById(id);
    if (!refund) throw new NotFoundError('Refund', id);
    return toRefundResponse(refund);
  }

  async listRefunds(paymentId: string): Promise<RefundResponse[]> {
    const refunds = await refundRepository.findByPaymentId(paymentId);
    return refunds.map(toRefundResponse);
  }
}

export const refundService = new RefundService();
