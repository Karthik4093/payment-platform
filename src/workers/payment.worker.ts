import type { Channel, ConsumeMessage } from 'amqplib';
import { prisma } from '../common/db/prisma.js';
import { acquireLock } from '../common/redis/lock.js';
import { publishToQueue, publishToDelayQueue, QUEUES } from '../common/queue/rabbitmq.js';
import { logger } from '../common/logger/index.js';
import { PaymentStateMachine } from '../modules/payment/payment.state-machine.js';
import { paymentRepository } from '../modules/payment/payment.repository.js';
import { gatewayClient } from '../modules/gateway/gateway.client.js';
import { ledgerService } from '../modules/ledger/ledger.service.js';
import { fraudService } from '../modules/fraud/fraud.service.js';
import { sagaOrchestrator } from '../modules/saga/saga.orchestrator.js';
import type { PaymentMessage } from '../common/queue/types.js';

const MAX_RETRIES = parseInt(process.env.RETRY_MAX_ATTEMPTS ?? '5', 10);

export async function handlePaymentMessage(
  msg: ConsumeMessage,
  channel: Channel,
): Promise<void> {
  let message: PaymentMessage;

  try {
    message = JSON.parse(msg.content.toString()) as PaymentMessage;
  } catch {
    logger.error('Failed to parse payment message — discarding');
    channel.nack(msg, false, false);
    return;
  }

  const { paymentId, merchantId, amount, currency, retryCount, correlationId } = message;
  const log = logger.child({ paymentId, merchantId, retryCount, correlationId });

  log.info('payment.processing');

  // Acquire distributed lock to prevent duplicate processing
  const lock = await acquireLock(`payment:${paymentId}`, 30_000);

  if (!lock.acquired) {
    log.warn('Could not acquire lock — requeuing');
    channel.nack(msg, false, true);
    return;
  }

  try {
    // Fetch fresh payment state
    const payment = await paymentRepository.findById(paymentId);

    if (!payment) {
      log.warn('Payment not found — discarding');
      channel.ack(msg);
      return;
    }

    // Idempotency: skip if already past PROCESSING
    if (payment.status !== 'PENDING' && payment.status !== 'RETRYING') {
      log.info({ status: payment.status }, 'Payment already processed — acking');
      channel.ack(msg);
      return;
    }

    // Transition to PROCESSING
    PaymentStateMachine.assertTransition(payment.status, 'PROCESSING');
    await paymentRepository.updateStatus(paymentId, 'PROCESSING');

    // Record attempt
    const attemptNum = retryCount + 1;
    const attemptStart = Date.now();

    const gatewayResult = await gatewayClient.processPayment({
      paymentId,
      amount,
      currency,
      merchantId,
    });

    const latencyMs = Date.now() - attemptStart;

    await paymentRepository.createAttempt({
      paymentId,
      attemptNumber: attemptNum,
      status: gatewayResult.outcome,
      gatewayRef: gatewayResult.gatewayRef ?? undefined,
      errorCode: gatewayResult.errorCode ?? undefined,
      errorMessage: gatewayResult.errorMessage ?? undefined,
      latencyMs,
    });

    if (gatewayResult.outcome === 'SUCCESS') {
      // PROCESSING → AUTHORIZED → CAPTURED → SUCCESS
      await paymentRepository.updateStatus(paymentId, 'AUTHORIZED', {
        gatewayRef: gatewayResult.gatewayRef ?? undefined,
      });
      await paymentRepository.updateStatus(paymentId, 'CAPTURED');
      await paymentRepository.updateStatus(paymentId, 'SUCCESS', {
        processedAt: new Date(),
      });

      // Record double-entry ledger
      await ledgerService.recordPaymentSuccess(
        paymentId,
        merchantId,
        BigInt(amount),
        currency,
      );

      log.info({ gatewayRef: gatewayResult.gatewayRef }, 'payment.success');

      // Trigger saga asynchronously (fire-and-forget, non-blocking)
      sagaOrchestrator.execute(paymentId).catch((err) =>
        log.error({ err }, 'saga.start_failed'),
      );

      channel.ack(msg);
    } else {
      // FAILURE or TIMEOUT
      const nextRetryCount = retryCount + 1;

      if (nextRetryCount < MAX_RETRIES) {
        // Transition to RETRYING
        await paymentRepository.updateStatus(paymentId, 'RETRYING');
        await paymentRepository.incrementRetryCount(paymentId);

        // Publish to exponential-backoff delay queue
        await publishToDelayQueue(
          {
            ...message,
            retryCount: nextRetryCount,
            scheduledAt: new Date().toISOString(),
          },
          retryCount,
        );

        log.info(
          { outcome: gatewayResult.outcome, nextRetryCount },
          'payment.retrying',
        );
      } else {
        // Max retries exhausted
        const finalStatus = PaymentStateMachine.validateRetryTransition(
          payment.status === 'RETRYING' ? 'RETRYING' : 'PROCESSING',
          retryCount,
          MAX_RETRIES,
        );

        await paymentRepository.updateStatus(paymentId, finalStatus, {
          failureReason: `${gatewayResult.errorCode}: ${gatewayResult.errorMessage}`,
        });

        // Track failure for fraud detection
        await fraudService.recordFailure(merchantId).catch(() => {});

        await publishToQueue(QUEUES.PAYMENT_DEADLETTER, {
          ...message,
          finalStatus,
          exhaustedAt: new Date().toISOString(),
        });

        log.warn({ outcome: gatewayResult.outcome }, 'payment.failed');
      }

      channel.ack(msg);
    }
  } catch (err) {
    logger.error({ err, paymentId }, 'payment.worker.error');
    // Don't requeue — send to DLQ via nack
    channel.nack(msg, false, false);
  } finally {
    await lock.release();
  }
}
