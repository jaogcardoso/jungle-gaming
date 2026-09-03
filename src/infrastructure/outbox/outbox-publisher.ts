import { Logger } from '@nestjs/common';
import type { MikroORM } from '@mikro-orm/postgresql';
import { SendMessageCommand, type SQSClient } from '@aws-sdk/client-sqs';
import type { Clock } from '../../application/ports';
import { OutboxMessageEntity } from '../database/entities/outbox-message.entity';

interface OutboxRow {
  id: string;
  aggregate_id: string;
  event_type: string;
  payload: Record<string, unknown>;
  attempts: string | number;
}

/** Publica os eventos pendentes do outbox no SQS. */
export class OutboxPublisher {
  private readonly logger = new Logger(OutboxPublisher.name);

  constructor(
    private readonly orm: MikroORM,
    private readonly sqs: SQSClient,
    private readonly eventsQueueUrl: string,
    private readonly clock: Clock,
  ) {}

  /** Processa um lote. */
  async publishBatch(limit = 20): Promise<number> {
    const em = this.orm.em.fork();
    return em.transactional(async (tx) => {
      const rows = (await tx.execute(
        `select id, aggregate_id, event_type, payload, attempts
         from outbox_message
         where published_at is null
           and (next_attempt_at is null or next_attempt_at <= now())
         order by occurred_at asc
         for update skip locked
         limit ?`,
        [limit],
      )) as OutboxRow[];

      for (const row of rows) {
        try {
          await this.sqs.send(
            new SendMessageCommand({
              QueueUrl: this.eventsQueueUrl,
              MessageBody: JSON.stringify(row.payload),
              MessageGroupId: row.aggregate_id,
              MessageDeduplicationId: row.id,
            }),
          );
          await tx.nativeUpdate(
            OutboxMessageEntity,
            { id: row.id },
            { publishedAt: this.clock.now() },
          );
        } catch (error) {
          const attempts = Number(row.attempts) + 1;
          const backoffMs = Math.min(60_000, 2 ** attempts * 250);
          await tx.nativeUpdate(
            OutboxMessageEntity,
            { id: row.id },
            { attempts, nextAttemptAt: new Date(Date.now() + backoffMs) },
          );
          this.logger.warn({ msg: 'falha ao publicar evento', id: row.id, attempts, error: String(error) });
        }
      }
      return rows.length;
    });
  }
}
