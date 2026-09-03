import { Money } from '../../domain/money';
import { LedgerDirection } from '../../domain/shared/ledger-direction';
import { InsufficientBalanceError, type WalletLedgerEntry } from '../../domain/wallet';
import {
  FailureCode,
  WageringRuleError,
  WagerTransaction,
  WagerTransactionKind,
} from '../../domain/wagering';
import type { Clock, IdGenerator, UnitOfWork } from '../ports';
import {
  IntegrationEvent,
  WagerTransactionPendingReference,
  WagerTransactionProcessed,
  WagerTransactionRejected,
  WalletBalanceChanged,
} from '../events';
import {
  type ProcessWagerTransactionCommand,
  type ProcessWagerTransactionResult,
} from './process-wager-transaction.command';
import { IdempotencyConflictError } from './process-wager-transaction.errors';
import { computePayloadHash } from './payload-hash';

/** O **caso de uso único** (HTTP e SQS). */
export class ProcessWagerTransaction {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
    private readonly consumerName: string,
  ) {}

  async execute(
    command: ProcessWagerTransactionCommand,
  ): Promise<ProcessWagerTransactionResult> {
    const correlationId = command.correlationId ?? this.ids.next();
    const causationId = command.messageId;

    const payloadHash = computePayloadHash({
      providerId: command.providerId,
      externalTransactionId: command.externalTransactionId,
      playerId: command.playerId,
      walletId: command.walletId,
      roundId: command.roundId,
      gameId: command.gameId,
      kind: command.kind,
      money: command.money,
      referenceExternalTransactionId: command.referenceExternalTransactionId,
    });

    return this.uow.run(async (ctx) => {
      const emit = (events: IntegrationEvent<unknown>[]): Promise<void> =>
        ctx.outbox.enqueue(events.map((e) => e.toOutboxInput()));

      const envelope = (aggregateId: string) => ({
        eventId: this.ids.next(),
        aggregateId,
        correlationId,
        causationId,
        occurredAt: this.clock.now(),
      });

      const rejected = async (
        transaction: WagerTransaction,
        code: FailureCode,
      ): Promise<ProcessWagerTransactionResult> => {
        transaction.reject(code);
        await ctx.transactions.insert(transaction);
        await emit([
          new WagerTransactionRejected({
            ...envelope(transaction.walletId),
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
        return this.resultOf(transaction, false);
      };

      if (command.source === 'sqs' && command.messageId) {
        const firstTime = await ctx.inbox.register({
          consumerName: this.consumerName,
          messageId: command.messageId,
          payloadHash,
          receivedAt: this.clock.now(),
        });
        if (!firstTime) {
          const already = await ctx.transactions.findByIdempotencyKey(command.idempotencyKey);
          if (already) {
            return this.resultOf(already, true);
          }
        }
      }

      const existing = await ctx.transactions.findByIdempotencyKey(command.idempotencyKey);
      if (existing) {
        if (existing.matchesPayload(payloadHash)) {
          return this.resultOf(existing, true);
        }
        throw new IdempotencyConflictError(command.idempotencyKey);
      }

      const transaction = WagerTransaction.create({
        id: this.ids.next(),
        providerId: command.providerId,
        externalTransactionId: command.externalTransactionId,
        idempotencyKey: command.idempotencyKey,
        payloadHash,
        walletId: command.walletId,
        playerId: command.playerId,
        roundId: command.roundId,
        gameId: command.gameId,
        kind: command.kind,
        money: Money.from(command.money),
        referenceExternalTransactionId: command.referenceExternalTransactionId,
        createdAt: this.clock.now(),
      });

      let reference: WagerTransaction | undefined;
      if (transaction.requiresReference()) {
        if (!command.referenceExternalTransactionId) {
          return rejected(transaction, FailureCode.ReferenceRequired);
        }
        const found = await ctx.transactions.findByProviderAndExternalId(
          command.providerId,
          command.referenceExternalTransactionId,
        );
        if (!found) {
          transaction.markPendingReference();
          await ctx.transactions.insert(transaction);
          await emit([
            new WagerTransactionPendingReference({
              ...envelope(transaction.walletId),
              data: {
                transactionId: transaction.id,
                providerId: transaction.providerId,
                externalTransactionId: transaction.externalTransactionId,
                kind: transaction.kind,
                walletId: transaction.walletId,
                referenceExternalTransactionId: command.referenceExternalTransactionId,
              },
            }),
          ]);
          return this.resultOf(transaction, false);
        }
        try {
          transaction.assertCanReference(found);
        } catch (error) {
          if (error instanceof WageringRuleError) {
            return rejected(transaction, error.failureCode);
          }
          throw error;
        }
        const alreadyReversed = await ctx.transactions.findProcessedReversal(
          found.id,
          transaction.kind,
        );
        if (alreadyReversed) {
          return rejected(transaction, FailureCode.AlreadyReversed);
        }
        reference = found;
      }

      const wallet = await ctx.wallets.loadForUpdate(command.walletId);
      if (!wallet) {
        return rejected(transaction, FailureCode.InvalidPayload);
      }
      if (wallet.currency !== transaction.money.currency) {
        return rejected(transaction, FailureCode.CurrencyMismatch);
      }

      const now = this.clock.now();
      const processedEvent = (): WagerTransactionProcessed =>
        new WagerTransactionProcessed({
          ...envelope(transaction.walletId),
          data: {
            transactionId: transaction.id,
            providerId: transaction.providerId,
            externalTransactionId: transaction.externalTransactionId,
            kind: transaction.kind,
            walletId: transaction.walletId,
            money: transaction.money.toJSON(),
          },
        });

      if (!transaction.affectsBalance()) {
        transaction.markProcessed(reference?.id, now, wallet.balance);
        await ctx.transactions.insert(transaction);
        await emit([processedEvent()]);
        return this.resultOf(transaction, false);
      }

      const direction = transaction.ledgerDirectionFor(reference);
      const movementCtx = {
        transactionId: transaction.id,
        entryId: this.ids.next(),
        occurredAt: now,
      };

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
          return rejected(transaction, code);
        }
        throw error;
      }

      transaction.markProcessed(reference?.id, now, wallet.balance);

      await ctx.wallets.save(wallet);
      await ctx.transactions.insert(transaction);
      await ctx.ledger.insert(entry);
      await emit([
        processedEvent(),
        new WalletBalanceChanged({
          ...envelope(transaction.walletId),
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

      return this.resultOf(transaction, false);
    });
  }

  private resultOf(
    transaction: WagerTransaction,
    idempotentReplay: boolean,
  ): ProcessWagerTransactionResult {
    return {
      transactionId: transaction.id,
      status: transaction.status,
      balance: transaction.observedBalance ? transaction.observedBalance.toJSON() : null,
      failureCode: transaction.failureCode,
      idempotentReplay,
    };
  }
}
