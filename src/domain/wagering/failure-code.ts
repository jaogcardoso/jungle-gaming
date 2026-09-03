/** Taxonomia de falha (README 7.2). */
export enum FailureCode {
  /** Payload malformado: campo ausente, tipo errado, `Money` inválido. */
  InvalidPayload = 'INVALID_PAYLOAD',
  /** Mesma `Idempotency-Key` reutilizada com um `payloadHash` diferente. */
  IdempotencyConflict = 'IDEMPOTENCY_CONFLICT',
  /** Moeda da operação diferente da moeda da wallet. */
  CurrencyMismatch = 'CURRENCY_MISMATCH',

  /** `BET` sem saldo suficiente. */
  InsufficientFunds = 'INSUFFICIENT_FUNDS',
  /** `REFUND`/`ROLLBACK` que deixaria o saldo negativo. */
  ReversalNegativeBalance = 'REVERSAL_NEGATIVE_BALANCE',

  /** `REFUND`/`ROLLBACK` chegou sem `referenceExternalTransactionId`. */
  ReferenceRequired = 'REFERENCE_REQUIRED',
  /** Referência não encontrada mesmo após esgotar as tentativas (README 7.1). */
  ReferenceNotFound = 'REFERENCE_NOT_FOUND',
  /** Referência existe, mas provider/player/wallet/moeda/rodada divergem. */
  ReferenceMismatch = 'REFERENCE_MISMATCH',
  /** `REFUND` apontando para algo que não é `BET`, ou `ROLLBACK` para tipo inválido. */
  ReferenceKindNotAllowed = 'REFERENCE_KIND_NOT_ALLOWED',
  /** Referência ainda não está `PROCESSED` (só se reverte transação aplicada). */
  ReferenceNotProcessed = 'REFERENCE_NOT_PROCESSED',
  /** Valor da reversão diferente do valor da referência (reversão parcial fora de escopo). */
  ReferenceAmountMismatch = 'REFERENCE_AMOUNT_MISMATCH',
  /** Referência já revertida por uma operação do mesmo tipo (README 7.4). */
  AlreadyReversed = 'ALREADY_REVERSED',

  /** Erro permanente de infra (após retries): vai para DLQ, auditável. */
  PermanentInfrastructureError = 'PERMANENT_INFRASTRUCTURE_ERROR',
}
