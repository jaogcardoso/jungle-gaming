import { LedgerDirection } from '../../domain/shared/ledger-direction';
import { InsufficientBalanceError, type WalletLedgerEntry } from '../../domain/wallet';
import {
  FailureCode,
  WageringRuleError,
  WagerTransactionKind,
  type WagerTransaction,
} from '../../domain/wagering';
import type { Clock, IdGenerator, TransactionContext, UnitOfWork } from '../ports';
import {
  WagerTransactionProcessed,
  WagerTransactionRejected,
  WalletBalanceChanged,
} from '../events';

export interface ReprocessConfig {
  /** Máximo de tentativas antes de rejeitar com REFERENCE_NOT_FOUND. */
  maxAttempts: number;
  /** TTL: idade máxima da transação antes de desistir. */
  ttlMs: number;
  /** Backoff base (ms). */
  backoffBaseMs: number;
}

export const DEFAULT_REPROCESS_CONFIG: ReprocessConfig = {
  maxAttempts: 10,
  ttlMs: 24 * 60 * 60 * 1000,
  backoffBaseMs: 2000,
};

/** Reprocessa transações `PENDING_REFERENCE` (README 7.1). */
export class ReprocessPendingReferences {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
    private readonly config: ReprocessConfig = DEFAULT_REPROCESS_CONFIG,
  ) {}

  /** Processa um lote. */
  async runOnce(batchSize = 20): Promise<number> {
    const now = this.clock.now();
    const due = await this.uow.run((ctx) =>
      ctx.transactions.findDuePendingReferences(now, batchSize),
    );

    for (const { transaction, attempts } of due) {
      await this.uow.run((ctx) => this.handleOne(ctx, transaction, attempts));
    }
    return due.length;
  }

  private async handleOne(
    ctx: TransactionContext,
    transaction: WagerTransaction,
    attempts: number,
  ): Promise<void> {
    const now = this.clock.now();
    const emit = (events: Array<WagerTransactionProcessed | WagerTransactionRejected | WalletBalanceChanged>) =>
      ctx.outbox.enqueue(events.map((e) => e.toOutboxInput()));
    const envelope = () => ({
      eventId: this.ids.next(),
      aggregateId: transaction.walletId,
      correlationId: transaction.id,
      occurredAt: now,
    });

    const reference = await ctx.transactions.findByProviderAndExternalId(
      transaction.providerId,
      transaction.referenceExternalTransactionId!,
    );

    if (!reference) {
      const nextAttempts = attempts + 1;
      const tooOld = now.getTime() - transaction.createdAt.getTime() > this.config.ttlMs;
      if (nextAttempts >= this.config.maxAttempts || tooOld) {
        transaction.reject(FailureCode.ReferenceNotFound);
        await ctx.transactions.update(transaction);
        await emit([
          new WagerTransactionRejected({
            ...envelope(),
            data: {
              transactionId: transaction.id,
              providerId: transaction.providerId,
              externalTransactionId: transaction.externalTransactionId,
              kind: transaction.kind,
              walletId: transaction.walletId,
              money: transaction.money.toJSON(),
              failureCode: FailureCode.ReferenceNotFound,
            },
          }),
        ]);
        return;
      }
      const delay = Math.min(60 * 60 * 1000, this.config.backoffBaseMs * 2 ** nextAttempts);
      await ctx.transactions.bumpReferenceRetry(
        transaction.id,
        nextAttempts,
        new Date(now.getTime() + delay),
      );
      return;
    }

    if (await ctx.transactions.findProcessedReversal(reference.id, transaction.kind)) {
      transaction.reject(FailureCode.AlreadyReversed);
      await ctx.transactions.update(transaction);
      await emit([
        new WagerTransactionRejected({
          ...envelope(),
          data: {
            transactionId: transaction.id,
            providerId: transaction.providerId,
            externalTransactionId: transaction.externalTransactionId,
            kind: transaction.kind,
            walletId: transaction.walletId,
            money: transaction.money.toJSON(),
            failureCode: FailureCode.AlreadyReversed,
          },
        }),
      ]);
      return;
    }

    try {
      transaction.assertCanReference(reference);
    } catch (error) {
      if (error instanceof WageringRuleError) {
        transaction.reject(error.failureCode);
        await ctx.transactions.update(transaction);
        await emit([
          new WagerTransactionRejected({
            ...envelope(),
            data: {
              transactionId: transaction.id,
              providerId: transaction.providerId,
              externalTransactionId: transaction.externalTransactionId,
              kind: transaction.kind,
              walletId: transaction.walletId,
              money: transaction.money.toJSON(),
              failureCode: error.failureCode,
            },
          }),
        ]);
        return;
      }
      throw error;
    }

    const wallet = await ctx.wallets.loadForUpdate(transaction.walletId);
    if (!wallet) {
      transaction.reject(FailureCode.InvalidPayload);
      await ctx.transactions.update(transaction);
      return;
    }

    const direction = transaction.ledgerDirectionFor(reference);
    const movementCtx = { transactionId: transaction.id, entryId: this.ids.next(), occurredAt: now };
    let entry: WalletLedgerEntry;
    try {
      entry =
        direction === LedgerDirection.Debit
          ? wallet.debit(transaction.money, movementCtx)
          : wallet.credit(transaction.money, movementCtx);
    } catch (error) {
      if (error instanceof InsufficientBalanceError) {
        const code =
          transaction.kind === WagerTransactionKind.Bet
            ? FailureCode.InsufficientFunds
            : FailureCode.ReversalNegativeBalance;
        transaction.reject(code);
        await ctx.transactions.update(transaction);
        await emit([
          new WagerTransactionRejected({
            ...envelope(),
            data: {
              transactionId: transaction.id,
              providerId: transaction.providerId,
              externalTransactionId: transaction.externalTransactionId,
              kind: transaction.kind,
              walletId: transaction.walletId,
              money: transaction.money.toJSON(),
              failureCode: code,
            },
          }),
        ]);
        return;
      }
      throw error;
    }

    transaction.markProcessed(reference.id, now, wallet.balance);
    await ctx.wallets.save(wallet);
    await ctx.transactions.update(transaction);
    await ctx.ledger.insert(entry);
    await emit([
      new WagerTransactionProcessed({
        ...envelope(),
        data: {
          transactionId: transaction.id,
          providerId: transaction.providerId,
          externalTransactionId: transaction.externalTransactionId,
          kind: transaction.kind,
          walletId: transaction.walletId,
          money: transaction.money.toJSON(),
        },
      }),
      new WalletBalanceChanged({
        ...envelope(),
        data: {
          walletId: wallet.id,
          transactionId: transaction.id,
          direction: entry.direction,
          money: entry.money.toJSON(),
          balanceBefore: entry.balanceBefore.toJSON(),
          balanceAfter: entry.balanceAfter.toJSON(),
          walletVersion: wallet.version,
        },
      }),
    ]);
  }
}
