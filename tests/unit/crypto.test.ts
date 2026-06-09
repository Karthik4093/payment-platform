import { describe, it, expect } from 'vitest';
import { signPayload, verifySignature, parseWebhookSignature } from '../../src/common/utils/crypto.js';

describe('Crypto utilities', () => {
  const secret = 'test-secret-key';
  const payload = '{"eventId":"123","type":"payment.success"}';

  describe('signPayload', () => {
    it('generates consistent HMAC-SHA256 signature', () => {
      const sig1 = signPayload(payload, secret);
      const sig2 = signPayload(payload, secret);
      expect(sig1).toBe(sig2);
    });

    it('generates different signatures for different payloads', () => {
      const sig1 = signPayload(payload, secret);
      const sig2 = signPayload('different payload', secret);
      expect(sig1).not.toBe(sig2);
    });

    it('generates different signatures for different secrets', () => {
      const sig1 = signPayload(payload, 'secret1');
      const sig2 = signPayload(payload, 'secret2');
      expect(sig1).not.toBe(sig2);
    });

    it('produces a 64-character hex string', () => {
      const sig = signPayload(payload, secret);
      expect(sig).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe('verifySignature', () => {
    it('returns true for valid signature', () => {
      const sig = signPayload(payload, secret);
      expect(verifySignature(payload, sig, secret)).toBe(true);
    });

    it('returns false for tampered payload', () => {
      const sig = signPayload(payload, secret);
      expect(verifySignature('tampered payload', sig, secret)).toBe(false);
    });

    it('returns false for wrong secret', () => {
      const sig = signPayload(payload, secret);
      expect(verifySignature(payload, sig, 'wrong-secret')).toBe(false);
    });

    it('returns false for invalid signature', () => {
      expect(verifySignature(payload, 'invalid-sig', secret)).toBe(false);
    });
  });

  describe('parseWebhookSignature', () => {
    it('strips sha256= prefix', () => {
      const sig = 'abcdef1234567890';
      expect(parseWebhookSignature(`sha256=${sig}`)).toBe(sig);
    });

    it('returns raw signature when no prefix', () => {
      const sig = 'abcdef1234567890';
      expect(parseWebhookSignature(sig)).toBe(sig);
    });
  });
});
