import type { Clock, IdGenerator, OutboxEventInput, TransactionContext, UnitOfWork } from '../../src/application/ports';
import { WalletAlreadyExistsError } from '../../src/application/ports';
import { Money } from '../../src/domain/money';
import type { Wallet, WalletLedgerEntry } from '../../src/domain/wallet';
import type { WagerTransaction } from '../../src/domain/wagering';

export class FakeClock implements Clock {
  constructor(private current = new Date('2026-01-01T00:00:00.000Z')) {}
  now(): Date {
    return this.current;
  }
  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}

export class SequentialIdGenerator implements IdGenerator {
  private n = 0;
  next(): string {
    this.n += 1;
    return `id-${this.n}`;
  }
}

/** `UnitOfWork` em memória para testar o caso de uso sem banco. */
export class InMemoryUnitOfWork implements UnitOfWork {
  wallets = new Map<string, Wallet>();
  transactions: WagerTransaction[] = [];
  ledger: WalletLedgerEntry[] = [];
  inbox = new Set<string>();
  outbox: OutboxEventInput[] = [];
  referenceRetries = new Map<string, { attempts: number; nextAttemptAt: Date }>();

  async run<T>(work: (ctx: TransactionContext) => Promise<T>): Promise<T> {
    const snapshot = {
      transactions: [...this.transactions],
      ledger: [...this.ledger],
      inbox: new Set(this.inbox),
      outbox: [...this.outbox],
    };

    const ctx: TransactionContext = {
      wallets: {
        loadForUpdate: async (id) => this.wallets.get(id) ?? null,
        insert: async (w) => {
          for (const existing of this.wallets.values()) {
            if (existing.playerId === w.playerId && existing.currency === w.currency) {
              throw new WalletAlreadyExistsError(w.playerId, w.currency);
            }
          }
          this.wallets.set(w.id, w);
        },
        save: async () => {
        },
      },
      transactions: {
        findByIdempotencyKey: async (key) =>
          this.transactions.find((t) => t.idempotencyKey === key) ?? null,
        findByProviderAndExternalId: async (providerId, externalId) =>
          this.transactions.find(
            (t) => t.providerId === providerId && t.externalTransactionId === externalId,
          ) ?? null,
        insert: async (t) => {
          this.transactions.push(t);
        },
        update: async () => {
        },
        findProcessedReversal: async (referenceTransactionId, kind) =>
          this.transactions.some(
            (t) =>
              t.referenceTransactionId === referenceTransactionId &&
              t.kind === kind &&
              t.status === 'PROCESSED',
          ),
        findDuePendingReferences: async (now, limit) =>
          this.transactions
            .filter((t) => t.status === 'PENDING_REFERENCE')
            .filter((t) => {
              const r = this.referenceRetries.get(t.id);
              return !r || r.nextAttemptAt <= now;
            })
            .slice(0, limit)
            .map((t) => ({
              transaction: t,
              attempts: this.referenceRetries.get(t.id)?.attempts ?? 0,
            })),
        bumpReferenceRetry: async (id, attempts, nextAttemptAt) => {
          this.referenceRetries.set(id, { attempts, nextAttemptAt });
        },
      },
      ledger: {
        insert: async (e) => {
          this.ledger.push(e);
        },
        sumForWallet: async (walletId) => {
          const entries = this.ledger.filter((e) => e.walletId === walletId);
          if (entries.length === 0) {
            return { total: null, count: 0 };
          }
          let total = Money.zero(entries[0]!.money.currency);
          for (const e of entries) {
            total = e.direction === 'CREDIT' ? total.add(e.money) : total.subtract(e.money);
          }
          return { total, count: entries.length };
        },
      },
      inbox: {
        register: async (input) => {
          const key = `${input.consumerName}|${input.messageId}`;
          if (this.inbox.has(key)) {
            return false;
          }
          this.inbox.add(key);
          return true;
        },
      },
      outbox: {
        enqueue: async (events) => {
          this.outbox.push(...events);
        },
      },
    };

    try {
      return await work(ctx);
    } catch (error) {
      this.transactions = snapshot.transactions;
      this.ledger = snapshot.ledger;
      this.inbox = snapshot.inbox;
      this.outbox = snapshot.outbox;
      throw error;
    }
  }

  eventTypes(): string[] {
    return this.outbox.map((e) => e.eventType);
  }
}
