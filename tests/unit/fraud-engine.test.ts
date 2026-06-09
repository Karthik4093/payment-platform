import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FraudError } from '../../src/common/utils/errors.js';

// Mock Redis and Prisma before importing FraudService
vi.mock('../../src/common/redis/client.js', () => {
  const counters: Record<string, number> = {};
  const redis = {
    incr: vi.fn(async (key: string) => {
      counters[key] = (counters[key] ?? 0) + 1;
      return counters[key];
    }),
    expire: vi.fn(async () => 1),
    get: vi.fn(async (key: string) => String(counters[key] ?? 0)),
    reset: () => { Object.keys(counters).forEach((k) => delete counters[k]); },
    _counters: counters,
  };
  return { getRedisClient: () => redis };
});

vi.mock('../../src/common/db/prisma.js', () => ({
  prisma: {
    fraudAlert: {
      create: vi.fn(async () => ({ id: 'alert_1' })),
      findMany: vi.fn(async () => []),
    },
  },
}));

import { FraudService } from '../../src/modules/fraud/fraud.service.js';
import { getRedisClient } from '../../src/common/redis/client.js';

describe('FraudService', () => {
  let service: FraudService;

  beforeEach(() => {
    service = new FraudService();
    // Reset counters
    (getRedisClient() as any).reset?.();
    vi.clearAllMocks();
  });

  describe('checkPrePayment', () => {
    it('passes clean payment without violations', async () => {
      const result = await service.checkPrePayment('merchant_1', 500);
      expect(result.blocked).toBe(false);
      expect(result.violations).toHaveLength(0);
    });

    it('detects excessive amount', async () => {
      const result = await service.checkPrePayment('merchant_clean', 200000);
      expect(result.violations.some((v) => v.rule === 'EXCESSIVE_AMOUNT')).toBe(true);
    });

    it('flags excessive amount but does not block (risk score 0.7 < threshold 0.8)', async () => {
      const mockRedis = getRedisClient() as any;
      mockRedis.get.mockResolvedValue('0');
      mockRedis.incr.mockResolvedValue(1);

      // Excessive amount raises risk score to 0.7 — flagged but not blocked
      const result = await service.checkPrePayment('merch', 999999);
      expect(result.blocked).toBe(false);
      expect(result.riskScore).toBeGreaterThan(0);
      expect(result.violations.some((v) => v.rule === 'EXCESSIVE_AMOUNT')).toBe(true);
    });

    it('blocks when excessive amount combines with high frequency (risk >= 0.8)', async () => {
      const mockRedis = getRedisClient() as any;
      mockRedis.get.mockResolvedValue('0');
      // Frequency > 10 (HIGH_FREQUENCY rule, riskScore 0.8) + excessive amount → blocked
      mockRedis.incr.mockResolvedValue(11);

      await expect(service.checkPrePayment('merch', 999999)).rejects.toThrow(FraudError);
    });

    it('detects high frequency payments', async () => {
      const mockRedis = getRedisClient() as any;
      // Simulate 11 payments already made (> MAX_PAYMENTS_PER_MINUTE=10)
      mockRedis.incr.mockResolvedValue(11);
      mockRedis.get.mockResolvedValue('0');

      await expect(service.checkPrePayment('merchant_busy', 100)).rejects.toThrow(FraudError);
    });

    it('detects high failure rate', async () => {
      const mockRedis = getRedisClient() as any;
      mockRedis.incr.mockResolvedValue(1); // Low frequency
      mockRedis.get.mockResolvedValue('6'); // 6 failures (> MAX=5)

      const result = await service.checkPrePayment('merchant_failing', 100);
      expect(result.violations.some((v) => v.rule === 'HIGH_FAILURE_RATE')).toBe(true);
    });
  });

  describe('recordFailure', () => {
    it('increments failure counter in Redis', async () => {
      const mockRedis = getRedisClient() as any;
      mockRedis.incr.mockResolvedValue(1);

      await service.recordFailure('merchant_1');
      expect(mockRedis.incr).toHaveBeenCalledWith(expect.stringContaining('fraud:fail:merchant_1'));
    });
  });
});
