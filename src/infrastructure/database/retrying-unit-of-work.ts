import type { TransactionContext, UnitOfWork } from '../../application/ports';
import {
  ConcurrencyConflictError,
  DuplicateIdempotencyKeyError,
  ReversalConflictError,
} from './concurrency.errors';

export class RetriesExhaustedError extends Error {
  constructor(
    attempts: number,
    public override readonly cause: unknown,
  ) {
    super(`Transação abortada após ${attempts} tentativas de concorrência`);
    this.name = 'RetriesExhaustedError';
  }
}

export class RetryingUnitOfWork implements UnitOfWork {
  constructor(
    private readonly inner: UnitOfWork,
    private readonly maxAttempts = 10,
    private readonly baseDelayMs = 15,
    /** Callback de observabilidade — incrementado a cada retry. */
    private readonly onRetry: (reason: string) => void = () => {},
  ) {}

  async run<T>(work: (ctx: TransactionContext) => Promise<T>): Promise<T> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      try {
        return await this.inner.run(work);
      } catch (error) {
        if (
          !(error instanceof ConcurrencyConflictError) &&
          !(error instanceof DuplicateIdempotencyKeyError) &&
          !(error instanceof ReversalConflictError)
        ) {
          throw error;
        }
        lastError = error;
        this.onRetry(
          error instanceof ConcurrencyConflictError
            ? 'concurrency'
            : error instanceof ReversalConflictError
              ? 'reversal_race'
              : 'idempotency_race',
        );
        if (attempt < this.maxAttempts) {
          await sleep(this.baseDelayMs * attempt + Math.random() * this.baseDelayMs);
        }
      }
    }
    throw new RetriesExhaustedError(this.maxAttempts, lastError);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
