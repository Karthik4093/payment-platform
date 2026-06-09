import type { WebhookEventStatus } from '@prisma/client';

export type { WebhookEventStatus };

export interface IncomingWebhookPayload {
  eventId: string;
  eventType: 'payment.success' | 'payment.failed' | 'payment.authorized' | 'payment.refunded';
  paymentId: string;
  status: string;
  gatewayRef: string;
  amount: number;
  currency: string;
  timestamp: string;
  merchantId?: string;
}

export interface ProcessedWebhookResult {
  eventId: string;
  isDuplicate: boolean;
  processed: boolean;
}
