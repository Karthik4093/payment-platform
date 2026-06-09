import { getRedisClient } from './client.js';
import { logger } from '../logger/index.js';

const DEFAULT_TTL_MS = parseInt(process.env.REDIS_LOCK_TTL_MS ?? '30000', 10);

// Lua script for atomic lock release — only releases if we own it
const RELEASE_SCRIPT = `
  if redis.call("GET", KEYS[1]) == ARGV[1] then
    return redis.call("DEL", KEYS[1])
  else
    return 0
  end
`;

export interface Lock {
  acquired: boolean;
  token: string;
  release(): Promise<boolean>;
}

export async function acquireLock(
  key: string,
  ttlMs: number = DEFAULT_TTL_MS,
  retries = 0,
  retryDelayMs = 100,
): Promise<Lock> {
  const redis = getRedisClient();
  const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const lockKey = `lock:${key}`;

  const acquired = await redis.set(lockKey, token, 'PX', ttlMs, 'NX');

  if (acquired === null && retries > 0) {
    await new Promise((r) => setTimeout(r, retryDelayMs));
    return acquireLock(key, ttlMs, retries - 1, retryDelayMs * 1.5);
  }

  const didAcquire = acquired === 'OK';

  if (didAcquire) {
    logger.debug({ key: lockKey, token }, 'Lock acquired');
  } else {
    logger.debug({ key: lockKey }, 'Lock not acquired');
  }

  return {
    acquired: didAcquire,
    token,
    async release(): Promise<boolean> {
      try {
        const result = await redis.eval(RELEASE_SCRIPT, 1, lockKey, token) as number;
        const released = result === 1;
        if (released) {
          logger.debug({ key: lockKey, token }, 'Lock released');
        }
        return released;
      } catch (err) {
        logger.error({ err, key: lockKey }, 'Failed to release lock');
        return false;
      }
    },
  };
}

export async function withLock<T>(
  key: string,
  fn: () => Promise<T>,
  ttlMs: number = DEFAULT_TTL_MS,
  retries = 3,
): Promise<T> {
  const lock = await acquireLock(key, ttlMs, retries);

  if (!lock.acquired) {
    throw new Error(`Could not acquire lock for key: ${key}`);
  }

  try {
    return await fn();
  } finally {
    await lock.release();
  }
}
