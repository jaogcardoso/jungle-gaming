/** Integração — idempotência persistente contra PostgreSQL real (Etapa 7). */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import type { MikroORM } from '@mikro-orm/postgresql';
import { IdempotencyConflictError } from '../../src/application/wagering';
import { RetriesExhaustedError } from '../../src/infrastructure/database/retrying-unit-of-work';
import { betCommand, buildUseCase, countRows, initOrm, seedWallet, truncateAll, walletBalance } from './helpers';

let orm: MikroORM;

beforeAll(async () => {
  orm = await initOrm();
});
afterAll(async () => {
  await orm.close(true);
});
beforeEach(() => truncateAll(orm));

describe('replay', () => {
  it('reenvio idêntico devolve o resultado ORIGINAL e não reaplica', async () => {
    const walletId = await seedWallet(orm, '100.00');
    const uc = buildUseCase(orm);
    const cmd = betCommand({ walletId, idempotencyKey: 'k:1', externalTransactionId: 'e1' });

    const first = await uc.execute(cmd);
    const second = await uc.execute(cmd);
    const third = await uc.execute(cmd);

    expect(first.idempotentReplay).toBe(false);
    expect(second.idempotentReplay).toBe(true);
    expect(third.idempotentReplay).toBe(true);
    expect(second.transactionId).toBe(first.transactionId);
    expect(second.balance).toEqual({ amount: '20.00', currency: 'BRL' });

    expect(await walletBalance(orm, walletId)).toBe('20.00');
    expect(await countRows(orm, 'select count(*) from wallet_ledger_entry', [])).toBe(1);
  });
});

describe('conflito', () => {
  it('mesma Idempotency-Key + payload diferente → erro, nada muda', async () => {
    const walletId = await seedWallet(orm, '100.00');
    const uc = buildUseCase(orm);

    await uc.execute(betCommand({ walletId, idempotencyKey: 'k:1', money: { amount: '80.00', currency: 'BRL' } }));

    let raised: unknown;
    try {
      await uc.execute(
        betCommand({ walletId, idempotencyKey: 'k:1', money: { amount: '90.00', currency: 'BRL' } }),
      );
    } catch (error) {
      raised = error;
    }
    expect(
      raised instanceof IdempotencyConflictError ||
        (raised instanceof RetriesExhaustedError && raised.cause instanceof IdempotencyConflictError),
    ).toBe(true);

    expect(await walletBalance(orm, walletId)).toBe('20.00');
    expect(await countRows(orm, 'select count(*) from wager_transaction', [])).toBe(1);
  });
});

describe('atomicidade (README §13 integração)', () => {
  it('wallet + ledger + transação + outbox commitam juntos', async () => {
    const walletId = await seedWallet(orm, '100.00');
    const uc = buildUseCase(orm);

    await uc.execute(betCommand({ walletId, idempotencyKey: 'k:1' }));

    expect(await countRows(orm, 'select count(*) from wager_transaction', [])).toBe(1);
    expect(await countRows(orm, 'select count(*) from wallet_ledger_entry', [])).toBe(1);
    expect(await countRows(orm, "select count(*) from outbox_message where event_type = 'WagerTransactionProcessed'", [])).toBe(1);
    expect(await countRows(orm, "select count(*) from outbox_message where event_type = 'WalletBalanceChanged'", [])).toBe(1);
    const rows = (await orm.em.getConnection().execute(
      `select (w.balance_amount = 100 + coalesce(sum(case when l.direction='CREDIT' then l.money_amount else -l.money_amount end),0)) as ok
       from wallet w left join wallet_ledger_entry l on l.wallet_id = w.id
       where w.id = ? group by w.balance_amount`,
      [walletId],
    )) as Array<{ ok: boolean }>;
    expect(rows[0]!.ok).toBe(true);
  });
});
