import { prisma } from '../../common/db/prisma.js';
import { logger } from '../../common/logger/index.js';
import { generateTransactionId } from '../../common/utils/correlation.js';
import type { LedgerEntryInput, AccountBalance } from './ledger.types.js';
import type { Prisma } from '@prisma/client';

export class LedgerService {
  async getOrCreatePlatformCashAccount(currency = 'USD'): Promise<string> {
    let account = await prisma.ledgerAccount.findFirst({
      where: { type: 'PLATFORM_CASH', currency, merchantId: null },
    });

    if (!account) {
      account = await prisma.ledgerAccount.create({
        data: {
          id: `acc_platform_cash_${currency.toLowerCase()}`,
          type: 'PLATFORM_CASH',
          currency,
          name: `Platform Cash - ${currency}`,
        },
      });
    }

    return account.id;
  }

  async getOrCreateMerchantBalanceAccount(merchantId: string, currency = 'USD'): Promise<string> {
    let account = await prisma.ledgerAccount.findFirst({
      where: { type: 'MERCHANT_BALANCE', currency, merchantId },
    });

    if (!account) {
      account = await prisma.ledgerAccount.create({
        data: {
          id: `acc_merchant_${merchantId}_${currency.toLowerCase()}`,
          merchantId,
          type: 'MERCHANT_BALANCE',
          currency,
          name: `Merchant Balance - ${merchantId} - ${currency}`,
        },
      });
    }

    return account.id;
  }

  private async createEntry(
    input: LedgerEntryInput,
    tx?: Prisma.TransactionClient,
  ) {
    const db = tx ?? prisma;
    return db.ledgerEntry.create({
      data: {
        transactionId: input.transactionId,
        debitAccountId: input.debitAccountId,
        creditAccountId: input.creditAccountId,
        amount: input.amount,
        currency: input.currency,
        description: input.description,
        paymentId: input.paymentId,
        refundId: input.refundId,
        metadata: input.metadata as Prisma.InputJsonValue,
      },
    });
  }

  /**
   * Payment Success:
   *   DEBIT  Merchant Balance  (merchant's balance reduces — platform collected)
   *   CREDIT Platform Cash     (platform cash increases)
   */
  async recordPaymentSuccess(
    paymentId: string,
    merchantId: string,
    amount: bigint,
    currency: string,
    tx?: Prisma.TransactionClient,
  ) {
    const platformCashId = await this.getOrCreatePlatformCashAccount(currency);
    const merchantBalanceId = await this.getOrCreateMerchantBalanceAccount(merchantId, currency);
    const transactionId = generateTransactionId();

    await this.createEntry(
      {
        transactionId,
        debitAccountId: merchantBalanceId,
        creditAccountId: platformCashId,
        amount,
        currency,
        description: `Payment collected: ${paymentId}`,
        paymentId,
      },
      tx,
    );

    logger.info({ paymentId, merchantId, amount: amount.toString(), transactionId }, 'Ledger entry created for payment success');
  }

  /**
   * Refund:
   *   DEBIT  Platform Cash     (platform cash reduces)
   *   CREDIT Merchant Balance  (merchant balance restored)
   */
  async recordRefund(
    refundId: string,
    paymentId: string,
    merchantId: string,
    amount: bigint,
    currency: string,
    tx?: Prisma.TransactionClient,
  ) {
    const platformCashId = await this.getOrCreatePlatformCashAccount(currency);
    const merchantBalanceId = await this.getOrCreateMerchantBalanceAccount(merchantId, currency);
    const transactionId = generateTransactionId();

    await this.createEntry(
      {
        transactionId,
        debitAccountId: platformCashId,
        creditAccountId: merchantBalanceId,
        amount,
        currency,
        description: `Refund issued: ${refundId} for payment ${paymentId}`,
        paymentId,
        refundId,
      },
      tx,
    );

    logger.info({ refundId, paymentId, merchantId, amount: amount.toString(), transactionId }, 'Ledger entry created for refund');
  }

  /** Compute account balance from ledger entries (credits - debits) */
  async getAccountBalance(accountId: string): Promise<AccountBalance> {
    const account = await prisma.ledgerAccount.findUniqueOrThrow({
      where: { id: accountId },
    });

    const [creditResult, debitResult] = await Promise.all([
      prisma.ledgerEntry.aggregate({
        where: { creditAccountId: accountId },
        _sum: { amount: true },
      }),
      prisma.ledgerEntry.aggregate({
        where: { debitAccountId: accountId },
        _sum: { amount: true },
      }),
    ]);

    const credits = creditResult._sum.amount ?? BigInt(0);
    const debits = debitResult._sum.amount ?? BigInt(0);

    return {
      accountId,
      type: account.type,
      currency: account.currency,
      balance: credits - debits,
    };
  }

  async getMerchantBalance(merchantId: string, currency = 'USD'): Promise<AccountBalance> {
    const accountId = await this.getOrCreateMerchantBalanceAccount(merchantId, currency);
    return this.getAccountBalance(accountId);
  }

  async getLedgerEntries(paymentId: string) {
    return prisma.ledgerEntry.findMany({
      where: { paymentId },
      include: {
        debitAccount: true,
        creditAccount: true,
      },
      orderBy: { createdAt: 'asc' },
    });
  }
}

export const ledgerService = new LedgerService();
