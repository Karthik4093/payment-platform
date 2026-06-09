import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  // Create test merchants
  const merchant1 = await prisma.merchant.upsert({
    where: { email: 'merchant1@example.com' },
    update: {},
    create: {
      id: 'merchant_1',
      name: 'Acme Corp',
      email: 'merchant1@example.com',
      apiKey: 'ak_test_merchant_1_key',
    },
  });

  const merchant2 = await prisma.merchant.upsert({
    where: { email: 'merchant2@example.com' },
    update: {},
    create: {
      id: 'merchant_2',
      name: 'Beta Industries',
      email: 'merchant2@example.com',
      apiKey: 'ak_test_merchant_2_key',
    },
  });

  // Create platform cash account
  await prisma.ledgerAccount.upsert({
    where: { merchantId_type_currency: { merchantId: null as unknown as string, type: 'PLATFORM_CASH', currency: 'USD' } },
    update: {},
    create: {
      id: 'acc_platform_cash_usd',
      type: 'PLATFORM_CASH',
      currency: 'USD',
      name: 'Platform Cash - USD',
    },
  }).catch(async () => {
    // Handle null merchantId differently
    const existing = await prisma.ledgerAccount.findFirst({
      where: { type: 'PLATFORM_CASH', currency: 'USD', merchantId: null },
    });
    if (!existing) {
      await prisma.ledgerAccount.create({
        data: {
          id: 'acc_platform_cash_usd',
          type: 'PLATFORM_CASH',
          currency: 'USD',
          name: 'Platform Cash - USD',
        },
      });
    }
  });

  // Create merchant balance accounts
  for (const merchant of [merchant1, merchant2]) {
    const existing = await prisma.ledgerAccount.findFirst({
      where: { merchantId: merchant.id, type: 'MERCHANT_BALANCE', currency: 'USD' },
    });
    if (!existing) {
      await prisma.ledgerAccount.create({
        data: {
          id: `acc_merchant_${merchant.id}_usd`,
          merchantId: merchant.id,
          type: 'MERCHANT_BALANCE',
          currency: 'USD',
          name: `Merchant Balance - ${merchant.name} - USD`,
        },
      });
    }
  }

  console.log('✅ Seeded merchants:', merchant1.id, merchant2.id);
  console.log('✅ Database seed complete');
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
