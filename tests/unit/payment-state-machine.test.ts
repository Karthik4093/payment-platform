import { describe, it, expect } from 'vitest';
import { PaymentStateMachine } from '../../src/modules/payment/payment.state-machine.js';
import { StateMachineError } from '../../src/common/utils/errors.js';

describe('PaymentStateMachine', () => {
  describe('canTransition', () => {
    it('allows PENDING → PROCESSING', () => {
      expect(PaymentStateMachine.canTransition('PENDING', 'PROCESSING')).toBe(true);
    });

    it('allows PROCESSING → AUTHORIZED', () => {
      expect(PaymentStateMachine.canTransition('PROCESSING', 'AUTHORIZED')).toBe(true);
    });

    it('allows PROCESSING → FAILED', () => {
      expect(PaymentStateMachine.canTransition('PROCESSING', 'FAILED')).toBe(true);
    });

    it('allows PROCESSING → RETRYING', () => {
      expect(PaymentStateMachine.canTransition('PROCESSING', 'RETRYING')).toBe(true);
    });

    it('allows AUTHORIZED → CAPTURED', () => {
      expect(PaymentStateMachine.canTransition('AUTHORIZED', 'CAPTURED')).toBe(true);
    });

    it('allows CAPTURED → SUCCESS', () => {
      expect(PaymentStateMachine.canTransition('CAPTURED', 'SUCCESS')).toBe(true);
    });

    it('allows SUCCESS → REFUND_PENDING', () => {
      expect(PaymentStateMachine.canTransition('SUCCESS', 'REFUND_PENDING')).toBe(true);
    });

    it('allows REFUND_PENDING → REFUNDED', () => {
      expect(PaymentStateMachine.canTransition('REFUND_PENDING', 'REFUNDED')).toBe(true);
    });

    it('allows RETRYING → PROCESSING', () => {
      expect(PaymentStateMachine.canTransition('RETRYING', 'PROCESSING')).toBe(true);
    });

    it('allows RETRYING → FAILED', () => {
      expect(PaymentStateMachine.canTransition('RETRYING', 'FAILED')).toBe(true);
    });
  });

  describe('invalid transitions', () => {
    it('rejects PENDING → SUCCESS (skipped states)', () => {
      expect(PaymentStateMachine.canTransition('PENDING', 'SUCCESS')).toBe(false);
    });

    it('rejects FAILED → SUCCESS (terminal state)', () => {
      expect(PaymentStateMachine.canTransition('FAILED', 'SUCCESS')).toBe(false);
    });

    it('rejects REFUNDED → SUCCESS (terminal state)', () => {
      expect(PaymentStateMachine.canTransition('REFUNDED', 'SUCCESS')).toBe(false);
    });

    it('rejects SUCCESS → PROCESSING (backward transition)', () => {
      expect(PaymentStateMachine.canTransition('SUCCESS', 'PROCESSING')).toBe(false);
    });

    it('rejects REFUNDED → PENDING (backward transition)', () => {
      expect(PaymentStateMachine.canTransition('REFUNDED', 'PENDING')).toBe(false);
    });
  });

  describe('assertTransition', () => {
    it('throws StateMachineError for invalid transitions', () => {
      expect(() =>
        PaymentStateMachine.assertTransition('FAILED', 'SUCCESS'),
      ).toThrow(StateMachineError);
    });

    it('does not throw for valid transitions', () => {
      expect(() =>
        PaymentStateMachine.assertTransition('PENDING', 'PROCESSING'),
      ).not.toThrow();
    });
  });

  describe('isTerminal', () => {
    it('SUCCESS is terminal', () => {
      expect(PaymentStateMachine.isTerminal('SUCCESS')).toBe(true);
    });

    it('FAILED is terminal', () => {
      expect(PaymentStateMachine.isTerminal('FAILED')).toBe(true);
    });

    it('REFUNDED is terminal', () => {
      expect(PaymentStateMachine.isTerminal('REFUNDED')).toBe(true);
    });

    it('PENDING is not terminal', () => {
      expect(PaymentStateMachine.isTerminal('PENDING')).toBe(false);
    });

    it('PROCESSING is not terminal', () => {
      expect(PaymentStateMachine.isTerminal('PROCESSING')).toBe(false);
    });
  });

  describe('validateRetryTransition', () => {
    it('returns RETRYING when retries remaining', () => {
      expect(
        PaymentStateMachine.validateRetryTransition('PROCESSING', 2, 5),
      ).toBe('RETRYING');
    });

    it('returns FAILED when max retries reached from PROCESSING', () => {
      expect(
        PaymentStateMachine.validateRetryTransition('PROCESSING', 5, 5),
      ).toBe('FAILED');
    });

    it('returns FAILED when max retries reached from RETRYING', () => {
      expect(
        PaymentStateMachine.validateRetryTransition('RETRYING', 5, 5),
      ).toBe('FAILED');
    });
  });

  describe('getValidTransitions', () => {
    it('returns all valid transitions for PROCESSING', () => {
      const transitions = PaymentStateMachine.getValidTransitions('PROCESSING');
      expect(transitions).toContain('AUTHORIZED');
      expect(transitions).toContain('FAILED');
      expect(transitions).toContain('RETRYING');
    });

    it('returns empty array for terminal state FAILED', () => {
      expect(PaymentStateMachine.getValidTransitions('FAILED')).toEqual([]);
    });

    it('returns empty array for terminal state REFUNDED', () => {
      expect(PaymentStateMachine.getValidTransitions('REFUNDED')).toEqual([]);
    });
  });
});
