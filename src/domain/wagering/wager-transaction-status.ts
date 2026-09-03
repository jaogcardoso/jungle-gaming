/** Estados de uma `WagerTransaction` (README 6.3). */
export enum WagerTransactionStatus {
  /** Aceita, ainda não aplicada. */
  Pending = 'PENDING',
  /** Aguardando a transação referenciada (referência fora de ordem — README 7.1). */
  PendingReference = 'PENDING_REFERENCE',
  /** Aplicada (terminal). */
  Processed = 'PROCESSED',
  /** Violação de regra de negócio (terminal). */
  Rejected = 'REJECTED',
  /** Erro permanente de infraestrutura (terminal, auditável). */
  Failed = 'FAILED',
}

export const TERMINAL_STATUSES: ReadonlySet<WagerTransactionStatus> = new Set([
  WagerTransactionStatus.Processed,
  WagerTransactionStatus.Rejected,
  WagerTransactionStatus.Failed,
]);
