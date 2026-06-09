import { getRedisClient } from '../../common/redis/client.js';
import { prisma } from '../../common/db/prisma.js';
import { logger } from '../../common/logger/index.js';
import { FraudError } from '../../common/utils/errors.js';
import { FRAUD_RULES } from './fraud.types.js';
import type { FraudCheckResult, FraudViolation } from './fraud.types.js';

const MAX_PAYMENTS_PER_MINUTE = parseInt(process.env.FRAUD_MAX_PAYMENTS_PER_MINUTE ?? '10', 10);
const MAX_FAILURES_PER_5_MIN = parseInt(process.env.FRAUD_MAX_FAILURES_PER_5_MINUTES ?? '5', 10);
const MAX_AMOUNT = parseInt(process.env.FRAUD_MAX_AMOUNT ?? '100000', 10);

export class FraudService {
  async checkPrePayment(merchantId: string, amount: number): Promise<FraudCheckResult> {
    const violations: FraudViolation[] = [];
    const redis = getRedisClient();

    // Rule 1: High frequency — track with Redis sliding window
    const freqKey = `fraud:freq:${merchantId}`;
    const count = await redis.incr(freqKey);
    if (count === 1) {
      await redis.expire(freqKey, 60); // 1-minute window
    }

    if (count > MAX_PAYMENTS_PER_MINUTE) {
      violations.push({
        rule: FRAUD_RULES.HIGH_FREQUENCY,
        description: `${count} payments in the last minute (max: ${MAX_PAYMENTS_PER_MINUTE})`,
        riskScore: 0.8,
      });
    }

    // Rule 2: Check failure rate from Redis counter
    const failKey = `fraud:fail:${merchantId}`;
    const failCount = parseInt((await redis.get(failKey)) ?? '0', 10);
    if (failCount >= MAX_FAILURES_PER_5_MIN) {
      violations.push({
        rule: FRAUD_RULES.HIGH_FAILURE_RATE,
        description: `${failCount} failures in the last 5 minutes (max: ${MAX_FAILURES_PER_5_MIN})`,
        riskScore: 0.7,
      });
    }

    // Rule 3: Excessive amount
    if (amount > MAX_AMOUNT) {
      violations.push({
        rule: FRAUD_RULES.EXCESSIVE_AMOUNT,
        description: `Amount ${amount} exceeds maximum ${MAX_AMOUNT}`,
        riskScore: 0.6,
      });
    }

    const riskScore = violations.length > 0
      ? Math.min(violations.reduce((max, v) => Math.max(max, v.riskScore), 0) + violations.length * 0.1, 1.0)
      : 0;

    const blocked = riskScore >= 0.8 || violations.some((v) => v.riskScore >= 0.8);

    if (violations.length > 0) {
      logger.warn({ merchantId, riskScore, violations, blocked }, 'Fraud check triggered');

      // Persist fraud alert
      await prisma.fraudAlert.create({
        data: {
          merchantId,
          ruleViolated: violations.map((v) => v.rule).join(','),
          riskScore,
          metadata: { violations, amount },
          isBlocked: blocked,
        },
      });
    }

    if (blocked) {
      throw new FraudError(violations.map((v) => v.description).join('; '));
    }

    return { blocked, riskScore, violations };
  }

  async recordFailure(merchantId: string): Promise<void> {
    const redis = getRedisClient();
    const failKey = `fraud:fail:${merchantId}`;
    const count = await redis.incr(failKey);
    if (count === 1) {
      await redis.expire(failKey, 300); // 5-minute window
    }
  }

  async getFraudAlerts(merchantId: string) {
    return prisma.fraudAlert.findMany({
      where: { merchantId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }
}

export const fraudService = new FraudService();
