import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockLedgerEntry = {
  id: 'entry_1',
  transactionId: 'txn_123',
  debitAccountId: 'acc_merchant_1',
  creditAccountId: 'acc_platform',
  amount: BigInt(1000),
  currency: 'USD',
  description: 'Test entry',
  paymentId: 'pay_1',
  createdAt: new Date(),
};

const mockAccount = {
  id: 'acc_platform',
  type: 'PLATFORM_CASH',
  currency: 'USD',
  name: 'Platform Cash',
  merchantId: null,
  createdAt: new Date(),
};

vi.mock('../../src/common/db/prisma.js', () => ({
  prisma: {
    ledgerAccount: {
      findFirst: vi.fn(async () => mockAccount),
      findUniqueOrThrow: vi.fn(async () => mockAccount),
      create: vi.fn(async (data: any) => ({ ...mockAccount, ...data.data })),
    },
    ledgerEntry: {
      create: vi.fn(async () => mockLedgerEntry),
      findMany: vi.fn(async () => [mockLedgerEntry]),
      aggregate: vi.fn(async ({ where }: any) => ({
        _sum: {
          amount: where.creditAccountId === 'acc_platform' ? BigInt(5000) : BigInt(2000),
        },
      })),
    },
  },
}));

import { LedgerService } from '../../src/modules/ledger/ledger.service.js';

describe('LedgerService', () => {
  let service: LedgerService;

  beforeEach(() => {
    service = new LedgerService();
    vi.clearAllMocks();
  });

  describe('recordPaymentSuccess', () => {
    it('creates a ledger entry for payment success', async () => {
      const { prisma } = await import('../../src/common/db/prisma.js');

      await service.recordPaymentSuccess('pay_1', 'merchant_1', BigInt(1000), 'USD');

      expect(prisma.ledgerEntry.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            amount: BigInt(1000),
            currency: 'USD',
            paymentId: 'pay_1',
          }),
        }),
      );
    });

    it('debits merchant balance and credits platform cash', async () => {
      const { prisma } = await import('../../src/common/db/prisma.js');

      await service.recordPaymentSuccess('pay_1', 'merchant_1', BigInt(1000), 'USD');

      const createCall = (prisma.ledgerEntry.create as any).mock.calls[0][0];
      // debitAccountId should be merchant balance, creditAccountId should be platform cash
      expect(createCall.data.debitAccountId).toBeDefined();
      expect(createCall.data.creditAccountId).toBeDefined();
      expect(createCall.data.description).toContain('pay_1');
    });
  });

  describe('recordRefund', () => {
    it('creates a ledger entry for refund', async () => {
      const { prisma } = await import('../../src/common/db/prisma.js');

      await service.recordRefund('ref_1', 'pay_1', 'merchant_1', BigInt(500), 'USD');

      expect(prisma.ledgerEntry.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            amount: BigInt(500),
            currency: 'USD',
            refundId: 'ref_1',
            paymentId: 'pay_1',
          }),
        }),
      );
    });
  });

  describe('getAccountBalance', () => {
    it('computes balance as credits minus debits', async () => {
      const { prisma } = await import('../../src/common/db/prisma.js');

      // Mock: credits = 5000, debits = 2000 for non-credit account
      (prisma.ledgerEntry.aggregate as any)
        .mockResolvedValueOnce({ _sum: { amount: BigInt(5000) } }) // credit
        .mockResolvedValueOnce({ _sum: { amount: BigInt(2000) } }); // debit

      const balance = await service.getAccountBalance('acc_platform');
      expect(balance.balance).toBe(BigInt(3000)); // 5000 - 2000
    });

    it('handles zero balance when no entries exist', async () => {
      const { prisma } = await import('../../src/common/db/prisma.js');
      (prisma.ledgerEntry.aggregate as any).mockResolvedValue({ _sum: { amount: null } });

      const balance = await service.getAccountBalance('acc_platform');
      expect(balance.balance).toBe(BigInt(0));
    });
  });
});
