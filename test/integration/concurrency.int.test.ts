/** Integração — concorrência REAL (Promise.all, PostgreSQL real, sem mocks). */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import type { MikroORM } from '@mikro-orm/postgresql';
import { WagerTransactionStatus } from '../../src/domain/wagering';
import {
  betCommand,
  buildUseCase,
  countRows,
  initOrm,
  seedWallet,
  truncateAll,
  walletBalance,
  assertLedgerConsistent,
} from './helpers';

let orm: MikroORM;

beforeAll(async () => {
  orm = await initOrm();
});
afterAll(async () => {
  await orm.close(true);
});
beforeEach(() => truncateAll(orm));

describe('cenário obrigatório (README §8)', () => {
  it('saldo 100, duas BET de 80 simultâneas → 1 PROCESSED, 1 REJECTED, saldo 20, 1 débito', async () => {
    const walletId = await seedWallet(orm, '100.00');
    const uc = buildUseCase(orm);

    const [a, b] = await Promise.all([
      uc.execute(betCommand({ walletId, idempotencyKey: 'k:a' })),
      uc.execute(betCommand({ walletId, idempotencyKey: 'k:b' })),
    ]);

    expect([a.status, b.status].sort()).toEqual([
      WagerTransactionStatus.Processed,
      WagerTransactionStatus.Rejected,
    ]);
    expect(await walletBalance(orm, walletId)).toBe('20.00');
    expect(
      await countRows(orm, 'select count(*) from wallet_ledger_entry where wallet_id = ?', [walletId]),
    ).toBe(1);
    await assertLedgerConsistent(orm, walletId);
  });
});

describe('a mesma aposta 50x em paralelo (README §13.1)', () => {
  it('debita uma vez só — 1 transação, 1 lançamento', async () => {
    const walletId = await seedWallet(orm, '100.00');
    const uc = buildUseCase(orm);

    const results = await Promise.all(
      Array.from({ length: 50 }, () =>
        uc.execute(betCommand({ walletId, idempotencyKey: 'same-key', externalTransactionId: 'same-ext' })),
      ),
    );

    const ids = new Set(results.map((r) => r.transactionId));
    expect(ids.size).toBe(1);
    expect(results.every((r) => r.status === WagerTransactionStatus.Processed)).toBe(true);
    expect(results.filter((r) => r.idempotentReplay).length).toBe(49);

    expect(await walletBalance(orm, walletId)).toBe('20.00');
    expect(await countRows(orm, 'select count(*) from wager_transaction', [])).toBe(1);
    expect(await countRows(orm, 'select count(*) from wallet_ledger_entry', [])).toBe(1);
  });
});

describe('hot wallet — 15 apostas concorrentes, cabem 10', () => {
  it('exatamente 10 passam; saldo final 0; nunca negativo', async () => {
    const walletId = await seedWallet(orm, '100.00');
    const uc = buildUseCase(orm);

    const results = await Promise.all(
      Array.from({ length: 15 }, (_, i) =>
        uc.execute(
          betCommand({
            walletId,
            idempotencyKey: `k:${i}`,
            money: { amount: '10.00', currency: 'BRL' },
          }),
        ),
      ),
    );

    expect(results.filter((r) => r.status === WagerTransactionStatus.Processed).length).toBe(10);
    expect(results.filter((r) => r.status === WagerTransactionStatus.Rejected).length).toBe(5);
    expect(await walletBalance(orm, walletId)).toBe('0.00');
    expect(await countRows(orm, 'select count(*) from wallet_ledger_entry', [])).toBe(10);
    await assertLedgerConsistent(orm, walletId);
  });
});

describe('≥ 3 "instâncias" simultâneas na mesma wallet (README §13.4)', () => {
  it('cada uma com seu próprio UnitOfWork/conexão; total correto, sem negativo', async () => {
    const walletId = await seedWallet(orm, '100.00');
    const instances = [buildUseCase(orm), buildUseCase(orm), buildUseCase(orm), buildUseCase(orm)];

    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        instances[i % instances.length]!.execute(
          betCommand({ walletId, idempotencyKey: `k:${i}`, money: { amount: '10.00', currency: 'BRL' } }),
        ),
      ),
    );

    expect(results.filter((r) => r.status === WagerTransactionStatus.Processed).length).toBe(10);
    expect(await walletBalance(orm, walletId)).toBe('0.00');
    expect(await countRows(orm, 'select count(*) from wallet_ledger_entry', [])).toBe(10);
    await assertLedgerConsistent(orm, walletId);
  });
});

describe('wallets distintas em paralelo (README §13.3)', () => {
  it('não disputam nada entre si', async () => {
    const [w1, w2, w3] = await Promise.all([
      seedWallet(orm, '100.00'),
      seedWallet(orm, '100.00'),
      seedWallet(orm, '100.00'),
    ]);
    const uc = buildUseCase(orm);

    const results = await Promise.all([
      uc.execute(betCommand({ walletId: w1, idempotencyKey: 'k1' })),
      uc.execute(betCommand({ walletId: w2, idempotencyKey: 'k2' })),
      uc.execute(betCommand({ walletId: w3, idempotencyKey: 'k3' })),
    ]);

    expect(results.every((r) => r.status === WagerTransactionStatus.Processed)).toBe(true);
    for (const id of [w1, w2, w3]) {
      expect(await walletBalance(orm, id)).toBe('20.00');
    }
  });
});
