import { Injectable } from '@nestjs/common';
import { MikroORM } from '@mikro-orm/postgresql';
import {
  Counter,
  Gauge,
  Histogram,
  Registry,
  collectDefaultMetrics,
} from 'prom-client';

@Injectable()
export class MetricsService {
  readonly registry = new Registry();

  readonly transactions = new Counter({
    name: 'wager_transactions_total',
    help: 'Transações processadas por status e origem',
    labelNames: ['status', 'source', 'kind'],
    registers: [this.registry],
  });

  readonly idempotentReplays = new Counter({
    name: 'wager_idempotent_replays_total',
    help: 'Respostas servidas como replay idempotente',
    labelNames: ['source'],
    registers: [this.registry],
  });

  readonly duration = new Histogram({
    name: 'wager_transaction_duration_seconds',
    help: 'Latência do processamento de uma transação',
    labelNames: ['source'],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
    registers: [this.registry],
  });

  readonly concurrencyRetries = new Counter({
    name: 'wager_concurrency_retries_total',
    help: 'Retentativas por conflito de concorrência / idempotência',
    labelNames: ['reason'],
    registers: [this.registry],
  });

  readonly sqsMessages = new Counter({
    name: 'wager_sqs_messages_total',
    help: 'Mensagens consumidas por disposição',
    labelNames: ['disposition'],
    registers: [this.registry],
  });

  readonly dlqMessages = new Counter({
    name: 'wager_dlq_messages_total',
    help: 'Mensagens enviadas para a DLQ',
    registers: [this.registry],
  });

  readonly reconciliationMismatch = new Counter({
    name: 'wager_reconciliation_mismatch_total',
    help: 'Reconciliações que encontraram divergência',
    registers: [this.registry],
  });

  private readonly outboxLag = new Gauge({
    name: 'wager_outbox_lag_seconds',
    help: 'Idade do evento não publicado mais antigo',
    registers: [this.registry],
  });

  private readonly outboxPending = new Gauge({
    name: 'wager_outbox_pending',
    help: 'Eventos ainda não publicados',
    registers: [this.registry],
  });

  constructor(private readonly orm: MikroORM) {
    collectDefaultMetrics({ register: this.registry });
  }

  private async readOutboxState(): Promise<{ lag: number; pending: number }> {
    try {
      const rows = (await this.orm.em.getConnection().execute(
        `select
           count(*) as pending,
           coalesce(extract(epoch from now() - min(occurred_at)), 0) as lag
         from outbox_message where published_at is null`,
      )) as Array<{ pending: string; lag: string }>;
      return { lag: Number(rows[0]?.lag ?? 0), pending: Number(rows[0]?.pending ?? 0) };
    } catch {
      return { lag: 0, pending: 0 };
    }
  }

  async render(): Promise<string> {
    const { lag, pending } = await this.readOutboxState();
    this.outboxLag.set(lag);
    this.outboxPending.set(pending);
    return this.registry.metrics();
  }
}
