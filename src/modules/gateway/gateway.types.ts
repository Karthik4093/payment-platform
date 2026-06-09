export type GatewayOutcome = 'SUCCESS' | 'FAILURE' | 'TIMEOUT';

export interface GatewayPaymentRequest {
  paymentId: string;
  amount: number;
  currency: string;
  merchantId: string;
}

export interface GatewayPaymentResponse {
  outcome: GatewayOutcome;
  gatewayRef: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  latencyMs: number;
}

export interface GatewayRefundRequest {
  refundId: string;
  paymentId: string;
  amount: number;
  gatewayRef: string;
}

export interface GatewayRefundResponse {
  outcome: GatewayOutcome;
  gatewayRef: string | null;
  errorCode: string | null;
  errorMessage: string | null;
}
