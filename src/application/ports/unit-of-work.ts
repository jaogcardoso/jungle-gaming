import type {
  InboxRepository,
  LedgerRepository,
  OutboxRepository,
  WagerTransactionRepository,
  WalletRepository,
} from './repositories';

/** Todos os repositórios ligados à MESMA transação SQL. */
export interface TransactionContext {
  wallets: WalletRepository;
  transactions: WagerTransactionRepository;
  ledger: LedgerRepository;
  inbox: InboxRepository;
  outbox: OutboxRepository;
}

export interface UnitOfWork {
  /** Roda `work` dentro de uma transação: commit se resolver, rollback se lançar. */
  run<T>(work: (ctx: TransactionContext) => Promise<T>): Promise<T>;
}

export const UNIT_OF_WORK = Symbol('UNIT_OF_WORK');
