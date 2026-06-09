import type { RefundStatus } from '@prisma/client';
import { prisma } from '../../common/db/prisma.js';

export class RefundRepository {
  async create(data: {
    paymentId: string;
    amount: bigint;
    reason?: string;
  }) {
    return prisma.refund.create({ data });
  }

  async findById(id: string) {
    return prisma.refund.findUnique({ where: { id } });
  }

  async findByPaymentId(paymentId: string) {
    return prisma.refund.findMany({
      where: { paymentId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async updateStatus(
    id: string,
    status: RefundStatus,
    extras: Partial<{ gatewayRef: string; processedAt: Date }> = {},
  ) {
    return prisma.refund.update({
      where: { id },
      data: { status, ...extras },
    });
  }

  async countSuccessfulRefundsByPayment(paymentId: string): Promise<number> {
    return prisma.refund.count({
      where: { paymentId, status: { in: ['SUCCESS', 'PROCESSING'] } },
    });
  }

  async sumSuccessfulRefundsByPayment(paymentId: string): Promise<bigint> {
    const result = await prisma.refund.aggregate({
      where: { paymentId, status: 'SUCCESS' },
      _sum: { amount: true },
    });
    return result._sum.amount ?? BigInt(0);
  }
}

export const refundRepository = new RefundRepository();
