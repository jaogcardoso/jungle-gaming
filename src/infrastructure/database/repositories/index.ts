import type { EntityManager } from '@mikro-orm/postgresql';
import { UniqueConstraintViolationException, type RequiredEntityData } from '@mikro-orm/core';
import { Money } from '../../../domain/money';
import type { Wallet, WalletLedgerEntry } from '../../../domain/wallet';
import type { WagerTransaction } from '../../../domain/wagering';
import type {
  InboxRepository,
  LedgerRepository,
  OutboxEventInput,
  OutboxRepository,
  RegisterInboxInput,
  WagerTransactionRepository,
  WalletRepository,
} from '../../../application/ports';
import { WalletAlreadyExistsError } from '../../../application/ports';
import { WalletEntity } from '../entities/wallet.entity';
import { WagerTransactionEntity } from '../entities/wager-transaction.entity';
import { WalletLedgerEntryEntity } from '../entities/wallet-ledger-entry.entity';
import { InboxMessageEntity } from '../entities/inbox-message.entity';
import { OutboxMessageEntity } from '../entities/outbox-message.entity';
import {
  ledgerEntryToInsert,
  wagerTransactionToDomain,
  wagerTransactionToInsert,
  walletToDomain,
  walletToInsert,
} from '../mappers';
import {
  ConcurrencyConflictError,
  DuplicateIdempotencyKeyError,
  ReversalConflictError,
} from '../concurrency.errors';

export class MikroOrmWalletRepository implements WalletRepository {
  constructor(private readonly em: EntityManager) {}

  async loadForUpdate(walletId: string): Promise<Wallet | null> {
    const entity = await this.em.findOne(WalletEntity, { id: walletId });
    return entity ? walletToDomain(entity) : null;
  }

  async insert(wallet: Wallet): Promise<void> {
    try {
      await this.em.insert(
        WalletEntity,
        walletToInsert(wallet) as unknown as RequiredEntityData<WalletEntity>,
      );
    } catch (error) {
      if (error instanceof UniqueConstraintViolationException) {
        throw new WalletAlreadyExistsError(wallet.playerId, wallet.currency);
      }
      throw error;
    }
  }

  async save(wallet: Wallet): Promise<void> {
    const balance = wallet.balance.toJSON();
    const affected = await this.em.nativeUpdate(
      WalletEntity,
      { id: wallet.id, version: wallet.version - 1 },
      {
        balanceAmount: balance.amount,
        version: wallet.version,
        updatedAt: wallet.updatedAt,
      },
    );
    if (affected === 0) {
      throw new ConcurrencyConflictError(wallet.id);
    }
  }
}

export class MikroOrmWagerTransactionRepository implements WagerTransactionRepository {
  constructor(private readonly em: EntityManager) {}

  async findByIdempotencyKey(idempotencyKey: string): Promise<WagerTransaction | null> {
    const e = await this.em.findOne(WagerTransactionEntity, { idempotencyKey });
    return e ? wagerTransactionToDomain(e) : null;
  }

  async findByProviderAndExternalId(
    providerId: string,
    externalTransactionId: string,
  ): Promise<WagerTransaction | null> {
    const e = await this.em.findOne(WagerTransactionEntity, {
      providerId,
      externalTransactionId,
    });
    return e ? wagerTransactionToDomain(e) : null;
  }

  async insert(transaction: WagerTransaction): Promise<void> {
    try {
      await this.em.insert(
        WagerTransactionEntity,
        wagerTransactionToInsert(transaction) as unknown as RequiredEntityData<WagerTransactionEntity>,
      );
    } catch (error) {
      if (error instanceof UniqueConstraintViolationException) {
        const msg = String((error as Error).message);
        if (/wager_tx_one_reversal_per_kind_uq/.test(msg)) {
          throw new ReversalConflictError(transaction.referenceExternalTransactionId ?? '(?)');
        }
        if (/wager_tx_idempotency_key_uq|wager_tx_provider_external_uq/.test(msg)) {
          throw new DuplicateIdempotencyKeyError(transaction.idempotencyKey);
        }
      }
      throw error;
    }
  }

  async findProcessedReversal(
    referenceTransactionId: string,
    kind: string,
  ): Promise<boolean> {
    const count = await this.em.count(WagerTransactionEntity, {
      referenceTransactionId,
      kind,
      status: 'PROCESSED',
    });
    return count > 0;
  }

  async update(transaction: WagerTransaction): Promise<void> {
    await this.em.nativeUpdate(
      WagerTransactionEntity,
      { id: transaction.id },
      {
        status: transaction.status,
        failureCode: transaction.failureCode ?? null,
        referenceTransactionId: transaction.referenceTransactionId ?? null,
        processedAt: transaction.processedAt ?? null,
        observedBalanceAmount: transaction.observedBalance
          ? transaction.observedBalance.toJSON().amount
          : null,
      },
    );
  }

  async findDuePendingReferences(
    now: Date,
    limit: number,
  ): Promise<Array<{ transaction: WagerTransaction; attempts: number }>> {
    const rows = await this.em.find(
      WagerTransactionEntity,
      {
        status: 'PENDING_REFERENCE',
        $or: [
          { referenceNextAttemptAt: null },
          { referenceNextAttemptAt: { $lte: now } },
        ],
      },
      { limit, orderBy: { createdAt: 'asc' } },
    );
    return rows.map((e) => ({
      transaction: wagerTransactionToDomain(e),
      attempts: e.referenceAttempts,
    }));
  }

  async bumpReferenceRetry(
    transactionId: string,
    attempts: number,
    nextAttemptAt: Date,
  ): Promise<void> {
    await this.em.nativeUpdate(
      WagerTransactionEntity,
      { id: transactionId },
      { referenceAttempts: attempts, referenceNextAttemptAt: nextAttemptAt },
    );
  }
}

export class MikroOrmLedgerRepository implements LedgerRepository {
  constructor(private readonly em: EntityManager) {}

  async insert(entry: WalletLedgerEntry): Promise<void> {
    await this.em.insert(
      WalletLedgerEntryEntity,
      ledgerEntryToInsert(entry) as unknown as RequiredEntityData<WalletLedgerEntryEntity>,
    );
  }

  async sumForWallet(walletId: string): Promise<{ total: Money | null; count: number }> {
    const rows = (await this.em.getConnection().execute(
      `select
         coalesce(sum(case when direction = 'CREDIT' then money_amount else -money_amount end), 0) as total,
         count(*) as count,
         max(money_currency) as currency
       from wallet_ledger_entry where wallet_id = ?`,
      [walletId],
    )) as Array<{ total: string; count: string; currency: string | null }>;
    const row = rows[0]!;
    const count = Number(row.count);
    const total = count > 0 ? Money.from({ amount: row.total, currency: row.currency!.trim() }) : null;
    return { total, count };
  }
}

export class MikroOrmInboxRepository implements InboxRepository {
  constructor(private readonly em: EntityManager) {}

  async register(input: RegisterInboxInput): Promise<boolean> {
    try {
      await this.em.transactional(async (em) => {
        await em.insert(InboxMessageEntity, {
          consumerName: input.consumerName,
          messageId: input.messageId,
          payloadHash: input.payloadHash,
          receivedAt: input.receivedAt,
          processedAt: null,
        });
      });
      return true;
    } catch (error) {
      if (error instanceof UniqueConstraintViolationException) {
        return false; 
      }
      throw error;
    }
  }
}

export class MikroOrmOutboxRepository implements OutboxRepository {
  constructor(
    private readonly em: EntityManager,
    private readonly nextId: () => string,
  ) {}

  async enqueue(events: OutboxEventInput[]): Promise<void> {
    for (const e of events) {
      await this.em.insert(OutboxMessageEntity, {
        id: this.nextId(),
        aggregateId: e.aggregateId,
        eventType: e.eventType,
        payload: e.payload,
        occurredAt: e.occurredAt,
        attempts: 0,
        nextAttemptAt: null,
        publishedAt: null,
      });
    }
  }
}
