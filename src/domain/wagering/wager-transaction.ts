import { Money } from '../money';
import { LedgerDirection, invertDirection } from '../shared/ledger-direction';
import { FailureCode } from './failure-code';
import { WagerTransactionKind } from './wager-transaction-kind';
import { TERMINAL_STATUSES, WagerTransactionStatus } from './wager-transaction-status';
import {
  InvalidTransactionStateError,
  LedgerDirectionNotApplicableError,
  OpeningNotSubmittableError,
  ReferenceAmountMismatchError,
  ReferenceKindNotAllowedError,
  ReferenceMismatchError,
  ReferenceNotProcessedError,
  ReferenceRequiredError,
} from './wagering.errors';

export interface CreateWagerTransactionProps {
  id: string;
  providerId: string;
  externalTransactionId: string;
  idempotencyKey: string;
  payloadHash: string;
  walletId: string;
  playerId: string;
  roundId: string;
  gameId: string;
  kind: WagerTransactionKind;
  money: Money;
  /** Id **no provedor** da transação referenciada (não o id interno). */
  referenceExternalTransactionId?: string;
  createdAt: Date;
}

export interface WagerTransactionState extends CreateWagerTransactionProps {
  status: WagerTransactionStatus;
  referenceTransactionId?: string;
  failureCode?: FailureCode;
  processedAt?: Date;
  observedBalance?: Money;
}

/** Quais `kind` cada operação de reversão pode referenciar (README 7.3). */
const ALLOWED_REFERENCE_KINDS: Record<string, ReadonlySet<WagerTransactionKind>> = {
  [WagerTransactionKind.Refund]: new Set([WagerTransactionKind.Bet]),
  [WagerTransactionKind.Rollback]: new Set([
    WagerTransactionKind.Bet,
    WagerTransactionKind.Win,
    WagerTransactionKind.Refund,
  ]),
};

/** A transação de aposta e sua **máquina de estados**. */
export class WagerTransaction {
  readonly id: string;
  readonly providerId: string;
  readonly externalTransactionId: string;
  readonly idempotencyKey: string;
  readonly payloadHash: string;
  readonly walletId: string;
  readonly playerId: string;
  readonly roundId: string;
  readonly gameId: string;
  readonly kind: WagerTransactionKind;
  readonly money: Money;
  readonly referenceExternalTransactionId: string | undefined;
  readonly createdAt: Date;

  private _status: WagerTransactionStatus;
  private _referenceTransactionId: string | undefined;
  private _failureCode: FailureCode | undefined;
  private _processedAt: Date | undefined;
  /** Saldo da wallet observado no instante em que ESTA transação foi aplicada (README 7.7). */
  private _observedBalance: Money | undefined;

  private constructor(state: WagerTransactionState) {
    this.id = state.id;
    this.providerId = state.providerId;
    this.externalTransactionId = state.externalTransactionId;
    this.idempotencyKey = state.idempotencyKey;
    this.payloadHash = state.payloadHash;
    this.walletId = state.walletId;
    this.playerId = state.playerId;
    this.roundId = state.roundId;
    this.gameId = state.gameId;
    this.kind = state.kind;
    this.money = state.money;
    this.referenceExternalTransactionId = state.referenceExternalTransactionId;
    this.createdAt = state.createdAt;
    this._status = state.status;
    this._referenceTransactionId = state.referenceTransactionId;
    this._failureCode = state.failureCode;
    this._processedAt = state.processedAt;
    this._observedBalance = state.observedBalance;
  }

  /** Nasce em `PENDING`. */
  static create(props: CreateWagerTransactionProps): WagerTransaction {
    if (props.kind === WagerTransactionKind.Opening) {
      throw new OpeningNotSubmittableError();
    }

    return new WagerTransaction({
      ...props,
      status: WagerTransactionStatus.Pending,
      referenceTransactionId: undefined,
      failureCode: undefined,
      processedAt: undefined,
    });
  }

  /** Reconstrução a partir da persistência — NÃO revalida transições. */
  static rehydrate(state: WagerTransactionState): WagerTransaction {
    return new WagerTransaction(state);
  }

  /** Factory **interna** do crédito de abertura da wallet (`OPENING`). */
  static opening(props: {
    id: string;
    walletId: string;
    playerId: string;
    money: Money;
    createdAt: Date;
    observedBalance: Money;
  }): WagerTransaction {
    return new WagerTransaction({
      id: props.id,
      providerId: 'internal',
      externalTransactionId: `opening:${props.walletId}`,
      idempotencyKey: `opening:${props.walletId}`,
      payloadHash: 'opening',
      walletId: props.walletId,
      playerId: props.playerId,
      roundId: 'opening',
      gameId: 'opening',
      kind: WagerTransactionKind.Opening,
      money: props.money,
      referenceExternalTransactionId: undefined,
      createdAt: props.createdAt,
      status: WagerTransactionStatus.Processed,
      referenceTransactionId: undefined,
      failureCode: undefined,
      processedAt: props.createdAt,
      observedBalance: props.observedBalance,
    });
  }

  get status(): WagerTransactionStatus {
    return this._status;
  }

  get referenceTransactionId(): string | undefined {
    return this._referenceTransactionId;
  }

  get failureCode(): FailureCode | undefined {
    return this._failureCode;
  }

  get processedAt(): Date | undefined {
    return this._processedAt;
  }

  get observedBalance(): Money | undefined {
    return this._observedBalance;
  }

  /** `observedBalance`: saldo da wallet logo após aplicar esta transação (para LOSS, inalterado). */
  markProcessed(
    referenceTransactionId: string | undefined,
    at: Date,
    observedBalance?: Money,
  ): void {
    this.assertTransitionableFrom(
      [WagerTransactionStatus.Pending, WagerTransactionStatus.PendingReference],
      'markProcessed',
    );
    this._status = WagerTransactionStatus.Processed;
    this._referenceTransactionId = referenceTransactionId;
    this._processedAt = at;
    this._observedBalance = observedBalance;
  }

  markPendingReference(): void {
    this.assertTransitionableFrom([WagerTransactionStatus.Pending], 'markPendingReference');
    this._status = WagerTransactionStatus.PendingReference;
  }

  reject(code: FailureCode): void {
    this.assertTransitionableFrom(
      [WagerTransactionStatus.Pending, WagerTransactionStatus.PendingReference],
      'reject',
    );
    this._status = WagerTransactionStatus.Rejected;
    this._failureCode = code;
  }

  fail(code: FailureCode): void {
    this.assertTransitionableFrom(
      [WagerTransactionStatus.Pending, WagerTransactionStatus.PendingReference],
      'fail',
    );
    this._status = WagerTransactionStatus.Failed;
    this._failureCode = code;
  }

  isTerminal(): boolean {
    return TERMINAL_STATUSES.has(this._status);
  }

  /** `false` apenas para `LOSS`. */
  affectsBalance(): boolean {
    return this.kind !== WagerTransactionKind.Loss;
  }

  /** `true` para `REFUND` e `ROLLBACK`. */
  requiresReference(): boolean {
    return (
      this.kind === WagerTransactionKind.Refund || this.kind === WagerTransactionKind.Rollback
    );
  }

  matchesPayload(payloadHash: string): boolean {
    return this.payloadHash === payloadHash;
  }

  /** Sentido do lançamento no ledger. */
  ledgerDirectionFor(reference?: WagerTransaction): LedgerDirection {
    switch (this.kind) {
      case WagerTransactionKind.Bet:
        return LedgerDirection.Debit;
      case WagerTransactionKind.Win:
      case WagerTransactionKind.Refund:
      case WagerTransactionKind.Opening:
        return LedgerDirection.Credit;
      case WagerTransactionKind.Rollback: {
        if (!reference) {
          throw new ReferenceRequiredError(this.kind);
        }
        return invertDirection(reference.ledgerDirectionFor());
      }
      case WagerTransactionKind.Loss:
        throw new LedgerDirectionNotApplicableError(this.kind);
      default:
        throw new LedgerDirectionNotApplicableError(String(this.kind));
    }
  }

  /** Valida se `reference` é elegível para esta operação de reversão (README 7.2–7.5). */
  assertCanReference(reference: WagerTransaction): void {
    if (!this.requiresReference()) {
      return;
    }

    if (reference.status !== WagerTransactionStatus.Processed) {
      throw new ReferenceNotProcessedError(reference.status);
    }

    const allowedKinds = ALLOWED_REFERENCE_KINDS[this.kind];
    if (!allowedKinds || !allowedKinds.has(reference.kind)) {
      throw new ReferenceKindNotAllowedError(this.kind, reference.kind);
    }

    const contextChecks: ReadonlyArray<[string, boolean]> = [
      ['providerId', reference.providerId === this.providerId],
      ['playerId', reference.playerId === this.playerId],
      ['walletId', reference.walletId === this.walletId],
      ['roundId', reference.roundId === this.roundId],
      ['currency', reference.money.currency === this.money.currency],
    ];
    for (const [field, ok] of contextChecks) {
      if (!ok) {
        throw new ReferenceMismatchError(field);
      }
    }

    if (!this.money.equals(reference.money)) {
      throw new ReferenceAmountMismatchError(
        this.money.toString(),
        reference.money.toString(),
      );
    }
  }

  private assertTransitionableFrom(
    allowed: ReadonlyArray<WagerTransactionStatus>,
    attempted: string,
  ): void {
    if (!allowed.includes(this._status)) {
      throw new InvalidTransactionStateError(this._status, attempted);
    }
  }
}
