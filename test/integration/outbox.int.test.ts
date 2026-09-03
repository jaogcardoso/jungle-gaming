/** Integração — Transactional Outbox + worker publisher (PostgreSQL + LocalStack). */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import type { MikroORM } from '@mikro-orm/postgresql';
import {
  DeleteMessageBatchCommand,
  ReceiveMessageCommand,
  type SQSClient,
} from '@aws-sdk/client-sqs';
import { createSqsClient } from '../../src/infrastructure/messaging/sqs.client';
import { OutboxPublisher } from '../../src/infrastructure/outbox/outbox-publisher';
import { SystemClock } from '../../src/infrastructure/time/system-clock';
import { env } from '../../src/config/env';
import {
  betCommand,
  buildUseCase,
  countRows,
  initOrm,
  seedWallet,
  truncateAll,
} from './helpers';

let orm: MikroORM;
let sqs: SQSClient;

const publisher = (queueUrl = env.sqs.wagerEventsUrl): OutboxPublisher =>
  new OutboxPublisher(orm, sqs, queueUrl, new SystemClock());

/** Recebe E deleta tudo da fila de eventos (PurgeQueue tem limite de 60s). */
async function drainEventsQueue(): Promise<number> {
  let total = 0;
  for (let i = 0; i < 20; i += 1) {
    const r = await sqs.send(
      new ReceiveMessageCommand({
        QueueUrl: env.sqs.wagerEventsUrl,
        MaxNumberOfMessages: 10,
        WaitTimeSeconds: 1,
      }),
    );
    const msgs = r.Messages ?? [];
    if (msgs.length === 0) break;
    total += msgs.length;
    await sqs.send(
      new DeleteMessageBatchCommand({
        QueueUrl: env.sqs.wagerEventsUrl,
        Entries: msgs.map((m, idx) => ({ Id: String(idx), ReceiptHandle: m.ReceiptHandle! })),
      }),
    );
  }
  return total;
}

beforeAll(async () => {
  orm = await initOrm();
  sqs = createSqsClient();
});
afterAll(async () => {
  await orm.close(true);
  sqs.destroy();
});
beforeEach(async () => {
  await truncateAll(orm);
  await drainEventsQueue();
});

describe('OutboxPublisher', () => {
  it('publica os pendentes e marca published_at', async () => {
    const walletId = await seedWallet(orm, '100.00');
    await buildUseCase(orm).execute(betCommand({ walletId, idempotencyKey: 'k1' }));
    expect(await countRows(orm, 'select count(*) from outbox_message where published_at is null', [])).toBe(2);

    const n = await publisher().publishBatch();
    expect(n).toBe(2);

    expect(await countRows(orm, 'select count(*) from outbox_message where published_at is null', [])).toBe(0);
    expect(await drainEventsQueue()).toBe(2);
  });

  it('dois publishers concorrentes: total publicado = total de eventos, sem duplicar (SKIP LOCKED)', async () => {
    const walletId = await seedWallet(orm, '1000.00');
    for (let i = 0; i < 5; i += 1) {
      await buildUseCase(orm).execute(
        betCommand({ walletId, idempotencyKey: `k${i}`, money: { amount: '10.00', currency: 'BRL' } }),
      );
    }
    expect(await countRows(orm, 'select count(*) from outbox_message', [])).toBe(10);

    const [a, b] = await Promise.all([
      publisher().publishBatch(5),
      publisher().publishBatch(5),
    ]);
    expect(a + b).toBe(10);

    expect(await countRows(orm, 'select count(*) from outbox_message where published_at is null', [])).toBe(0);
    expect(await drainEventsQueue()).toBe(10);
  });

  it('falha na publicação: incrementa attempts e agenda retry (não marca published)', async () => {
    const walletId = await seedWallet(orm, '100.00');
    await buildUseCase(orm).execute(betCommand({ walletId, idempotencyKey: 'k1' }));

    const bad = publisher('http://localhost:4566/000000000000/fila-que-nao-existe.fifo');
    await bad.publishBatch();

    expect(await countRows(orm, 'select count(*) from outbox_message where published_at is null', [])).toBe(2);
    expect(await countRows(orm, 'select count(*) from outbox_message where attempts >= 1', [])).toBe(2);
    expect(
      await countRows(orm, 'select count(*) from outbox_message where next_attempt_at is not null', []),
    ).toBe(2);

    await new Promise((r) => setTimeout(r, 1200));
    const n = await publisher().publishBatch();
    expect(n).toBe(2);
    expect(await countRows(orm, 'select count(*) from outbox_message where published_at is null', [])).toBe(0);
  });
});
