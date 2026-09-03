import { DomainError } from '../shared/domain-error';

/** `amount` ou `currency` fora do contrato de entrada. */
export class InvalidMoneyError extends DomainError {
  readonly code = 'INVALID_MONEY';

  constructor(message: string) {
    super(message);
  }
}

/** Tentativa de operar (somar, subtrair, comparar ordem) moedas diferentes. */
export class CurrencyMismatchError extends DomainError {
  readonly code = 'CURRENCY_MISMATCH';

  constructor(
    public readonly left: string,
    public readonly right: string,
  ) {
    super(`Operação entre moedas diferentes: ${left} e ${right}`);
  }
}
