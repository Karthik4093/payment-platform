import type { PaymentStatus } from '@prisma/client';

export type { PaymentStatus };

export interface CreatePaymentInput {
  merchantId: string;
  amount: number;
  currency: string;
  metadata?: Record<string, unknown>;
  idempotencyKey: string;
  correlationId: string;
}

export interface PaymentResponse {
  paymentId: string;
  merchantId: string;
  amount: number;
  currency: string;
  status: PaymentStatus;
  retryCount: number;
  gatewayRef: string | null;
  correlationId: string | null;
  failureReason: string | null;
  createdAt: Date;
  updatedAt: Date;
  processedAt: Date | null;
}

export interface PaymentAttemptRecord {
  id: string;
  paymentId: string;
  attemptNumber: number;
  status: string;
  gatewayRef: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  latencyMs: number | null;
  createdAt: Date;
}

// Valid state transitions — enforced by the state machine
export const VALID_TRANSITIONS: Record<PaymentStatus, PaymentStatus[]> = {
  PENDING: ['PROCESSING'],
  PROCESSING: ['AUTHORIZED', 'FAILED', 'RETRYING'],
  AUTHORIZED: ['CAPTURED'],
  CAPTURED: ['SUCCESS'],
  SUCCESS: ['REFUND_PENDING'],
  FAILED: [],
  RETRYING: ['PROCESSING', 'FAILED'],
  REFUND_PENDING: ['REFUNDED'],
  REFUNDED: [],
};

export const TERMINAL_STATES: PaymentStatus[] = ['SUCCESS', 'FAILED', 'REFUNDED'];
export const PROCESSABLE_STATES: PaymentStatus[] = ['PENDING', 'RETRYING'];
