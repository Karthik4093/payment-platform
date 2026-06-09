import type { RefundStatus } from '@prisma/client';

export type { RefundStatus };

export interface CreateRefundInput {
  paymentId: string;
  amount?: number;
  reason?: string;
  correlationId: string;
}

export interface RefundResponse {
  refundId: string;
  paymentId: string;
  amount: number;
  status: RefundStatus;
  reason: string | null;
  gatewayRef: string | null;
  createdAt: Date;
  updatedAt: Date;
}
