/** Integração — as constraints do schema (Etapa 4) contra um PostgreSQL REAL. */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { MikroORM } from '@mikro-orm/postgresql';
import { buildMikroOrmConfig } from '../../src/config/mikro-orm';

let orm: MikroORM;

const exec = (sql: string, params: unknown[] = []): Promise<unknown> =>
  orm.em.getConnection().execute(sql, params);

async function expectViolation(promise: Promise<unknown>, needle: RegExp): Promise<void> {
  try {
    await promise;
    throw new Error('esperava violação de constraint, mas o INSERT/UPDATE passou');
  } catch (error) {
    expect(String((error as Error).message)).toMatch(needle);
  }
}

const WALLET_ID = '00000000-0000-0000-0000-000000000001';
const TX_ID = '00000000-0000-0000-0000-000000000002';

async function seedWalletAndTx(): Promise<void> {
  await exec(
    `insert into wallet (id, player_id, currency, balance_amount, version, created_at, updated_at)
     values (?, 'player-1', 'BRL', '100.00', 1, now(), now())`,
    [WALLET_ID],
  );
  await exec(
    `insert into wager_transaction
       (id, provider_id, external_transaction_id, idempotency_key, payload_hash, wallet_id,
        player_id, round_id, game_id, kind, money_amount, money_currency, status, created_at)
     values (?, 'prov', 'ext-1', 'prov:ext-1', 'hash', ?,
        'player-1', 'round-1', 'game-1', 'BET', '80.00', 'BRL', 'PROCESSED', now())`,
    [TX_ID, WALLET_ID],
  );
}

beforeAll(async () => {
  orm = await MikroORM.init(buildMikroOrmConfig());
  await orm.migrator.up();
});

afterAll(async () => {
  await orm.close(true);
});

beforeEach(async () => {
  await exec(
    'truncate wallet, wager_transaction, wallet_ledger_entry, inbox_message, outbox_message cascade',
  );
});

describe('wallet', () => {
  it('recusa duas wallets para o mesmo (player_id, currency)', async () => {
    await exec(
      `insert into wallet (id, player_id, currency, balance_amount, version, created_at, updated_at)
       values (gen_random_uuid(), 'p', 'BRL', '0.00', 1, now(), now())`,
    );
    await expectViolation(
      exec(
        `insert into wallet (id, player_id, currency, balance_amount, version, created_at, updated_at)
         values (gen_random_uuid(), 'p', 'BRL', '0.00', 1, now(), now())`,
      ),
      /wallet_player_currency_uq|duplicate key/i,
    );
  });

  it('recusa saldo negativo (CHECK no schema)', async () => {
    await expectViolation(
      exec(
        `insert into wallet (id, player_id, currency, balance_amount, version, created_at, updated_at)
         values (gen_random_uuid(), 'p2', 'BRL', '-0.01', 1, now(), now())`,
      ),
      /wallet_balance_non_negative|violates check/i,
    );
  });
});

describe('wager_transaction', () => {
  beforeEach(seedWalletAndTx);

  it('recusa idempotency_key duplicada', async () => {
    await expectViolation(
      exec(
        `insert into wager_transaction
           (id, provider_id, external_transaction_id, idempotency_key, payload_hash, wallet_id,
            player_id, round_id, game_id, kind, money_amount, money_currency, status, created_at)
         values (gen_random_uuid(), 'prov', 'ext-OUTRO', 'prov:ext-1', 'h', ?,
            'player-1', 'r', 'g', 'BET', '1.00', 'BRL', 'PENDING', now())`,
        [WALLET_ID],
      ),
      /wager_tx_idempotency_key_uq|duplicate key/i,
    );
  });

  it('recusa (provider_id, external_transaction_id) duplicado', async () => {
    await expectViolation(
      exec(
        `insert into wager_transaction
           (id, provider_id, external_transaction_id, idempotency_key, payload_hash, wallet_id,
            player_id, round_id, game_id, kind, money_amount, money_currency, status, created_at)
         values (gen_random_uuid(), 'prov', 'ext-1', 'prov:OUTRA-KEY', 'h', ?,
            'player-1', 'r', 'g', 'BET', '1.00', 'BRL', 'PENDING', now())`,
        [WALLET_ID],
      ),
      /wager_tx_provider_external_uq|duplicate key/i,
    );
  });

  it('recusa kind fora do enum', async () => {
    await expectViolation(
      exec(
        `insert into wager_transaction
           (id, provider_id, external_transaction_id, idempotency_key, payload_hash, wallet_id,
            player_id, round_id, game_id, kind, money_amount, money_currency, status, created_at)
         values (gen_random_uuid(), 'prov', 'ext-x', 'k', 'h', ?,
            'player-1', 'r', 'g', 'JACKPOT', '1.00', 'BRL', 'PENDING', now())`,
        [WALLET_ID],
      ),
      /wager_tx_kind_chk|violates check/i,
    );
  });

  it('README 7.4: recusa dois ROLLBACK PROCESSED para a mesma referência', async () => {
    const insertRollback = (extId: string): Promise<unknown> =>
      exec(
        `insert into wager_transaction
           (id, provider_id, external_transaction_id, idempotency_key, payload_hash, wallet_id,
            player_id, round_id, game_id, kind, money_amount, money_currency,
            reference_transaction_id, status, created_at)
         values (gen_random_uuid(), 'prov', ?, ?, 'h', ?,
            'player-1', 'round-1', 'game-1', 'ROLLBACK', '80.00', 'BRL',
            ?, 'PROCESSED', now())`,
        [extId, extId, WALLET_ID, TX_ID],
      );

    await insertRollback('rb-1');
    await expectViolation(insertRollback('rb-2'), /wager_tx_one_reversal_per_kind_uq|duplicate key/i);
  });
});

describe('wallet_ledger_entry', () => {
  const LEDGER_ID = '00000000-0000-0000-0000-0000000000aa';

  beforeEach(async () => {
    await seedWalletAndTx();
    await exec(
      `insert into wallet_ledger_entry
         (id, wallet_id, transaction_id, direction, money_amount, money_currency,
          balance_before_amount, balance_after_amount, created_at)
       values (?, ?, ?, 'DEBIT', '80.00', 'BRL', '100.00', '20.00', now())`,
      [LEDGER_ID, WALLET_ID, TX_ID],
    );
  });

  it('recusa mais de um lançamento por (wallet_id, transaction_id)', async () => {
    await expectViolation(
      exec(
        `insert into wallet_ledger_entry
           (id, wallet_id, transaction_id, direction, money_amount, money_currency,
            balance_before_amount, balance_after_amount, created_at)
         values (gen_random_uuid(), ?, ?, 'CREDIT', '1.00', 'BRL', '20.00', '21.00', now())`,
        [WALLET_ID, TX_ID],
      ),
      /ledger_one_per_wallet_tx_uq|duplicate key/i,
    );
  });

  it('é imutável: UPDATE é bloqueado pelo trigger', async () => {
    await expectViolation(
      exec(`update wallet_ledger_entry set money_amount = '1.00' where id = ?`, [LEDGER_ID]),
      /imutavel|immutable/i,
    );
  });

  it('é imutável: DELETE é bloqueado pelo trigger', async () => {
    await expectViolation(
      exec(`delete from wallet_ledger_entry where id = ?`, [LEDGER_ID]),
      /imutavel|immutable/i,
    );
  });
});

describe('inbox_message', () => {
  it('recusa (consumer_name, message_id) duplicado', async () => {
    await exec(
      `insert into inbox_message (consumer_name, message_id, payload_hash, received_at)
       values ('c', 'm-1', 'h', now())`,
    );
    await expectViolation(
      exec(
        `insert into inbox_message (consumer_name, message_id, payload_hash, received_at)
         values ('c', 'm-1', 'h2', now())`,
      ),
      /inbox_message_pkey|duplicate key/i,
    );
  });
});
