export type SagaStepStatus = 'PENDING' | 'RUNNING' | 'SUCCESS' | 'FAILED' | 'COMPENSATED';

export type SagaStepName =
  | 'PAYMENT_PROCESSED'
  | 'INVENTORY_RESERVED'
  | 'SHIPMENT_CREATED'
  | 'INVENTORY_RELEASED'
  | 'PAYMENT_REFUNDED';

export interface SagaStepResult {
  step: SagaStepName;
  status: SagaStepStatus;
  data?: Record<string, unknown>;
  error?: string;
  executedAt: string;
}

export interface SagaCompensation {
  step: SagaStepName;
  reason: string;
  executedAt: string;
  success: boolean;
}

export interface InventoryReserveRequest {
  paymentId: string;
  amount: number;
  currency: string;
}

export interface InventoryReserveResponse {
  reservationId: string;
  success: boolean;
  error?: string;
}

export interface ShipmentCreateRequest {
  paymentId: string;
  reservationId: string;
  amount: number;
  currency: string;
}

export interface ShipmentCreateResponse {
  shipmentId: string;
  success: boolean;
  error?: string;
}
