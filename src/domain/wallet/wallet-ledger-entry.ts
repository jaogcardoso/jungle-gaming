import { Money } from '../money';
import { LedgerDirection } from '../shared/ledger-direction';
import { InvalidLedgerEntryError } from './wallet.errors';

export interface CreateLedgerEntryProps {
  id: string;
  walletId: string;
  transactionId: string;
  direction: LedgerDirection;
  money: Money;
  balanceBefore: Money;
  balanceAfter: Money;
  createdAt: Date;
}

/** Estado bruto vindo do banco — reidratado sem revalidar. */
export type LedgerEntryState = CreateLedgerEntryProps;

/** Um lançamento no livro-razão. */
export class WalletLedgerEntry {
  readonly id: string;
  readonly walletId: string;
  readonly transactionId: string;
  readonly direction: LedgerDirection;
  readonly money: Money;
  readonly balanceBefore: Money;
  readonly balanceAfter: Money;
  readonly createdAt: Date;

  private constructor(props: CreateLedgerEntryProps) {
    this.id = props.id;
    this.walletId = props.walletId;
    this.transactionId = props.transactionId;
    this.direction = props.direction;
    this.money = props.money;
    this.balanceBefore = props.balanceBefore;
    this.balanceAfter = props.balanceAfter;
    this.createdAt = props.createdAt;
    Object.freeze(this);
  }

  static create(props: CreateLedgerEntryProps): WalletLedgerEntry {
    const currencies = new Set([
      props.money.currency,
      props.balanceBefore.currency,
      props.balanceAfter.currency,
    ]);
    if (currencies.size > 1) {
      throw new InvalidLedgerEntryError(
        `Moedas divergentes no lançamento: ${[...currencies].join(', ')}`,
      );
    }
    if (!props.money.isPositive()) {
      throw new InvalidLedgerEntryError(
        `Valor do lançamento deve ser positivo, recebido: ${props.money.toString()}`,
      );
    }

    const expectedAfter =
      props.direction === LedgerDirection.Credit
        ? props.balanceBefore.add(props.money)
        : props.balanceBefore.subtract(props.money);

    if (!expectedAfter.equals(props.balanceAfter)) {
      throw new InvalidLedgerEntryError(
        `Aritmética inválida: ${props.balanceBefore.toString()} ${props.direction} ` +
          `${props.money.toString()} deveria dar ${expectedAfter.toString()}, ` +
          `mas balanceAfter é ${props.balanceAfter.toString()}`,
      );
    }

    return new WalletLedgerEntry(props);
  }

  /** Reconstrução a partir da persistência — NÃO revalida. */
  static rehydrate(state: LedgerEntryState): WalletLedgerEntry {
    return new WalletLedgerEntry(state);
  }

  /** `balanceBefore ± money === balanceAfter`. */
  isBalanced(): boolean {
    const expectedAfter =
      this.direction === LedgerDirection.Credit
        ? this.balanceBefore.add(this.money)
        : this.balanceBefore.subtract(this.money);
    return expectedAfter.equals(this.balanceAfter);
  }
}
