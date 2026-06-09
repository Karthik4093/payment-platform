import { prisma } from '../../common/db/prisma.js';
import { logger } from '../../common/logger/index.js';
import { refundService } from '../refund/refund.service.js';
import { generateCorrelationId } from '../../common/utils/correlation.js';
import type {
  SagaStepResult,
  SagaCompensation,
  InventoryReserveRequest,
  InventoryReserveResponse,
  ShipmentCreateRequest,
  ShipmentCreateResponse,
} from './saga.types.js';
import type { Prisma } from '@prisma/client';

const INVENTORY_URL = process.env.INVENTORY_SERVICE_URL ?? 'http://localhost:3001/inventory';
const SHIPPING_URL = process.env.SHIPPING_SERVICE_URL ?? 'http://localhost:3001/shipping';
const REQUEST_TIMEOUT = 5000;

async function httpPost<T>(url: string, body: unknown): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    return res.json() as Promise<T>;
  } finally {
    clearTimeout(timer);
  }
}

export class SagaOrchestrator {
  async execute(paymentId: string): Promise<void> {
    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });

    const saga = await prisma.sagaInstance.create({
      data: {
        paymentId,
        status: 'RUNNING',
        currentStep: 'PAYMENT_PROCESSED',
        steps: [
          {
            step: 'PAYMENT_PROCESSED',
            status: 'SUCCESS',
            executedAt: new Date().toISOString(),
          } as SagaStepResult,
        ] as unknown as Prisma.InputJsonValue,
      },
    });

    logger.info({ sagaId: saga.id, paymentId }, 'saga.started');

    const steps: SagaStepResult[] = [
      {
        step: 'PAYMENT_PROCESSED',
        status: 'SUCCESS',
        executedAt: new Date().toISOString(),
      },
    ];

    let reservationId: string | null = null;
    let shipmentId: string | null = null;
    let failed = false;
    let failedStep: string | null = null;

    // ── Step 1: Reserve Inventory ─────────────────────────────
    await prisma.sagaInstance.update({
      where: { id: saga.id },
      data: { currentStep: 'INVENTORY_RESERVED' },
    });

    try {
      const invResp = await httpPost<InventoryReserveResponse>(`${INVENTORY_URL}/reserve`, {
        paymentId,
        amount: Number(payment.amount),
        currency: payment.currency,
      } satisfies InventoryReserveRequest);

      if (!invResp.success) {
        throw new Error(invResp.error ?? 'Inventory reservation failed');
      }

      reservationId = invResp.reservationId;
      steps.push({
        step: 'INVENTORY_RESERVED',
        status: 'SUCCESS',
        data: { reservationId },
        executedAt: new Date().toISOString(),
      });
      logger.info({ sagaId: saga.id, reservationId }, 'saga.inventory_reserved');
    } catch (err) {
      failed = true;
      failedStep = 'INVENTORY_RESERVED';
      steps.push({
        step: 'INVENTORY_RESERVED',
        status: 'FAILED',
        error: (err as Error).message,
        executedAt: new Date().toISOString(),
      });
      logger.error({ err, sagaId: saga.id }, 'saga.inventory_failed');
    }

    // ── Step 2: Create Shipment ───────────────────────────────
    if (!failed && reservationId) {
      await prisma.sagaInstance.update({
        where: { id: saga.id },
        data: { currentStep: 'SHIPMENT_CREATED' },
      });

      try {
        const shipResp = await httpPost<ShipmentCreateResponse>(`${SHIPPING_URL}/create`, {
          paymentId,
          reservationId,
          amount: Number(payment.amount),
          currency: payment.currency,
        } satisfies ShipmentCreateRequest);

        if (!shipResp.success) {
          throw new Error(shipResp.error ?? 'Shipment creation failed');
        }

        shipmentId = shipResp.shipmentId;
        steps.push({
          step: 'SHIPMENT_CREATED',
          status: 'SUCCESS',
          data: { shipmentId },
          executedAt: new Date().toISOString(),
        });
        logger.info({ sagaId: saga.id, shipmentId }, 'saga.shipment_created');
      } catch (err) {
        failed = true;
        failedStep = 'SHIPMENT_CREATED';
        steps.push({
          step: 'SHIPMENT_CREATED',
          status: 'FAILED',
          error: (err as Error).message,
          executedAt: new Date().toISOString(),
        });
        logger.error({ err, sagaId: saga.id }, 'saga.shipment_failed');
      }
    }

    // ── Compensation if failed ────────────────────────────────
    if (failed) {
      await prisma.sagaInstance.update({
        where: { id: saga.id },
        data: {
          status: 'COMPENSATING',
          steps: steps as unknown as Prisma.InputJsonValue,
        },
      });

      const compensations: SagaCompensation[] = [];

      // Compensate shipment if it was created
      if (shipmentId) {
        try {
          await httpPost(`${SHIPPING_URL}/cancel`, { shipmentId, reason: `Saga compensation: ${failedStep}` });
          compensations.push({ step: 'SHIPMENT_CREATED', reason: 'Saga compensation', executedAt: new Date().toISOString(), success: true });
        } catch (err) {
          compensations.push({ step: 'SHIPMENT_CREATED', reason: 'Saga compensation failed', executedAt: new Date().toISOString(), success: false });
          logger.error({ err }, 'saga.compensation.shipment_cancel_failed');
        }
      }

      // Compensate inventory if it was reserved
      if (reservationId) {
        try {
          await httpPost(`${INVENTORY_URL}/release`, { reservationId, reason: `Saga compensation: ${failedStep}` });
          compensations.push({ step: 'INVENTORY_RESERVED', reason: 'Saga compensation', executedAt: new Date().toISOString(), success: true });
          steps.push({ step: 'INVENTORY_RELEASED', status: 'SUCCESS', executedAt: new Date().toISOString() });
        } catch (err) {
          compensations.push({ step: 'INVENTORY_RESERVED', reason: 'Saga compensation failed', executedAt: new Date().toISOString(), success: false });
          logger.error({ err }, 'saga.compensation.inventory_release_failed');
        }
      }

      // Compensate payment — refund
      try {
        await refundService.createRefund({
          paymentId,
          reason: `Saga compensation: ${failedStep} failed`,
          correlationId: generateCorrelationId(),
        });
        compensations.push({ step: 'PAYMENT_REFUNDED', reason: 'Saga compensation', executedAt: new Date().toISOString(), success: true });
        steps.push({ step: 'PAYMENT_REFUNDED', status: 'SUCCESS', executedAt: new Date().toISOString() });
      } catch (err) {
        compensations.push({ step: 'PAYMENT_REFUNDED', reason: 'Saga refund failed', executedAt: new Date().toISOString(), success: false });
        logger.error({ err }, 'saga.compensation.refund_failed');
      }

      await prisma.sagaInstance.update({
        where: { id: saga.id },
        data: {
          status: 'COMPENSATED',
          steps: steps as unknown as Prisma.InputJsonValue,
          compensation: compensations as unknown as Prisma.InputJsonValue,
          completedAt: new Date(),
        },
      });

      logger.info({ sagaId: saga.id, paymentId }, 'saga.compensated');
      return;
    }

    // ── Success path ──────────────────────────────────────────
    await prisma.sagaInstance.update({
      where: { id: saga.id },
      data: {
        status: 'COMPLETED',
        currentStep: 'SHIPMENT_CREATED',
        steps: steps as unknown as Prisma.InputJsonValue,
        completedAt: new Date(),
      },
    });

    logger.info({ sagaId: saga.id, paymentId, shipmentId }, 'saga.completed');
  }

  async getSagaStatus(paymentId: string) {
    return prisma.sagaInstance.findFirst({
      where: { paymentId },
      orderBy: { startedAt: 'desc' },
    });
  }
}

export const sagaOrchestrator = new SagaOrchestrator();
