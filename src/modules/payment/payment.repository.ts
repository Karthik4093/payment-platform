import type { PaymentStatus, Prisma } from '@prisma/client';
import { prisma } from '../../common/db/prisma.js';
import type { CreatePaymentInput } from './payment.types.js';

export class PaymentRepository {
  async create(input: CreatePaymentInput) {
    return prisma.payment.create({
      data: {
        merchantId: input.merchantId,
        amount: BigInt(input.amount),
        currency: input.currency,
        status: 'PENDING',
        correlationId: input.correlationId,
        metadata: input.metadata as Prisma.InputJsonValue,
      },
    });
  }

  async findById(id: string) {
    return prisma.payment.findUnique({ where: { id } });
  }

  async findByIdOrThrow(id: string) {
    const payment = await this.findById(id);
    if (!payment) {
      throw new Error(`Payment not found: ${id}`);
    }
    return payment;
  }

  async updateStatus(
    id: string,
    status: PaymentStatus,
    extras: Partial<{
      gatewayRef: string;
      failureReason: string;
      retryCount: number;
      processedAt: Date;
    }> = {},
  ) {
    return prisma.payment.update({
      where: { id },
      data: {
        status,
        ...extras,
        ...(status === 'SUCCESS' || status === 'FAILED'
          ? { processedAt: new Date() }
          : {}),
      },
    });
  }

  async incrementRetryCount(id: string) {
    return prisma.payment.update({
      where: { id },
      data: { retryCount: { increment: 1 } },
    });
  }

  async createAttempt(data: {
    paymentId: string;
    attemptNumber: number;
    status: string;
    gatewayRef?: string;
    errorCode?: string;
    errorMessage?: string;
    latencyMs?: number;
  }) {
    return prisma.paymentAttempt.create({ data });
  }

  async getAttempts(paymentId: string) {
    return prisma.paymentAttempt.findMany({
      where: { paymentId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async findByMerchant(merchantId: string, limit = 50, offset = 0) {
    return prisma.payment.findMany({
      where: { merchantId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    });
  }

  async countRecentByMerchant(merchantId: string, windowMs: number): Promise<number> {
    const since = new Date(Date.now() - windowMs);
    return prisma.payment.count({
      where: { merchantId, createdAt: { gte: since } },
    });
  }

  async countRecentFailuresByMerchant(merchantId: string, windowMs: number): Promise<number> {
    const since = new Date(Date.now() - windowMs);
    return prisma.payment.count({
      where: { merchantId, status: 'FAILED', updatedAt: { gte: since } },
    });
  }
}

export const paymentRepository = new PaymentRepository();
