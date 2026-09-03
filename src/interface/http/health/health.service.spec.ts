import { describe, expect, it } from 'bun:test';
import type { MikroORM } from '@mikro-orm/core';
import type { SQSClient } from '@aws-sdk/client-sqs';
import { HealthService } from './health.service';

function ormWith(execute: () => Promise<unknown>): MikroORM {
  return {
    em: { getConnection: () => ({ execute }) },
  } as unknown as MikroORM;
}

function sqsWith(send: () => Promise<unknown>): SQSClient {
  return { send } as unknown as SQSClient;
}

describe('HealthService.checkReadiness', () => {
  it('retorna ok quando PostgreSQL e SQS respondem', async () => {
    const service = new HealthService(
      ormWith(async () => [{ ok: 1 }]),
      sqsWith(async () => ({})),
    );

    const result = await service.checkReadiness();

    expect(result).toEqual({ status: 'ok', checks: { postgres: 'up', sqs: 'up' } });
  });

  it('retorna error e marca postgres down quando o banco falha', async () => {
    const service = new HealthService(
      ormWith(async () => {
        throw new Error('connection refused');
      }),
      sqsWith(async () => ({})),
    );

    const result = await service.checkReadiness();

    expect(result.status).toBe('error');
    expect(result.checks.postgres).toBe('down');
    expect(result.checks.sqs).toBe('up');
  });

  it('retorna error e marca sqs down quando a fila falha', async () => {
    const service = new HealthService(
      ormWith(async () => [{ ok: 1 }]),
      sqsWith(async () => {
        throw new Error('queue does not exist');
      }),
    );

    const result = await service.checkReadiness();

    expect(result.status).toBe('error');
    expect(result.checks.postgres).toBe('up');
    expect(result.checks.sqs).toBe('down');
  });
});
