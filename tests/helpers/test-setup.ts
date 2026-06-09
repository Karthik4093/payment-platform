import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';

// Integration test helpers that require a real database
export const testPrisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? 'postgresql://payments_user:payments_pass@localhost:5432/payments_db',
    },
  },
});

export async function cleanupDatabase() {
  const tables = [
    'saga_instances',
    'fraud_alerts',
    'idempotency_keys',
    'webhook_events',
    'ledger_entries',
    'ledger_accounts',
    'payment_attempts',
    'refunds',
    'payments',
    'merchants',
  ];

  for (const table of tables) {
    await testPrisma.$executeRawUnsafe(`TRUNCATE TABLE "${table}" CASCADE`);
  }
}

export async function createTestMerchant(id = 'merchant_test') {
  return testPrisma.merchant.upsert({
    where: { email: `${id}@test.com` },
    update: {},
    create: {
      id,
      name: `Test Merchant ${id}`,
      email: `${id}@test.com`,
      apiKey: `ak_${randomUUID()}`,
    },
  });
}

export async function createTestPayment(merchantId: string, status = 'PENDING' as any) {
  return testPrisma.payment.create({
    data: {
      merchantId,
      amount: BigInt(1000),
      currency: 'USD',
      status,
      correlationId: randomUUID(),
    },
  });
}

export function buildHeaders(extras: Record<string, string> = {}) {
  return {
    'Content-Type': 'application/json',
    'Idempotency-Key': randomUUID(),
    'X-Correlation-Id': randomUUID(),
    ...extras,
  };
}
