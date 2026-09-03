import { DomainError } from '../shared/domain-error';
import type { Money } from '../money';

/** Saldo inicial negativo na abertura da wallet. */
export class InvalidInitialBalanceError extends DomainError {
  readonly code = 'INVALID_INITIAL_BALANCE';

  constructor(balance: Money) {
    super(`Saldo inicial não pode ser negativo: ${balance.toString()}`);
  }
}

/** Débito que deixaria o saldo negativo. */
export class InsufficientBalanceError extends DomainError {
  readonly code = 'INSUFFICIENT_BALANCE';

  constructor(
    public readonly walletId: string,
    public readonly balance: Money,
    public readonly attempted: Money,
  ) {
    super(
      `Débito de ${attempted.toString()} excede o saldo de ${balance.toString()} ` +
        `na wallet ${walletId}`,
    );
  }
}

/** Movimentação de valor zero ou negativo — não faz sentido como débito/crédito. */
export class NonPositiveMovementError extends DomainError {
  readonly code = 'NON_POSITIVE_MOVEMENT';

  constructor(amount: Money) {
    super(`Movimentação deve ser um valor positivo, recebido: ${amount.toString()}`);
  }
}

/** Aritmética de um lançamento não fecha (`balanceBefore ± money !== balanceAfter`). */
export class InvalidLedgerEntryError extends DomainError {
  readonly code = 'INVALID_LEDGER_ENTRY';

  constructor(message: string) {
    super(message);
  }
}
