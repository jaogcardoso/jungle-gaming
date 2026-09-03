import { Migration } from '@mikro-orm/migrations';

/** Bookkeeping do reprocessamento de `PENDING_REFERENCE` (Etapa 11 / README 7.1). */
export class Migration20260103000000_pending_reference_retry extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `alter table "wager_transaction" add column "reference_attempts" int not null default 0;`,
    );
    this.addSql(
      `alter table "wager_transaction" add column "reference_next_attempt_at" timestamptz null;`,
    );
    this.addSql(`drop index "wager_tx_pending_reference_idx";`);
    this.addSql(`
      create index "wager_tx_pending_reference_idx"
        on "wager_transaction" ("reference_next_attempt_at")
        where "status" = 'PENDING_REFERENCE';
    `);
  }

  override async down(): Promise<void> {
    this.addSql(`drop index "wager_tx_pending_reference_idx";`);
    this.addSql(
      `create index "wager_tx_pending_reference_idx" on "wager_transaction" ("created_at") where "status" = 'PENDING_REFERENCE';`,
    );
    this.addSql(`alter table "wager_transaction" drop column "reference_next_attempt_at";`);
    this.addSql(`alter table "wager_transaction" drop column "reference_attempts";`);
  }
}
