import { createHmac, timingSafeEqual } from 'crypto';

export function signPayload(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

export function verifySignature(payload: string, signature: string, secret: string): boolean {
  const expected = signPayload(payload, secret);
  try {
    return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

export function parseWebhookSignature(header: string): string {
  // Supports "sha256=<hex>" format
  if (header.startsWith('sha256=')) {
    return header.slice(7);
  }
  return header;
}
