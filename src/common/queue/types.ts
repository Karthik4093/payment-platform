export interface PaymentMessage {
  paymentId: string;
  merchantId: string;
  amount: number;
  currency: string;
  retryCount: number;
  correlationId: string;
  scheduledAt: string;
}

export interface RefundMessage {
  refundId: string;
  paymentId: string;
  merchantId: string;
  amount: number;
  currency: string;
  correlationId: string;
}

export interface WebhookDeliveryMessage {
  webhookEventId: string;
  paymentId: string;
  eventType: string;
  payload: Record<string, unknown>;
  attempt: number;
}

export const QUEUES = {
  PAYMENT_PROCESS: 'payment.process',
  PAYMENT_RETRY: 'payment.retry',
  PAYMENT_DEADLETTER: 'payment.deadletter',
  REFUND_PROCESS: 'refund.process',
} as const;

export const EXCHANGES = {
  PAYMENTS: 'payments',
  PAYMENTS_DLX: 'payments.dlx',
  PAYMENTS_DELAY: 'payments.delay',
} as const;

export const DELAY_QUEUES: Record<number, string> = {
  1000: 'payment.delay.1s',
  2000: 'payment.delay.2s',
  4000: 'payment.delay.4s',
  8000: 'payment.delay.8s',
  16000: 'payment.delay.16s',
};

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];
