import { randomUUID } from 'node:crypto';
import { MikroORM } from '@mikro-orm/postgresql';
import { buildMikroOrmConfig } from '../../src/config/mikro-orm';
import { MikroOrmUnitOfWork } from '../../src/infrastructure/database/mikro-orm-unit-of-work';
import { RetryingUnitOfWork } from '../../src/infrastructure/database/retrying-unit-of-work';
import { UuidGenerator } from '../../src/infrastructure/time/uuid-generator';
import { SystemClock } from '../../src/infrastructure/time/system-clock';
import {
  DEFAULT_REPROCESS_CONFIG,
  ProcessWagerTransaction,
  ReprocessPendingReferences,
} from '../../src/application/wagering';
import type { ProcessWagerTransactionCommand, ReprocessConfig } from '../../src/application/wagering';
import { WagerTransactionKind } from '../../src/domain/wagering';
import { WagerMessageHandler } from '../../src/interface/messaging/wager-message.handler';
import { MetricsService } from '../../src/infrastructure/observability/metrics.service';

export async function initOrm(): Promise<MikroORM> {
  const orm = await MikroORM.init(buildMikroOrmConfig());
  await orm.migrator.up();
  return orm;
}

export function buildUseCase(orm: MikroORM): ProcessWagerTransaction {
  const ids = new UuidGenerator();
  const uow = new RetryingUnitOfWork(new MikroOrmUnitOfWork(orm, ids));
  return new ProcessWagerTransaction(uow, new SystemClock(), ids, 'int-test');
}

export function buildMessageHandler(orm: MikroORM): WagerMessageHandler {
  return new WagerMessageHandler(buildUseCase(orm), new MetricsService(orm));
}

export function buildReprocessor(
  orm: MikroORM,
  config?: Partial<ReprocessConfig>,
): ReprocessPendingReferences {
  const ids = new UuidGenerator();
  const uow = new RetryingUnitOfWork(new MikroOrmUnitOfWork(orm, ids));
  return new ReprocessPendingReferences(uow, new SystemClock(), ids, {
    ...DEFAULT_REPROCESS_CONFIG,
    ...config,
  });
}

export async function truncateAll(orm: MikroORM): Promise<void> {
  await orm.em
    .getConnection()
    .execute(
      'truncate wallet, wager_transaction, wallet_ledger_entry, inbox_message, outbox_message cascade',
    );
}

/** Cria uma wallet e devolve o id (uuid) gerado. */
export async function seedWallet(orm: MikroORM, balance = '100.00'): Promise<string> {
  const id = randomUUID();
  await orm.em.getConnection().execute(
    `insert into wallet (id, player_id, currency, balance_amount, version, created_at, updated_at)
     values (?, ?, 'BRL', ?, 1, now(), now())`,
    [id, randomUUID(), balance],
  );
  return id;
}

export async function walletBalance(orm: MikroORM, id: string): Promise<string> {
  const rows = (await orm.em
    .getConnection()
    .execute(`select balance_amount from wallet where id = ?`, [id])) as Array<{
    balance_amount: string;
  }>;
  return rows[0]!.balance_amount;
}

export async function countRows(orm: MikroORM, sql: string, params: unknown[] = []): Promise<number> {
  const rows = (await orm.em.getConnection().execute(sql, params)) as Array<{ count: string }>;
  return Number(rows[0]!.count);
}

export async function assertLedgerConsistent(
  orm: MikroORM,
  walletId: string,
  seedBalance = '100.00',
): Promise<void> {
  const rows = (await orm.em.getConnection().execute(
    `select (w.balance_amount = ?::numeric + coalesce(sum(
        case when l.direction='CREDIT' then l.money_amount else -l.money_amount end), 0)) as ok
     from wallet w left join wallet_ledger_entry l on l.wallet_id = w.id
     where w.id = ? group by w.balance_amount`,
    [seedBalance, walletId],
  )) as Array<{ ok: boolean }>;
  if (rows[0]?.ok !== true) {
    throw new Error(`Invariante violada: wallet.balance != seed + ledger (wallet ${walletId})`);
  }
}

export function betCommand(
  over: Partial<ProcessWagerTransactionCommand> = {},
): ProcessWagerTransactionCommand {
  const ext = over.externalTransactionId ?? randomUUID();
  return {
    source: 'http',
    idempotencyKey: over.idempotencyKey ?? `provider-a:${ext}`,
    providerId: 'provider-a',
    externalTransactionId: ext,
    playerId: 'player-1',
    walletId: over.walletId ?? 'MISSING',
    roundId: 'round-1',
    gameId: 'game-1',
    kind: WagerTransactionKind.Bet,
    money: { amount: '80.00', currency: 'BRL' },
    ...over,
  };
}
