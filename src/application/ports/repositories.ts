import type { Wallet, WalletLedgerEntry } from '../../domain/wallet';
import type { WagerTransaction } from '../../domain/wagering';

/** Ports de persistência. */

export class WalletAlreadyExistsError extends Error {
  constructor(playerId: string, currency: string) {
    super(`Já existe wallet para player ${playerId} na moeda ${currency}`);
    this.name = 'WalletAlreadyExistsError';
  }
}

export interface WalletRepository {
  /** Carrega a wallet para escrita, com controle de concorrência. */
  loadForUpdate(walletId: string): Promise<Wallet | null>;

  /** Insere uma wallet nova. Lança `WalletAlreadyExistsError` se (player, moeda) já existe. */
  insert(wallet: Wallet): Promise<void>;

  /** Persiste saldo/versão novos. Deve falhar se a versão mudou no meio (Etapa 6). */
  save(wallet: Wallet): Promise<void>;
}

export interface WagerTransactionRepository {
  findByIdempotencyKey(idempotencyKey: string): Promise<WagerTransaction | null>;

  /** Resolve a referência de um REFUND/ROLLBACK (README 7.2). */
  findByProviderAndExternalId(
    providerId: string,
    externalTransactionId: string,
  ): Promise<WagerTransaction | null>;

  insert(transaction: WagerTransaction): Promise<void>;

  /** Persiste mudança de estado (PROCESSED/REJECTED) de uma transação já existente. */
  update(transaction: WagerTransaction): Promise<void>;

  /** README 7.4: já existe uma reversão PROCESSED do mesmo `kind` para esta referência? */
  findProcessedReversal(referenceTransactionId: string, kind: string): Promise<boolean>;

  /** Transações `PENDING_REFERENCE` prontas para nova tentativa (Etapa 11). */
  findDuePendingReferences(
    now: Date,
    limit: number,
  ): Promise<Array<{ transaction: WagerTransaction; attempts: number }>>;

  /** Agenda a próxima tentativa de resolução da referência (backoff). */
  bumpReferenceRetry(transactionId: string, attempts: number, nextAttemptAt: Date): Promise<void>;
}

import type { Money } from '../../domain/money';

export interface LedgerRepository {
  insert(entry: WalletLedgerEntry): Promise<void>;

  /** Soma CREDIT − DEBIT de todos os lançamentos da wallet, e conta quantos. */
  sumForWallet(walletId: string): Promise<{ total: Money | null; count: number }>;
}

export interface RegisterInboxInput {
  consumerName: string;
  messageId: string;
  payloadHash: string;
  receivedAt: Date;
}

export interface InboxRepository {
  /** `true` se registrou agora; `false` se `(consumerName, messageId)` já existia. */
  register(input: RegisterInboxInput): Promise<boolean>;
}

export interface OutboxEventInput {
  aggregateId: string;
  eventType: string;
  payload: Record<string, unknown>;
  occurredAt: Date;
}

export interface OutboxRepository {
  /** Grava eventos pendentes — na MESMA transação SQL do efeito (restrição nº 4). */
  enqueue(events: OutboxEventInput[]): Promise<void>;
}
