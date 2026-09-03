import { Entity, PrimaryKey, Property } from '@mikro-orm/core';

/** Deduplicação de mensagens da fila. */
@Entity({ tableName: 'inbox_message' })
export class InboxMessageEntity {
  @PrimaryKey({ type: 'string', columnType: 'varchar(128)' })
  consumerName!: string;

  @PrimaryKey({ type: 'string' })
  messageId!: string;

  @Property({ type: 'string', columnType: 'varchar(128)' })
  payloadHash!: string;

  @Property({ type: 'Date', columnType: 'timestamptz' })
  receivedAt!: Date;

  @Property({ type: 'Date', columnType: 'timestamptz', nullable: true })
  processedAt?: Date | null;
}
