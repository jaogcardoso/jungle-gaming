import type { MikroORM } from '@mikro-orm/postgresql';
import type { IdGenerator, TransactionContext, UnitOfWork } from '../../application/ports';
import {
  MikroOrmInboxRepository,
  MikroOrmLedgerRepository,
  MikroOrmOutboxRepository,
  MikroOrmWagerTransactionRepository,
  MikroOrmWalletRepository,
} from './repositories';

export class MikroOrmUnitOfWork implements UnitOfWork {
  constructor(
    private readonly orm: MikroORM,
    private readonly ids: IdGenerator,
  ) {}

  async run<T>(work: (ctx: TransactionContext) => Promise<T>): Promise<T> {
    const em = this.orm.em.fork();
    return em.transactional(async (tx) => {
      const ctx: TransactionContext = {
        wallets: new MikroOrmWalletRepository(tx),
        transactions: new MikroOrmWagerTransactionRepository(tx),
        ledger: new MikroOrmLedgerRepository(tx),
        inbox: new MikroOrmInboxRepository(tx),
        outbox: new MikroOrmOutboxRepository(tx, () => this.ids.next()),
      };
      return work(ctx);
    });
  }
}
