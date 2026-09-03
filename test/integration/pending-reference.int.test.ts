/** Integração — reprocessamento de PENDING_REFERENCE (Etapa 11 / README 7.1). */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import type { MikroORM } from '@mikro-orm/postgresql';
import { WagerTransactionStatus } from '../../src/domain/wagering';
import {
  betCommand,
  buildReprocessor,
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

const txStatus = async (id: string): Promise<string> => {
  const rows = (await orm.em.getConnection().execute(
    'select status from wager_transaction where external_transaction_id = ?',
    [id],
  )) as Array<{ status: string }>;
  return rows[0]!.status;
};

describe('ROLLBACK antes da BET referenciada', () => {
  it('fica PENDING_REFERENCE e é aplicado quando a BET chega', async () => {
    const walletId = await seedWallet(orm, '100.00');
    const uc = buildUseCase(orm);

    const rb = await uc.execute(
      betCommand({
        walletId,
        idempotencyKey: 'k:rb',
        externalTransactionId: 'rb-1',
        kind: 'ROLLBACK' as never,
        money: { amount: '80.00', currency: 'BRL' },
        referenceExternalTransactionId: 'bet-1',
      }),
    );
    expect(rb.status).toBe(WagerTransactionStatus.PendingReference);
    expect(await walletBalance(orm, walletId)).toBe('100.00');

    await uc.execute(betCommand({ walletId, idempotencyKey: 'k:bet', externalTransactionId: 'bet-1' }));
    expect(await walletBalance(orm, walletId)).toBe('20.00');

    const touched = await buildReprocessor(orm, { backoffBaseMs: 0 }).runOnce();
    expect(touched).toBe(1);
    expect(await txStatus('rb-1')).toBe('PROCESSED');
    expect(await walletBalance(orm, walletId)).toBe('100.00');
    expect(await countRows(orm, 'select count(*) from wallet_ledger_entry', [])).toBe(2);
  });
});

describe('referência que nunca chega', () => {
  it('após esgotar o limite → REJECTED com REFERENCE_NOT_FOUND + evento', async () => {
    const walletId = await seedWallet(orm, '100.00');
    await buildUseCase(orm).execute(
      betCommand({
        walletId,
        idempotencyKey: 'k:rb',
        externalTransactionId: 'rb-1',
        kind: 'ROLLBACK' as never,
        money: { amount: '80.00', currency: 'BRL' },
        referenceExternalTransactionId: 'nunca-existe',
      }),
    );

    const reprocessor = buildReprocessor(orm, { maxAttempts: 3, backoffBaseMs: 0 });
    await reprocessor.runOnce();
    await reprocessor.runOnce();
    expect(await txStatus('rb-1')).toBe('PENDING_REFERENCE');
    await reprocessor.runOnce();

    expect(await txStatus('rb-1')).toBe('REJECTED');
    const rows = (await orm.em.getConnection().execute(
      "select failure_code from wager_transaction where external_transaction_id = 'rb-1'",
    )) as Array<{ failure_code: string }>;
    expect(rows[0]!.failure_code).toBe('REFERENCE_NOT_FOUND');
    expect(await walletBalance(orm, walletId)).toBe('100.00'); 
    expect(
      await countRows(
        orm,
        "select count(*) from outbox_message where event_type = 'WagerTransactionRejected'",
        [],
      ),
    ).toBe(1);
  });
});
