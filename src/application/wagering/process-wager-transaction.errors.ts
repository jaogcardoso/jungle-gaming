import { DomainError } from '../../domain/shared/domain-error';
import { FailureCode } from '../../domain/wagering';

/** Mesma `Idempotency-Key` reenviada com um `payloadHash` diferente. */
export class IdempotencyConflictError extends DomainError {
  readonly code = 'IDEMPOTENCY_CONFLICT';
  readonly failureCode = FailureCode.IdempotencyConflict;

  constructor(idempotencyKey: string) {
    super(`Idempotency-Key "${idempotencyKey}" já usada com um payload diferente`);
  }
}
