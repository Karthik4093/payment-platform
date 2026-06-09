export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number = 500,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
    if (Error.captureStackTrace) Error.captureStackTrace(this, this.constructor);
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super('VALIDATION_ERROR', message, 400, details);
    this.name = 'ValidationError';
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string, id: string) {
    super('NOT_FOUND', `${resource} not found: ${id}`, 404);
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends AppError {
  constructor(message: string, details?: unknown) {
    super('CONFLICT', message, 409, details);
    this.name = 'ConflictError';
  }
}

export class IdempotencyError extends AppError {
  constructor(public readonly originalResponse: unknown) {
    super('IDEMPOTENCY_CONFLICT', 'Duplicate request with different payload', 409);
    this.name = 'IdempotencyError';
  }
}

export class StateMachineError extends AppError {
  constructor(from: string, to: string) {
    super('INVALID_STATE_TRANSITION', `Invalid transition from ${from} to ${to}`, 422);
    this.name = 'StateMachineError';
  }
}

export class LockError extends AppError {
  constructor(resource: string) {
    super('LOCK_UNAVAILABLE', `Could not acquire lock for ${resource}`, 409);
    this.name = 'LockError';
  }
}

export class FraudError extends AppError {
  constructor(reason: string) {
    super('FRAUD_DETECTED', `Transaction blocked: ${reason}`, 422);
    this.name = 'FraudError';
  }
}

export class GatewayError extends AppError {
  constructor(message: string, details?: unknown) {
    super('GATEWAY_ERROR', message, 502, details);
    this.name = 'GatewayError';
  }
}

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}

export function toHttpError(err: unknown): { statusCode: number; code: string; message: string; details?: unknown } {
  if (isAppError(err)) {
    return {
      statusCode: err.statusCode,
      code: err.code,
      message: err.message,
      details: err.details,
    };
  }
  return {
    statusCode: 500,
    code: 'INTERNAL_ERROR',
    message: 'An unexpected error occurred',
  };
}
