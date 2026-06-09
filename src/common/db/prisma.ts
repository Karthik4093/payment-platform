import { PrismaClient } from '@prisma/client';
import { logger } from '../logger/index.js';

declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

function createPrismaClient(): PrismaClient {
  const client = new PrismaClient({
    log: [
      { level: 'query', emit: 'event' },
      { level: 'error', emit: 'stdout' },
      { level: 'warn', emit: 'stdout' },
    ],
  });

  if (process.env.LOG_LEVEL === 'debug') {
    (client as any).$on('query', (e: any) => {
      logger.debug({ query: e.query, duration: e.duration }, 'DB query');
    });
  }

  return client;
}

// Singleton pattern to avoid creating multiple connections in dev (hot reload)
export const prisma: PrismaClient =
  global.__prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== 'production') {
  global.__prisma = prisma;
}

export async function connectDB(): Promise<void> {
  await prisma.$connect();
  logger.info('PostgreSQL connected');
}

export async function disconnectDB(): Promise<void> {
  await prisma.$disconnect();
  logger.info('PostgreSQL disconnected');
}

export async function checkDBHealth(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}
