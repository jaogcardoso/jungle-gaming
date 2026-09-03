/** Integração — consumidor SQS + inbox, contra PostgreSQL + LocalStack reais. */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import type { MikroORM } from '@mikro-orm/postgresql';
import {
  DeleteMessageCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
  type SQSClient,
} from '@aws-sdk/client-sqs';
import { createSqsClient } from '../../src/infrastructure/messaging/sqs.client';
import { SqsWagerConsumer } from '../../src/interface/messaging/sqs-wager-consumer';
import { env } from '../../src/config/env';
import { buildMessageHandler, countRows, initOrm, seedWallet, truncateAll, walletBalance } from './helpers';

let orm: MikroORM;
let sqs: SQSClient;

const message = (over: Record<string, unknown> = {}, dataOver: Record<string, unknown> = {}) =>
  JSON.stringify({
    messageId: 'msg-1',
    type: 'WagerTransactionRequested',
    occurredAt: new Date().toISOString(),
    data: {
      providerId: 'provider-a',
      externalTransactionId: 'ext-1',
      idempotencyKey: 'provider-a:ext-1',
      playerId: 'player-1',
      roundId: 'round-1',
      gameId: 'game-1',
      kind: 'BET',
      money: { amount: '80.00', currency: 'BRL' },
      ...dataOver,
    },
    ...over,
  });

beforeAll(async () => {
  orm = await initOrm();
  sqs = createSqsClient();
});
afterAll(async () => {
  await orm.close(true);
  sqs.destroy();
});
beforeEach(() => truncateAll(orm));

describe('WagerMessageHandler', () => {
  it('mensagem válida → ack + wallet debitada', async () => {
    const walletId = await seedWallet(orm, '100.00');
    const handler = buildMessageHandler(orm);

    const { disposition } = await handler.handle(message({}, { walletId }));

    expect(disposition).toBe('ack');
    expect(await walletBalance(orm, walletId)).toBe('20.00');
  });

  it('mensagem malformada → dlq', async () => {
    const handler = buildMessageHandler(orm);
    expect((await handler.handle('{ not json')).disposition).toBe('dlq');
    expect((await handler.handle(JSON.stringify({ messageId: 'x' }))).disposition).toBe('dlq');
    expect((await handler.handle(message({}, { kind: 'OPENING' }))).disposition).toBe('dlq');
  });

  it('redelivery: mesmo messageId 2x → ack 2x, mas UM único efeito (inbox)', async () => {
    const walletId = await seedWallet(orm, '100.00');
    const handler = buildMessageHandler(orm);
    const raw = message({ messageId: 'dup-1' }, { walletId });

    const a = await handler.handle(raw);
    const b = await handler.handle(raw);

    expect(a.disposition).toBe('ack');
    expect(b.disposition).toBe('ack');
    expect(await walletBalance(orm, walletId)).toBe('20.00'); 
    expect(await countRows(orm, 'select count(*) from wallet_ledger_entry', [])).toBe(1);
    expect(await countRows(orm, 'select count(*) from inbox_message', [])).toBe(1);
  });
});

describe('SqsWagerConsumer.pollOnce (round-trip LocalStack)', () => {
  /** Esvazia a fila principal (receber + deletar) — evita straggler de outro teste/run. */
  async function drainMainQueue(): Promise<void> {
    for (let i = 0; i < 15; i += 1) {
      const r = await sqs.send(
        new ReceiveMessageCommand({
          QueueUrl: env.sqs.wagerQueueUrl,
          MaxNumberOfMessages: 10,
          WaitTimeSeconds: 1,
        }),
      );
      const msgs = r.Messages ?? [];
      if (msgs.length === 0) break;
      for (const m of msgs) {
        await sqs.send(
          new DeleteMessageCommand({ QueueUrl: env.sqs.wagerQueueUrl, ReceiptHandle: m.ReceiptHandle! }),
        );
      }
    }
  }

  it('recebe da fila, processa e deleta a mensagem', async () => {
    await drainMainQueue();
    const walletId = await seedWallet(orm, '100.00');
    const stamp = Date.now();

    await sqs.send(
      new SendMessageCommand({
        QueueUrl: env.sqs.wagerQueueUrl,
        MessageBody: message(
          { messageId: `rt-${stamp}` },
          { walletId, idempotencyKey: `k-${stamp}`, externalTransactionId: `e-${stamp}` },
        ),
        MessageGroupId: `rt-${stamp}`,
        MessageDeduplicationId: `d-${stamp}`,
      }),
    );

    const consumer = new SqsWagerConsumer(sqs, buildMessageHandler(orm));
    let processed = 0;
    for (let i = 0; i < 8 && processed === 0; i += 1) {
      processed += await consumer.pollOnce(2);
    }
    expect(processed).toBeGreaterThanOrEqual(1);
    expect(await walletBalance(orm, walletId)).toBe('20.00');

    const again = await sqs.send(
      new ReceiveMessageCommand({
        QueueUrl: env.sqs.wagerQueueUrl,
        WaitTimeSeconds: 1,
        MaxNumberOfMessages: 1,
      }),
    );
    expect(again.Messages ?? []).toHaveLength(0);
  });
});
