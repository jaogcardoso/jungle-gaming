import Decimal from 'decimal.js';
import { CurrencyMismatchError, InvalidMoneyError } from './money.errors';

/** DTO de fronteira — a forma como dinheiro trafega nos contratos HTTP/SQS e no payload dos eventos. */
export interface MoneyProps {
  amount: string;
  /** ISO-4217 (ex.: "BRL"). */
  currency: string;
}

/** Instância de Decimal isolada. */
const Big = Decimal.clone({
  precision: 40,
  rounding: Decimal.ROUND_HALF_EVEN,
});

/** Escala fixa: dinheiro sempre com exatamente 2 casas na serialização. */
const SCALE = 2;

/** String decimal não-negativa, com no máximo 2 casas, SEM sinal e SEM notação científica. */
const AMOUNT_PATTERN = /^\d+(\.\d{1,2})?$/;

/** Código ISO-4217: 3 letras maiúsculas. */
const CURRENCY_PATTERN = /^[A-Z]{3}$/;

/** Value Object monetário: **imutável** e **exato**. */
export class Money {
  private constructor(
    private readonly value: Decimal,
    public readonly currency: string,
  ) {
    Object.freeze(this);
  }

  /** Factory de contrato de entrada. */
  static from(props: MoneyProps): Money {
    const currency = Money.assertCurrency(props.currency);

    if (typeof props.amount !== 'string') {
      throw new InvalidMoneyError('amount deve ser uma string decimal, ex.: "25.00"');
    }
    if (!AMOUNT_PATTERN.test(props.amount)) {
      throw new InvalidMoneyError(
        `amount inválido: ${JSON.stringify(props.amount)} — esperado string decimal ` +
          `não-negativa com no máximo ${SCALE} casas (sem sinal, sem notação científica)`,
      );
    }

    return new Money(new Big(props.amount), currency);
  }

  static zero(currency: string): Money {
    return new Money(new Big(0), Money.assertCurrency(currency));
  }

  add(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.value.plus(other.value), this.currency);
  }

  subtract(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.value.minus(other.value), this.currency);
  }

  negate(): Money {
    return new Money(this.value.negated(), this.currency);
  }

  isZero(): boolean {
    return this.value.isZero();
  }

  isPositive(): boolean {
    return this.value.greaterThan(0);
  }

  isNegative(): boolean {
    return this.value.lessThan(0);
  }

  /** Ordena valores. Moedas diferentes é erro de domínio (comparação sem sentido). */
  isLessThan(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.value.lessThan(other.value);
  }

  /** Igualdade total: moedas diferentes → `false` (nunca lança). */
  equals(other: Money): boolean {
    return this.currency === other.currency && this.value.equals(other.value);
  }

  /** Forma serializada — o que vai para o corpo da resposta e para os eventos. */
  toJSON(): MoneyProps {
    return { amount: this.value.toFixed(SCALE), currency: this.currency };
  }

  /** Legível para logs e mensagens de erro. */
  toString(): string {
    return `${this.value.toFixed(SCALE)} ${this.currency}`;
  }

  private assertSameCurrency(other: Money): void {
    if (this.currency !== other.currency) {
      throw new CurrencyMismatchError(this.currency, other.currency);
    }
  }

  private static assertCurrency(currency: unknown): string {
    if (typeof currency !== 'string' || !CURRENCY_PATTERN.test(currency)) {
      throw new InvalidMoneyError(
        `currency inválida: ${JSON.stringify(currency)} — esperado código ISO-4217 ` +
          `(3 letras maiúsculas), ex.: "BRL"`,
      );
    }
    return currency;
  }
}
