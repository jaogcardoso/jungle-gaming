import { Entity, Index, PrimaryKey, Property, Unique } from '@mikro-orm/core';

/** Modelo de persistência do lançamento de ledger. */
@Entity({ tableName: 'wallet_ledger_entry' })
@Unique({ properties: ['walletId', 'transactionId'] })
@Index({ properties: ['walletId', 'createdAt', 'id'] })
export class WalletLedgerEntryEntity {
  @PrimaryKey({ type: 'uuid' })
  id!: string;

  @Property({ type: 'uuid' })
  walletId!: string;

  @Property({ type: 'uuid' })
  transactionId!: string;

  @Property({ type: 'string', columnType: 'varchar(8)' })
  direction!: string;

  @Property({ type: 'string', columnType: 'numeric(38,2)' })
  moneyAmount!: string;

  @Property({ type: 'string', columnType: 'char(3)' })
  moneyCurrency!: string;

  @Property({ type: 'string', columnType: 'numeric(38,2)' })
  balanceBeforeAmount!: string;

  @Property({ type: 'string', columnType: 'numeric(38,2)' })
  balanceAfterAmount!: string;

  @Property({ type: 'Date', columnType: 'timestamptz' })
  createdAt!: Date;
}
