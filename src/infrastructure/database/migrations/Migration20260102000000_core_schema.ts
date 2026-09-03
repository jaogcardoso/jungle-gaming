import { Migration } from '@mikro-orm/migrations';

/** Schema de negócio + constraints. */
export class Migration20260102000000_core_schema extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      create table "wallet" (
        "id" uuid not null,
        "player_id" varchar(255) not null,
        "currency" char(3) not null,
        "balance_amount" numeric(38, 2) not null,
        "version" int not null default 1,
        "created_at" timestamptz not null,
        "updated_at" timestamptz not null,
        constraint "wallet_pkey" primary key ("id")
      );
    `);
    this.addSql(
      `alter table "wallet" add constraint "wallet_player_currency_uq" unique ("player_id", "currency");`,
    );
    this.addSql(
      `alter table "wallet" add constraint "wallet_balance_non_negative" check ("balance_amount" >= 0);`,
    );
    this.addSql(
      `alter table "wallet" add constraint "wallet_version_positive" check ("version" >= 1);`,
    );

    this.addSql(`
      create table "wager_transaction" (
        "id" uuid not null,
        "provider_id" varchar(255) not null,
        "external_transaction_id" varchar(255) not null,
        "idempotency_key" varchar(512) not null,
        "payload_hash" varchar(128) not null,
        "wallet_id" uuid not null,
        "player_id" varchar(255) not null,
        "round_id" varchar(255) not null,
        "game_id" varchar(255) not null,
        "kind" varchar(16) not null,
        "money_amount" numeric(38, 2) not null,
        "money_currency" char(3) not null,
        "reference_external_transaction_id" varchar(255) null,
        "reference_transaction_id" uuid null,
        "status" varchar(24) not null,
        "failure_code" varchar(64) null,
        "observed_balance_amount" numeric(38, 2) null,
        "created_at" timestamptz not null,
        "processed_at" timestamptz null,
        constraint "wager_transaction_pkey" primary key ("id")
      );
    `);
    this.addSql(
      `alter table "wager_transaction" add constraint "wager_tx_idempotency_key_uq" unique ("idempotency_key");`,
    );
    this.addSql(
      `alter table "wager_transaction" add constraint "wager_tx_provider_external_uq" unique ("provider_id", "external_transaction_id");`,
    );
    this.addSql(
      `alter table "wager_transaction" add constraint "wager_tx_kind_chk" check ("kind" in ('OPENING', 'BET', 'WIN', 'LOSS', 'REFUND', 'ROLLBACK'));`,
    );
    this.addSql(
      `alter table "wager_transaction" add constraint "wager_tx_status_chk" check ("status" in ('PENDING', 'PENDING_REFERENCE', 'PROCESSED', 'REJECTED', 'FAILED'));`,
    );
    this.addSql(
      `alter table "wager_transaction" add constraint "wager_tx_wallet_fk" foreign key ("wallet_id") references "wallet" ("id");`,
    );
    this.addSql(
      `alter table "wager_transaction" add constraint "wager_tx_reference_fk" foreign key ("reference_transaction_id") references "wager_transaction" ("id");`,
    );
    this.addSql(
      `create index "wager_tx_pending_reference_idx" on "wager_transaction" ("created_at") where "status" = 'PENDING_REFERENCE';`,
    );
    this.addSql(`
      create unique index "wager_tx_one_reversal_per_kind_uq"
        on "wager_transaction" ("reference_transaction_id", "kind")
        where "status" = 'PROCESSED' and "kind" in ('REFUND', 'ROLLBACK');
    `);

    this.addSql(`
      create table "wallet_ledger_entry" (
        "id" uuid not null,
        "wallet_id" uuid not null,
        "transaction_id" uuid not null,
        "direction" varchar(8) not null,
        "money_amount" numeric(38, 2) not null,
        "money_currency" char(3) not null,
        "balance_before_amount" numeric(38, 2) not null,
        "balance_after_amount" numeric(38, 2) not null,
        "created_at" timestamptz not null,
        constraint "wallet_ledger_entry_pkey" primary key ("id")
      );
    `);
    this.addSql(
      `alter table "wallet_ledger_entry" add constraint "ledger_direction_chk" check ("direction" in ('DEBIT', 'CREDIT'));`,
    );
    this.addSql(
      `alter table "wallet_ledger_entry" add constraint "ledger_one_per_wallet_tx_uq" unique ("wallet_id", "transaction_id");`,
    );
    this.addSql(
      `alter table "wallet_ledger_entry" add constraint "ledger_amount_positive_chk" check ("money_amount" > 0);`,
    );
    this.addSql(
      `alter table "wallet_ledger_entry" add constraint "ledger_after_non_negative_chk" check ("balance_after_amount" >= 0);`,
    );
    this.addSql(
      `alter table "wallet_ledger_entry" add constraint "ledger_wallet_fk" foreign key ("wallet_id") references "wallet" ("id");`,
    );
    this.addSql(
      `alter table "wallet_ledger_entry" add constraint "ledger_tx_fk" foreign key ("transaction_id") references "wager_transaction" ("id");`,
    );
    this.addSql(
      `create index "ledger_wallet_cursor_idx" on "wallet_ledger_entry" ("wallet_id", "created_at", "id");`,
    );

    this.addSql(`
      create or replace function "reject_ledger_mutation"() returns trigger as $$
      begin
        raise exception 'wallet_ledger_entry e imutavel: % bloqueado', tg_op;
      end;
      $$ language plpgsql;
    `);
    this.addSql(`
      create trigger "wallet_ledger_entry_immutable"
        before update or delete on "wallet_ledger_entry"
        for each row execute function "reject_ledger_mutation"();
    `);

    this.addSql(`
      create table "inbox_message" (
        "consumer_name" varchar(128) not null,
        "message_id" varchar(255) not null,
        "payload_hash" varchar(128) not null,
        "received_at" timestamptz not null,
        "processed_at" timestamptz null,
        constraint "inbox_message_pkey" primary key ("consumer_name", "message_id")
      );
    `);

    this.addSql(`
      create table "outbox_message" (
        "id" uuid not null,
        "aggregate_id" varchar(255) not null,
        "event_type" varchar(128) not null,
        "payload" jsonb not null,
        "occurred_at" timestamptz not null,
        "attempts" int not null default 0,
        "next_attempt_at" timestamptz null,
        "published_at" timestamptz null,
        constraint "outbox_message_pkey" primary key ("id")
      );
    `);
    this.addSql(
      `create index "outbox_unpublished_idx" on "outbox_message" ("occurred_at") where "published_at" is null;`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "outbox_message" cascade;`);
    this.addSql(`drop table if exists "inbox_message" cascade;`);
    this.addSql(
      `drop trigger if exists "wallet_ledger_entry_immutable" on "wallet_ledger_entry";`,
    );
    this.addSql(`drop function if exists "reject_ledger_mutation"();`);
    this.addSql(`drop table if exists "wallet_ledger_entry" cascade;`);
    this.addSql(`drop table if exists "wager_transaction" cascade;`);
    this.addSql(`drop table if exists "wallet" cascade;`);
  }
}
