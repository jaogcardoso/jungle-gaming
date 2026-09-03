import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { MikroORM } from '@mikro-orm/postgresql';
import type { SQSClient } from '@aws-sdk/client-sqs';
import { SQS_CLIENT } from '../messaging/sqs.client';
import { CLOCK, type Clock } from '../../application/ports';
import { env } from '../../config/env';
import { OutboxPublisher } from './outbox-publisher';

/** Roda o `OutboxPublisher` num loop. */
@Injectable()
export class OutboxPublisherWorker implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(OutboxPublisherWorker.name);
  private readonly publisher: OutboxPublisher;
  private running = false;
  private loop?: Promise<void>;

  constructor(
    orm: MikroORM,
    @Inject(SQS_CLIENT) sqs: SQSClient,
    @Inject(CLOCK) clock: Clock,
  ) {
    this.publisher = new OutboxPublisher(orm, sqs, env.sqs.wagerEventsUrl, clock);
  }

  onApplicationBootstrap(): void {
    if (env.nodeEnv === 'test') return;
    this.running = true;
    this.loop = this.run();
  }

  async onModuleDestroy(): Promise<void> {
    this.running = false;
    await this.loop;
  }

  private async run(): Promise<void> {
    this.logger.log('outbox publisher iniciado');
    while (this.running) {
      try {
        const n = await this.publisher.publishBatch();
        await sleep(n > 0 ? 100 : 1000);
      } catch (error) {
        this.logger.error({ msg: 'erro no loop do outbox', error: String(error) });
        await sleep(2000);
      }
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
