/** e2e HTTP — sobe o AppModule inteiro contra PostgreSQL real e bate nos endpoints via fetch. */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { AppModule } from '../../src/app.module';
import { DomainExceptionFilter } from '../../src/interface/http/shared/domain-exception.filter';
import { initOrm, truncateAll } from './helpers';
import type { MikroORM } from '@mikro-orm/postgresql';

let app: INestApplication;
let baseUrl: string;
let orm: MikroORM;

const json = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
  fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

beforeAll(async () => {
  orm = await initOrm();
  app = await NestFactory.create(AppModule, { logger: false });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalFilters(new DomainExceptionFilter());
  await app.listen(0);
  const url = await app.getUrl();
  baseUrl = url.replace('[::1]', '127.0.0.1');
});

afterAll(async () => {
  await app.close();
  await orm.close(true);
});

beforeEach(() => truncateAll(orm));

async function createWallet(playerId: string, amount = '1000.00'): Promise<string> {
  const res = await json('POST', '/wallets', { playerId, initialBalance: { amount, currency: 'BRL' } });
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

describe('POST /wallets', () => {
  it('cria wallet com saldo inicial e version 1', async () => {
    const res = await json('POST', '/wallets', {
      playerId: 'p1',
      initialBalance: { amount: '1000.00', currency: 'BRL' },
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body['balance']).toEqual({ amount: '1000.00', currency: 'BRL' });
    expect(body['version']).toBe(1);
  });

  it('wallet duplicada (player + moeda) → 409', async () => {
    await createWallet('dup');
    const res = await json('POST', '/wallets', {
      playerId: 'dup',
      initialBalance: { amount: '0.00', currency: 'BRL' },
    });
    expect(res.status).toBe(409);
  });

  it('payload inválido (amount com 3 casas) → 400', async () => {
    const res = await json('POST', '/wallets', {
      playerId: 'p',
      initialBalance: { amount: '10.001', currency: 'BRL' },
    });
    expect(res.status).toBe(400);
  });
});

describe('POST /wagering/transactions', () => {
  it('sem Idempotency-Key → 400', async () => {
    const walletId = await createWallet('p1');
    const res = await json('POST', '/wagering/transactions', {
      providerId: 'pv', externalTransactionId: 'e1', playerId: 'p1', walletId,
      roundId: 'r1', gameId: 'g1', kind: 'BET', money: { amount: '80.00', currency: 'BRL' },
    });
    expect(res.status).toBe(400);
  });

  it('BET processa (200), replay (200, idempotentReplay), conflito (409)', async () => {
    const walletId = await createWallet('p1');
    const payload = {
      providerId: 'pv', externalTransactionId: 'e1', playerId: 'p1', walletId,
      roundId: 'r1', gameId: 'g1', kind: 'BET', money: { amount: '80.00', currency: 'BRL' },
    };
    const h = { 'idempotency-key': 'pv:e1' };

    const r1 = await json('POST', '/wagering/transactions', payload, h);
    expect(r1.status).toBe(200);
    const b1 = (await r1.json()) as Record<string, unknown>;
    expect(b1['status']).toBe('PROCESSED');
    expect(b1['balance']).toEqual({ amount: '920.00', currency: 'BRL' });
    expect(b1['idempotentReplay']).toBe(false);

    const r2 = await json('POST', '/wagering/transactions', payload, h);
    expect(r2.status).toBe(200);
    expect(((await r2.json()) as Record<string, unknown>)['idempotentReplay']).toBe(true);

    const r3 = await json(
      'POST',
      '/wagering/transactions',
      { ...payload, money: { amount: '90.00', currency: 'BRL' } },
      h,
    );
    expect(r3.status).toBe(409);
  });

  it('BET sem saldo → 422 REJECTED com failureCode', async () => {
    const walletId = await createWallet('p1', '50.00');
    const res = await json(
      'POST',
      '/wagering/transactions',
      {
        providerId: 'pv', externalTransactionId: 'e1', playerId: 'p1', walletId,
        roundId: 'r1', gameId: 'g1', kind: 'BET', money: { amount: '80.00', currency: 'BRL' },
      },
      { 'idempotency-key': 'pv:e1' },
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body['status']).toBe('REJECTED');
    expect(body['failureCode']).toBe('INSUFFICIENT_FUNDS');
  });

  it('ROLLBACK antes da referência → 202 PENDING_REFERENCE', async () => {
    const walletId = await createWallet('p1');
    const res = await json(
      'POST',
      '/wagering/transactions',
      {
        providerId: 'pv', externalTransactionId: 'rb1', playerId: 'p1', walletId,
        roundId: 'r1', gameId: 'g1', kind: 'ROLLBACK', money: { amount: '10.00', currency: 'BRL' },
        referenceExternalTransactionId: 'nao-existe',
      },
      { 'idempotency-key': 'pv:rb1' },
    );
    expect(res.status).toBe(202);
    expect(((await res.json()) as Record<string, unknown>)['status']).toBe('PENDING_REFERENCE');
  });
});

describe('consultas', () => {
  it('GET /wallets/:id e /ledger com cursor', async () => {
    const walletId = await createWallet('p1');
    for (let i = 0; i < 3; i += 1) {
      await json(
        'POST',
        '/wagering/transactions',
        {
          providerId: 'pv', externalTransactionId: `e${i}`, playerId: 'p1', walletId,
          roundId: 'r1', gameId: 'g1', kind: 'BET', money: { amount: '10.00', currency: 'BRL' },
        },
        { 'idempotency-key': `pv:e${i}` },
      );
    }

    const w = await (await json('GET', `/wallets/${walletId}`)).json();
    expect((w as Record<string, unknown>)['balance']).toEqual({ amount: '970.00', currency: 'BRL' });

    const p1 = (await (await json('GET', `/wallets/${walletId}/ledger?limit=2`)).json()) as {
      entries: unknown[];
      nextCursor: string | null;
    };
    expect(p1.entries.length).toBe(2);
    expect(p1.nextCursor).toBeTruthy();

    const p2 = (await (
      await json('GET', `/wallets/${walletId}/ledger?limit=2&cursor=${encodeURIComponent(p1.nextCursor!)}`)
    ).json()) as { entries: unknown[]; nextCursor: string | null };
    expect(p2.entries.length).toBe(2);
    expect(p2.nextCursor).toBeNull();
  });

  it('POST /wallets/:id/reconciliation → consistent', async () => {
    const walletId = await createWallet('p1');
    await json(
      'POST',
      '/wagering/transactions',
      {
        providerId: 'pv', externalTransactionId: 'e1', playerId: 'p1', walletId,
        roundId: 'r1', gameId: 'g1', kind: 'BET', money: { amount: '80.00', currency: 'BRL' },
      },
      { 'idempotency-key': 'pv:e1' },
    );

    const res = await json('POST', `/wallets/${walletId}/reconciliation`);
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body['consistent']).toBe(true);
    expect(body['storedBalance']).toEqual({ amount: '920.00', currency: 'BRL' });
    expect(body['checkedEntries']).toBe(2);
  });
});
