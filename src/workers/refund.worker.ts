import type { Channel, ConsumeMessage } from 'amqplib';
import { acquireLock } from '../common/redis/lock.js';
import { logger } from '../common/logger/index.js';
import { paymentRepository } from '../modules/payment/payment.repository.js';
import { refundRepository } from '../modules/refund/refund.repository.js';
import { gatewayClient } from '../modules/gateway/gateway.client.js';
import { ledgerService } from '../modules/ledger/ledger.service.js';
import { PaymentStateMachine } from '../modules/payment/payment.state-machine.js';
import { prisma } from '../common/db/prisma.js';
import type { RefundMessage } from '../common/queue/types.js';

export async function handleRefundMessage(
  msg: ConsumeMessage,
  channel: Channel,
): Promise<void> {
  let message: RefundMessage;

  try {
    message = JSON.parse(msg.content.toString()) as RefundMessage;
  } catch {
    logger.error('Failed to parse refund message — discarding');
    channel.nack(msg, false, false);
    return;
  }

  const { refundId, paymentId, merchantId, amount, currency, correlationId } = message;
  const log = logger.child({ refundId, paymentId, merchantId, correlationId });

  log.info('refund.processing');

  // Distributed lock per refund (belt-and-suspenders on top of DB-level lock)
  const lock = await acquireLock(`refund:${refundId}`, 15_000);

  if (!lock.acquired) {
    log.warn('Could not acquire refund lock — requeuing');
    channel.nack(msg, false, true);
    return;
  }

  try {
    const refund = await refundRepository.findById(refundId);

    if (!refund) {
      log.warn('Refund not found — discarding');
      channel.ack(msg);
      return;
    }

    // Idempotency check
    if (refund.status !== 'PENDING') {
      log.info({ status: refund.status }, 'Refund already processed — acking');
      channel.ack(msg);
      return;
    }

    // Update to PROCESSING
    await refundRepository.updateStatus(refundId, 'PROCESSING');

    const payment = await paymentRepository.findById(paymentId);
    if (!payment || !payment.gatewayRef) {
      log.error('Cannot refund — payment has no gateway ref');
      await refundRepository.updateStatus(refundId, 'FAILED');
      channel.ack(msg);
      return;
    }

    // Call gateway refund endpoint
    const result = await gatewayClient.processRefund({
      refundId,
      paymentId,
      amount,
      gatewayRef: payment.gatewayRef,
    });

    if (result.outcome === 'SUCCESS') {
      // Transactional update of refund + payment + ledger
      await prisma.$transaction(async (tx) => {
        await tx.refund.update({
          where: { id: refundId },
          data: {
            status: 'SUCCESS',
            gatewayRef: result.gatewayRef,
            processedAt: new Date(),
          },
        });

        // Transition payment REFUND_PENDING → REFUNDED
        PaymentStateMachine.assertTransition('REFUND_PENDING', 'REFUNDED');
        await tx.payment.update({
          where: { id: paymentId },
          data: { status: 'REFUNDED' },
        });
      });

      // Record refund ledger entries
      await ledgerService.recordRefund(
        refundId,
        paymentId,
        merchantId,
        BigInt(amount),
        currency,
      );

      log.info({ gatewayRef: result.gatewayRef }, 'refund.success');
    } else {
      await refundRepository.updateStatus(refundId, 'FAILED');

      // Roll back payment status to SUCCESS so it can be retried
      await paymentRepository.updateStatus(paymentId, 'SUCCESS');

      log.warn({ outcome: result.outcome, errorCode: result.errorCode }, 'refund.failed');
    }

    channel.ack(msg);
  } catch (err) {
    log.error({ err }, 'refund.worker.error');
    channel.nack(msg, false, false);
  } finally {
    await lock.release();
  }
}
