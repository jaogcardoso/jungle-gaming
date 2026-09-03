/** Integração — REFUND/ROLLBACK: regra 7.4 (não reverter 2x pelo mesmo tipo), inclusive sob concorrência. */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import type { MikroORM } from '@mikro-orm/postgresql';
import { FailureCode, WagerTransactionStatus } from '../../src/domain/wagering';
import {
  betCommand,
  buildUseCase,
  countRows,
  initOrm,
  seedWallet,
  truncateAll,
  walletBalance,
} from './helpers';

let orm: MikroORM;

beforeAll(async () => {
  orm = await initOrm();
});
afterAll(async () => {
  await orm.close(true);
});
beforeEach(() => truncateAll(orm));

const rollbackOf = (walletId: string, ext: string, key: string) =>
  betCommand({
    walletId,
    idempotencyKey: key,
    externalTransactionId: ext,
    kind: 'ROLLBACK' as never,
    money: { amount: '80.00', currency: 'BRL' },
    referenceExternalTransactionId: 'bet-1',
  });

async function setup(): Promise<string> {
  const walletId = await seedWallet(orm, '100.00');
  await buildUseCase(orm).execute(
    betCommand({ walletId, idempotencyKey: 'k:bet', externalTransactionId: 'bet-1' }),
  );
  return walletId;
}

describe('README 7.4 — não reverter 2x pelo mesmo tipo', () => {
  it('sequencial: 2º ROLLBACK → REJECTED ALREADY_REVERSED, credita 1x só', async () => {
    const walletId = await setup();
    const uc = buildUseCase(orm);

    const rb1 = await uc.execute(rollbackOf(walletId, 'rb-1', 'k:rb1'));
    const rb2 = await uc.execute(rollbackOf(walletId, 'rb-2', 'k:rb2'));

    expect(rb1.status).toBe(WagerTransactionStatus.Processed);
    expect(rb2.status).toBe(WagerTransactionStatus.Rejected);
    expect(rb2.failureCode).toBe(FailureCode.AlreadyReversed);
    expect(await walletBalance(orm, walletId)).toBe('100.00');
    expect(await countRows(orm, "select count(*) from wallet_ledger_entry where direction='CREDIT'", [])).toBe(1);
  });

  it('concorrente: 5 ROLLBACKs em paralelo → 1 PROCESSED, 4 REJECTED, credita 1x', async () => {
    const walletId = await setup();
    const uc = buildUseCase(orm);

    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) => uc.execute(rollbackOf(walletId, `rb-${i}`, `k:rb${i}`))),
    );

    expect(results.filter((r) => r.status === WagerTransactionStatus.Processed)).toHaveLength(1);
    const rejected = results.filter((r) => r.status === WagerTransactionStatus.Rejected);
    expect(rejected).toHaveLength(4);
    expect(rejected.every((r) => r.failureCode === FailureCode.AlreadyReversed)).toBe(true);
    expect(await walletBalance(orm, walletId)).toBe('100.00');
  });

  it('REFUND e ROLLBACK são tipos diferentes: ambos podem reverter a mesma BET', async () => {
    const walletId = await setup();
    const uc = buildUseCase(orm);

    const refund = await uc.execute(
      betCommand({
        walletId, idempotencyKey: 'k:refund', externalTransactionId: 'refund-1',
        kind: 'REFUND' as never, money: { amount: '80.00', currency: 'BRL' },
        referenceExternalTransactionId: 'bet-1',
      }),
    );
    expect(refund.status).toBe(WagerTransactionStatus.Processed);

    const rollback = await uc.execute(rollbackOf(walletId, 'rb-1', 'k:rb1'));
    expect(rollback.status).toBe(WagerTransactionStatus.Processed);
    expect(await walletBalance(orm, walletId)).toBe('180.00');
  });
});
