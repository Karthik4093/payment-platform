export const ACCOUNT_TYPES = {
  PLATFORM_CASH: 'PLATFORM_CASH',
  MERCHANT_BALANCE: 'MERCHANT_BALANCE',
  ESCROW: 'ESCROW',
} as const;

export type AccountType = (typeof ACCOUNT_TYPES)[keyof typeof ACCOUNT_TYPES];

export interface LedgerEntryInput {
  transactionId: string;
  debitAccountId: string;
  creditAccountId: string;
  amount: bigint;
  currency: string;
  description: string;
  paymentId?: string;
  refundId?: string;
  metadata?: Record<string, unknown>;
}

export interface AccountBalance {
  accountId: string;
  type: string;
  currency: string;
  balance: bigint;
}
