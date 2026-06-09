import { prisma } from '../../common/db/prisma.js';
import { verifySignature, parseWebhookSignature } from '../../common/utils/crypto.js';
import { logger } from '../../common/logger/index.js';
import type { IncomingWebhookPayload, ProcessedWebhookResult } from './webhook.types.js';
import type { Prisma } from '@prisma/client';

const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET ?? 'change-me';

export class WebhookService {
  verifySignature(rawBody: string, signatureHeader: string): boolean {
    const sig = parseWebhookSignature(signatureHeader);
    return verifySignature(rawBody, sig, WEBHOOK_SECRET);
  }

  async processEvent(
    rawBody: string,
    payload: IncomingWebhookPayload,
    signature: string,
  ): Promise<ProcessedWebhookResult> {
    // 1. Duplicate detection — upsert with ON CONFLICT DO NOTHING equivalent
    const existingEvent = await prisma.webhookEvent.findUnique({
      where: { eventId: payload.eventId },
    });

    if (existingEvent) {
      logger.info({ eventId: payload.eventId }, 'webhook.duplicate — skipping');
      await prisma.webhookEvent.update({
        where: { eventId: payload.eventId },
        data: { status: 'DUPLICATE' },
      });
      return { eventId: payload.eventId, isDuplicate: true, processed: false };
    }

    // 2. Persist event
    const event = await prisma.webhookEvent.create({
      data: {
        eventId: payload.eventId,
        paymentId: payload.paymentId,
        eventType: payload.eventType,
        payload: payload as unknown as Prisma.InputJsonValue,
        signature,
        status: 'PROCESSING',
      },
    });

    logger.info({ eventId: payload.eventId, type: payload.eventType }, 'webhook.received');

    try {
      // 3. Idempotent state update based on event type
      await this.applyEventToPayment(payload);

      await prisma.webhookEvent.update({
        where: { id: event.id },
        data: { status: 'PROCESSED', processedAt: new Date() },
      });

      return { eventId: payload.eventId, isDuplicate: false, processed: true };
    } catch (err) {
      logger.error({ err, eventId: payload.eventId }, 'webhook.processing_failed');
      await prisma.webhookEvent.update({
        where: { id: event.id },
        data: { status: 'FAILED' },
      });
      throw err;
    }
  }

  private async applyEventToPayment(payload: IncomingWebhookPayload): Promise<void> {
    const payment = await prisma.payment.findUnique({
      where: { id: payload.paymentId },
    });

    if (!payment) {
      logger.warn({ paymentId: payload.paymentId }, 'Webhook for unknown payment — ignoring');
      return;
    }

    // Webhook events are advisory — the worker is the source of truth.
    // We only apply updates if they represent a valid forward transition.
    // This prevents webhook replays from reverting payment state.
    switch (payload.eventType) {
      case 'payment.success':
        if (payment.status === 'CAPTURED') {
          await prisma.payment.update({
            where: { id: payload.paymentId },
            data: {
              status: 'SUCCESS',
              gatewayRef: payload.gatewayRef,
              processedAt: new Date(payload.timestamp),
            },
          });
        }
        break;
      case 'payment.refunded':
        if (payment.status === 'REFUND_PENDING') {
          await prisma.payment.update({
            where: { id: payload.paymentId },
            data: { status: 'REFUNDED' },
          });
        }
        break;
      default:
        logger.debug({ eventType: payload.eventType }, 'Webhook event type — no direct state change');
    }
  }

  async getWebhookEvents(paymentId: string) {
    return prisma.webhookEvent.findMany({
      where: { paymentId },
      orderBy: { createdAt: 'desc' },
    });
  }
}

export const webhookService = new WebhookService();
