import { randomUUID } from 'crypto';

export function generateCorrelationId(): string {
  return randomUUID();
}

export function generateTransactionId(): string {
  return `txn_${Date.now()}_${randomUUID().replace(/-/g, '').slice(0, 8)}`;
}

export function parseCorrelationId(header: string | undefined): string {
  return header ?? generateCorrelationId();
}
