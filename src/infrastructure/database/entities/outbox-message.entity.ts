import { Entity, Index, PrimaryKey, Property } from '@mikro-orm/core';

/** Transactional Outbox. */
@Entity({ tableName: 'outbox_message' })
export class OutboxMessageEntity {
  @PrimaryKey({ type: 'uuid' })
  id!: string;

  @Property({ type: 'string' })
  aggregateId!: string;

  @Property({ type: 'string', columnType: 'varchar(128)' })
  eventType!: string;

  @Property({ type: 'json' })
  payload!: Record<string, unknown>;

  @Property({ type: 'Date', columnType: 'timestamptz' })
  occurredAt!: Date;

  @Property({ type: 'int', default: 0 })
  attempts: number = 0;

  @Index()
  @Property({ type: 'Date', columnType: 'timestamptz', nullable: true })
  nextAttemptAt?: Date | null;

  @Property({ type: 'Date', columnType: 'timestamptz', nullable: true })
  publishedAt?: Date | null;
}
