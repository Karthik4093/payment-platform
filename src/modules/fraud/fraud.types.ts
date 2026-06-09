export interface FraudCheckResult {
  blocked: boolean;
  riskScore: number;
  violations: FraudViolation[];
}

export interface FraudViolation {
  rule: string;
  description: string;
  riskScore: number;
}

export const FRAUD_RULES = {
  HIGH_FREQUENCY: 'HIGH_FREQUENCY_PAYMENTS',
  HIGH_FAILURE_RATE: 'HIGH_FAILURE_RATE',
  EXCESSIVE_AMOUNT: 'EXCESSIVE_AMOUNT',
} as const;

export type FraudRule = (typeof FRAUD_RULES)[keyof typeof FRAUD_RULES];
