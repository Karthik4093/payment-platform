import type { PaymentStatus } from '@prisma/client';
import { StateMachineError } from '../../common/utils/errors.js';
import { VALID_TRANSITIONS, TERMINAL_STATES } from './payment.types.js';

export class PaymentStateMachine {
  static canTransition(from: PaymentStatus, to: PaymentStatus): boolean {
    const allowed = VALID_TRANSITIONS[from];
    return allowed?.includes(to) ?? false;
  }

  static assertTransition(from: PaymentStatus, to: PaymentStatus): void {
    if (!this.canTransition(from, to)) {
      throw new StateMachineError(from, to);
    }
  }

  static isTerminal(status: PaymentStatus): boolean {
    return TERMINAL_STATES.includes(status);
  }

  static getValidTransitions(from: PaymentStatus): PaymentStatus[] {
    return VALID_TRANSITIONS[from] ?? [];
  }

  static validateRetryTransition(
    currentStatus: PaymentStatus,
    retryCount: number,
    maxRetries: number,
  ): PaymentStatus {
    if (retryCount < maxRetries) {
      this.assertTransition(currentStatus, 'RETRYING');
      return 'RETRYING';
    }
    // Max retries exhausted — go directly to FAILED
    if (currentStatus === 'RETRYING') {
      this.assertTransition('RETRYING', 'FAILED');
    } else {
      this.assertTransition('PROCESSING', 'FAILED');
    }
    return 'FAILED';
  }
}
