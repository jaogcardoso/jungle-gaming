/** Sentido de um lançamento no ledger. */
export enum LedgerDirection {
  Debit = 'DEBIT',
  Credit = 'CREDIT',
}

/** Inverte o sentido — usado pelo ROLLBACK (lançamento inverso da referência). */
export function invertDirection(direction: LedgerDirection): LedgerDirection {
  return direction === LedgerDirection.Debit ? LedgerDirection.Credit : LedgerDirection.Debit;
}
