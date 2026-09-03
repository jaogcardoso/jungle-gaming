import { Entity, Index, PrimaryKey, Property, Unique } from '@mikro-orm/core';

/** Modelo de persistência da `WagerTransaction`. */
@Entity({ tableName: 'wager_transaction' })
@Unique({ properties: ['idempotencyKey'] })
@Unique({ properties: ['providerId', 'externalTransactionId'] })
export class WagerTransactionEntity {
  @PrimaryKey({ type: 'uuid' })
  id!: string;

  @Property({ type: 'string' })
  providerId!: string;

  @Property({ type: 'string' })
  externalTransactionId!: string;

  @Property({ type: 'string', columnType: 'varchar(512)' })
  idempotencyKey!: string;

  @Property({ type: 'string', columnType: 'varchar(128)' })
  payloadHash!: string;

  @Index()
  @Property({ type: 'uuid' })
  walletId!: string;

  @Property({ type: 'string' })
  playerId!: string;

  @Property({ type: 'string' })
  roundId!: string;

  @Property({ type: 'string' })
  gameId!: string;

  @Property({ type: 'string', columnType: 'varchar(16)' })
  kind!: string;

  @Property({ type: 'string', columnType: 'numeric(38,2)' })
  moneyAmount!: string;

  @Property({ type: 'string', columnType: 'char(3)' })
  moneyCurrency!: string;

  @Property({ type: 'string', nullable: true })
  referenceExternalTransactionId?: string | null;

  @Property({ type: 'uuid', nullable: true })
  referenceTransactionId?: string | null;

  @Property({ type: 'string', columnType: 'varchar(24)' })
  status!: string;

  @Property({ type: 'string', columnType: 'varchar(64)', nullable: true })
  failureCode?: string | null;

  @Property({ type: 'string', columnType: 'numeric(38,2)', nullable: true })
  observedBalanceAmount?: string | null;

  @Property({ type: 'Date', columnType: 'timestamptz' })
  createdAt!: Date;

  @Property({ type: 'Date', columnType: 'timestamptz', nullable: true })
  processedAt?: Date | null;

  @Property({ type: 'int', default: 0 })
  referenceAttempts: number = 0;

  @Property({ type: 'Date', columnType: 'timestamptz', nullable: true })
  referenceNextAttemptAt?: Date | null;
}
