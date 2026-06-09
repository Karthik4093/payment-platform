import { logger } from '../../common/logger/index.js';
import { GatewayError } from '../../common/utils/errors.js';
import type {
  GatewayPaymentRequest,
  GatewayPaymentResponse,
  GatewayRefundRequest,
  GatewayRefundResponse,
} from './gateway.types.js';

const GATEWAY_URL = process.env.GATEWAY_URL ?? 'http://localhost:3001';
const GATEWAY_TIMEOUT_MS = 8000;

async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export class GatewayClient {
  async processPayment(req: GatewayPaymentRequest): Promise<GatewayPaymentResponse> {
    const start = Date.now();
    logger.info({ paymentId: req.paymentId }, 'Calling payment gateway');

    try {
      const response = await fetchWithTimeout(
        `${GATEWAY_URL}/gateway/pay`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(req),
        },
        GATEWAY_TIMEOUT_MS,
      );

      const latencyMs = Date.now() - start;

      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as Record<string, unknown>;
        return {
          outcome: 'FAILURE',
          gatewayRef: null,
          errorCode: String(response.status),
          errorMessage: String(body.message ?? 'Gateway returned error'),
          latencyMs,
        };
      }

      const data = await response.json() as {
        outcome: string;
        gatewayRef?: string;
        errorCode?: string;
        errorMessage?: string;
      };

      return {
        outcome: data.outcome as GatewayPaymentResponse['outcome'],
        gatewayRef: data.gatewayRef ?? null,
        errorCode: data.errorCode ?? null,
        errorMessage: data.errorMessage ?? null,
        latencyMs,
      };
    } catch (err) {
      const latencyMs = Date.now() - start;
      const isTimeout = (err as Error).name === 'AbortError';

      logger.warn({ err, paymentId: req.paymentId, isTimeout }, 'Gateway call failed');

      return {
        outcome: isTimeout ? 'TIMEOUT' : 'FAILURE',
        gatewayRef: null,
        errorCode: isTimeout ? 'TIMEOUT' : 'NETWORK_ERROR',
        errorMessage: (err as Error).message,
        latencyMs,
      };
    }
  }

  async processRefund(req: GatewayRefundRequest): Promise<GatewayRefundResponse> {
    logger.info({ refundId: req.refundId, paymentId: req.paymentId }, 'Calling refund gateway');

    try {
      const response = await fetchWithTimeout(
        `${GATEWAY_URL}/gateway/refund`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(req),
        },
        GATEWAY_TIMEOUT_MS,
      );

      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as Record<string, unknown>;
        return {
          outcome: 'FAILURE',
          gatewayRef: null,
          errorCode: String(response.status),
          errorMessage: String(body.message ?? 'Gateway refund error'),
        };
      }

      const data = await response.json() as {
        outcome: string;
        gatewayRef?: string;
        errorCode?: string;
        errorMessage?: string;
      };

      return {
        outcome: data.outcome as GatewayRefundResponse['outcome'],
        gatewayRef: data.gatewayRef ?? null,
        errorCode: data.errorCode ?? null,
        errorMessage: data.errorMessage ?? null,
      };
    } catch (err) {
      const isTimeout = (err as Error).name === 'AbortError';
      return {
        outcome: isTimeout ? 'TIMEOUT' : 'FAILURE',
        gatewayRef: null,
        errorCode: isTimeout ? 'TIMEOUT' : 'NETWORK_ERROR',
        errorMessage: (err as Error).message,
      };
    }
  }
}

export const gatewayClient = new GatewayClient();
