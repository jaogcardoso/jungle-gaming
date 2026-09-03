/** e2e — /metrics e o comportamento de divergência da reconciliação (Etapa 12). */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import type { MikroORM } from '@mikro-orm/postgresql';
import { AppModule } from '../../src/app.module';
import { DomainExceptionFilter } from '../../src/interface/http/shared/domain-exception.filter';
import { initOrm, truncateAll } from './helpers';

let app: INestApplication;
let baseUrl: string;
let orm: MikroORM;

beforeAll(async () => {
  orm = await initOrm();
  app = await NestFactory.create(AppModule, { logger: false });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalFilters(new DomainExceptionFilter());
  await app.listen(0);
  baseUrl = (await app.getUrl()).replace('[::1]', '127.0.0.1');
});
afterAll(async () => {
  await app.close();
  await orm.close(true);
});
beforeEach(() => truncateAll(orm));

describe('GET /metrics', () => {
  it('expõe as métricas exigidas pela seção 12', async () => {
    const w = await (
      await fetch(`${baseUrl}/wallets`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ playerId: 'p1', initialBalance: { amount: '100.00', currency: 'BRL' } }),
      })
    ).json();
    await fetch(`${baseUrl}/wagering/transactions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': 'k1' },
      body: JSON.stringify({
        providerId: 'pv', externalTransactionId: 'e1', playerId: 'p1',
        walletId: (w as { id: string }).id, roundId: 'r1', gameId: 'g1',
        kind: 'BET', money: { amount: '10.00', currency: 'BRL' },
      }),
    });

    const res = await fetch(`${baseUrl}/metrics`);
    expect(res.status).toBe(200);
    const body = await res.text();
    for (const name of [
      'wager_transactions_total',
      'wager_transaction_duration_seconds',
      'wager_idempotent_replays_total',
      'wager_concurrency_retries_total',
      'wager_sqs_messages_total',
      'wager_dlq_messages_total',
      'wager_reconciliation_mismatch_total',
      'wager_outbox_lag_seconds',
      'wager_outbox_pending',
    ]) {
      expect(body).toContain(name);
    }
    expect(body).toMatch(/wager_transactions_total\{[^}]*status="PROCESSED"[^}]*\} 1/);
  });
});

describe('POST /wallets/:id/reconciliation com divergência forçada', () => {
  it('não corrige em silêncio: consistent=false + métrica', async () => {
    const w = await (
      await fetch(`${baseUrl}/wallets`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ playerId: 'p1', initialBalance: { amount: '100.00', currency: 'BRL' } }),
      })
    ).json();
    const walletId = (w as { id: string }).id;

    await orm.em.getConnection().execute('update wallet set balance_amount = ? where id = ?', ['999.00', walletId]);

    const res = await fetch(`${baseUrl}/wallets/${walletId}/reconciliation`, { method: 'POST' });
    const body = (await res.json()) as Record<string, unknown>;
    expect(body['consistent']).toBe(false);
    expect(body['difference']).not.toEqual({ amount: '0.00', currency: 'BRL' });

    const metrics = await (await fetch(`${baseUrl}/metrics`)).text();
    expect(metrics).toMatch(/wager_reconciliation_mismatch_total(\{[^}]*\})? [1-9]/);
  });
});
