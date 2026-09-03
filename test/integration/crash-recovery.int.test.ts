/** Integração — recuperação após falha (README §13.5, §13.8). */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { MikroORM } from '@mikro-orm/postgresql';
import { buildMikroOrmConfig } from '../../src/config/mikro-orm';
import { OutboxPublisher } from '../../src/infrastructure/outbox/outbox-publisher';
import { SystemClock } from '../../src/infrastructure/time/system-clock';
import { createSqsClient } from '../../src/infrastructure/messaging/sqs.client';
import { env } from '../../src/config/env';
import {
  betCommand,
  buildMessageHandler,
  buildUseCase,
  countRows,
  initOrm,
  seedWallet,
  truncateAll,
  walletBalance,
} from './helpers';

let orm: MikroORM;

const message = (walletId: string) =>
  JSON.stringify({
    messageId: 'crash-msg-1',
    type: 'WagerTransactionRequested',
    occurredAt: new Date().toISOString(),
    data: {
      providerId: 'pv', externalTransactionId: 'e1', idempotencyKey: 'pv:e1',
      playerId: 'p1', walletId, roundId: 'r1', gameId: 'g1',
      kind: 'BET', money: { amount: '80.00', currency: 'BRL' },
    },
  });

beforeAll(async () => {
  orm = await initOrm();
});
afterAll(async () => {
  await orm.close(true);
});
beforeEach(() => truncateAll(orm));

describe('worker morto DEPOIS do commit e ANTES do ack', () => {
  it('redelivery reprocessa sem duplicar o efeito (inbox)', async () => {
    const walletId = await seedWallet(orm, '100.00');
    const handler = buildMessageHandler(orm);

    const first = await handler.handle(message(walletId));
    expect(first.disposition).toBe('ack');
    expect(await walletBalance(orm, walletId)).toBe('20.00');

    const second = await handler.handle(message(walletId));
    expect(second.disposition).toBe('ack');

    expect(await walletBalance(orm, walletId)).toBe('20.00');
    expect(await countRows(orm, 'select count(*) from wallet_ledger_entry', [])).toBe(1);
    expect(await countRows(orm, 'select count(*) from wager_transaction', [])).toBe(1);
    expect(await countRows(orm, 'select count(*) from inbox_message', [])).toBe(1);
    expect(await countRows(orm, 'select count(*) from outbox_message where published_at is null', [])).toBe(2);
  });
});

describe('processo morre DEPOIS do commit e ANTES de publicar o outbox', () => {
  it('outra instância publica; nada se perde', async () => {
    const walletId = await seedWallet(orm, '100.00');
    await buildUseCase(orm).execute(betCommand({ walletId, idempotencyKey: 'k1' }));
    expect(await countRows(orm, 'select count(*) from outbox_message where published_at is null', [])).toBe(2);

    const sqs = createSqsClient();
    try {
      const n = await new OutboxPublisher(orm, sqs, env.sqs.wagerEventsUrl, new SystemClock()).publishBatch();
      expect(n).toBe(2);
      expect(await countRows(orm, 'select count(*) from outbox_message where published_at is null', [])).toBe(0);
    } finally {
      sqs.destroy();
    }
  });
});

describe('reinício do serviço', () => {
  it('a consistência final se mantém: wallet.balance == reconstrução pelo ledger', async () => {
    const walletId = await seedWallet(orm, '100.00');
    for (let i = 0; i < 3; i += 1) {
      await buildUseCase(orm).execute(
        betCommand({ walletId, idempotencyKey: `k${i}`, money: { amount: '10.00', currency: 'BRL' } }),
      );
    }

    await orm.close(true);
    orm = await MikroORM.init(buildMikroOrmConfig());

    const rows = (await orm.em.getConnection().execute(
      `select (w.balance_amount = 100 + coalesce(sum(
          case when l.direction='CREDIT' then l.money_amount else -l.money_amount end), 0)) as ok
       from wallet w left join wallet_ledger_entry l on l.wallet_id = w.id
       where w.id = ? group by w.balance_amount`,
      [walletId],
    )) as Array<{ ok: boolean }>;
    expect(rows[0]!.ok).toBe(true);
    expect(await walletBalance(orm, walletId)).toBe('70.00');
  });
});
