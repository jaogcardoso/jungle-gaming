/** Tipo da operação de aposta (README 6.3). */
export enum WagerTransactionKind {
  /** Crédito de abertura da wallet. */
  Opening = 'OPENING',
  /** Aposta — débito. */
  Bet = 'BET',
  /** Ganho — crédito. */
  Win = 'WIN',
  /** Perda — não move saldo, não gera ledger; só registra o resultado. */
  Loss = 'LOSS',
  /** Estorno de uma `BET` `PROCESSED` — crédito, uma única vez. */
  Refund = 'REFUND',
  /** Reversão de uma transação `PROCESSED` — lançamento inverso, uma única vez. */
  Rollback = 'ROLLBACK',
}
