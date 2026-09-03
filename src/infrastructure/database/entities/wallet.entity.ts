import { Entity, PrimaryKey, Property, Unique } from '@mikro-orm/core';

/** Modelo de **persistência** da wallet — NÃO é o agregado de domínio. */
@Entity({ tableName: 'wallet' })
@Unique({ properties: ['playerId', 'currency'] })
export class WalletEntity {
  @PrimaryKey({ type: 'uuid' })
  id!: string;

  @Property({ type: 'string' })
  playerId!: string;

  @Property({ type: 'string', columnType: 'char(3)' })
  currency!: string;

  @Property({ type: 'string', columnType: 'numeric(38,2)' })
  balanceAmount!: string;

  @Property({ type: 'int' })
  version!: number;

  @Property({ type: 'Date', columnType: 'timestamptz' })
  createdAt!: Date;

  @Property({ type: 'Date', columnType: 'timestamptz' })
  updatedAt!: Date;
}
