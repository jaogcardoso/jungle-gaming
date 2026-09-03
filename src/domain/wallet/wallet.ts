import { Money } from '../money';
import { CurrencyMismatchError } from '../money';
import { LedgerDirection } from '../shared/ledger-direction';
import {
  InsufficientBalanceError,
  InvalidInitialBalanceError,
  NonPositiveMovementError,
} from './wallet.errors';
import { WalletLedgerEntry } from './wallet-ledger-entry';

/** Dados que a camada de aplicação injeta (id/relógio ficam fora do domínio). */
export interface WalletMovementContext {
  /** Id da `WagerTransaction` que causou esta movimentação. */
  transactionId: string;
  /** Id do lançamento de ledger a ser criado. */
  entryId: string;
  /** Instante da movimentação (vem de um `Clock` na aplicação). */
  occurredAt: Date;
}

export interface OpenWalletProps {
  id: string;
  playerId: string;
  initialBalance: Money;
  /** Ids do lançamento/transação `OPENING`, usados só se o saldo inicial > 0. */
  openingTransactionId: string;
  openingEntryId: string;
  now: Date;
}

export interface WalletState {
  id: string;
  playerId: string;
  currency: string;
  balance: Money;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface OpenWalletResult {
  wallet: Wallet;
  /** `null` quando o saldo inicial é zero (não há movimentação, logo não há ledger). */
  openingEntry: WalletLedgerEntry | null;
}

/** Aggregate Root da carteira. */
export class Wallet {
  readonly id: string;
  readonly playerId: string;
  readonly currency: string;
  readonly createdAt: Date;

  private _balance: Money;
  private _version: number;
  private _updatedAt: Date;

  private constructor(state: WalletState) {
    this.id = state.id;
    this.playerId = state.playerId;
    this.currency = state.currency;
    this.createdAt = state.createdAt;
    this._balance = state.balance;
    this._version = state.version;
    this._updatedAt = state.updatedAt;
  }

  /** Abre a wallet. */
  static open(props: OpenWalletProps): OpenWalletResult {
    if (props.initialBalance.isNegative()) {
      throw new InvalidInitialBalanceError(props.initialBalance);
    }

    const currency = props.initialBalance.currency;
    const wallet = new Wallet({
      id: props.id,
      playerId: props.playerId,
      currency,
      balance: props.initialBalance,
      version: 1,
      createdAt: props.now,
      updatedAt: props.now,
    });

    if (props.initialBalance.isZero()) {
      return { wallet, openingEntry: null };
    }

    const openingEntry = WalletLedgerEntry.create({
      id: props.openingEntryId,
      walletId: props.id,
      transactionId: props.openingTransactionId,
      direction: LedgerDirection.Credit,
      money: props.initialBalance,
      balanceBefore: Money.zero(currency),
      balanceAfter: props.initialBalance,
      createdAt: props.now,
    });

    return { wallet, openingEntry };
  }

  /** Reconstrução a partir da persistência — NÃO revalida transições. */
  static rehydrate(state: WalletState): Wallet {
    return new Wallet(state);
  }

  get balance(): Money {
    return this._balance;
  }

  get version(): number {
    return this._version;
  }

  get updatedAt(): Date {
    return this._updatedAt;
  }

  /** Credita a wallet e devolve o lançamento `CREDIT` correspondente. */
  credit(amount: Money, ctx: WalletMovementContext): WalletLedgerEntry {
    this.assertSameCurrency(amount);
    this.assertPositiveMovement(amount);

    const before = this._balance;
    const after = before.add(amount);

    return this.applyMovement(LedgerDirection.Credit, amount, before, after, ctx);
  }

  /** Debita a wallet e devolve o lançamento `DEBIT` correspondente. */
  debit(amount: Money, ctx: WalletMovementContext): WalletLedgerEntry {
    this.assertSameCurrency(amount);
    this.assertPositiveMovement(amount);

    const before = this._balance;
    const after = before.subtract(amount);
    if (after.isNegative()) {
      throw new InsufficientBalanceError(this.id, before, amount);
    }

    return this.applyMovement(LedgerDirection.Debit, amount, before, after, ctx);
  }

  private applyMovement(
    direction: LedgerDirection,
    amount: Money,
    before: Money,
    after: Money,
    ctx: WalletMovementContext,
  ): WalletLedgerEntry {
    const entry = WalletLedgerEntry.create({
      id: ctx.entryId,
      walletId: this.id,
      transactionId: ctx.transactionId,
      direction,
      money: amount,
      balanceBefore: before,
      balanceAfter: after,
      createdAt: ctx.occurredAt,
    });

    this._balance = after;
    this._version += 1;
    this._updatedAt = ctx.occurredAt;

    return entry;
  }

  private assertSameCurrency(amount: Money): void {
    if (amount.currency !== this.currency) {
      throw new CurrencyMismatchError(this.currency, amount.currency);
    }
  }

  private assertPositiveMovement(amount: Money): void {
    if (!amount.isPositive()) {
      throw new NonPositiveMovementError(amount);
    }
  }
}
