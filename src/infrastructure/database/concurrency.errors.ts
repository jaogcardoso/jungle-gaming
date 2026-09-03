/** Erros **transitórios** de concorrência. */

/** O `UPDATE ... */
export class ConcurrencyConflictError extends Error {
  constructor(walletId: string) {
    super(`Conflito de concorrência na wallet ${walletId} (version desatualizada)`);
    this.name = 'ConcurrencyConflictError';
  }
}

export class DuplicateIdempotencyKeyError extends Error {
  constructor(idempotencyKey: string) {
    super(`Idempotency-Key "${idempotencyKey}" inserida concorrentemente por outra requisição`);
    this.name = 'DuplicateIdempotencyKeyError';
  }
}

export class ReversalConflictError extends Error {
  constructor(referenceExternalTransactionId: string) {
    super(`Referência ${referenceExternalTransactionId} já revertida por outra requisição concorrente`);
    this.name = 'ReversalConflictError';
  }
}
