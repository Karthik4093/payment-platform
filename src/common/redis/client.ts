import { Redis } from 'ioredis';
import { logger } from '../logger/index.js';

let redisClient: Redis | null = null;

export function getRedisClient(): Redis {
  if (!redisClient) {
    redisClient = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      lazyConnect: false,
      retryStrategy(times: number) {
        if (times > 10) return null;
        return Math.min(times * 200, 2000);
      },
      reconnectOnError(err: Error) {
        return err.message.includes('READONLY');
      },
    });

    redisClient.on('connect', () => logger.info('Redis connected'));
    redisClient.on('error', (err: Error) => logger.error({ err }, 'Redis error'));
    redisClient.on('close', () => logger.warn('Redis connection closed'));
    redisClient.on('reconnecting', () => logger.info('Redis reconnecting'));
  }
  return redisClient;
}

export async function disconnectRedis(): Promise<void> {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
    logger.info('Redis disconnected');
  }
}

export async function checkRedisHealth(): Promise<boolean> {
  try {
    const result = await getRedisClient().ping();
    return result === 'PONG';
  } catch {
    return false;
  }
}
