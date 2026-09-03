import { Inject, Injectable, Logger } from '@nestjs/common';
import { MikroORM } from '@mikro-orm/core';
import { GetQueueAttributesCommand, type SQSClient } from '@aws-sdk/client-sqs';
import { SQS_CLIENT } from '@infrastructure/messaging/sqs.client';
import { env } from '@config/env';

export type DependencyStatus = 'up' | 'down';

export interface ReadinessResult {
  status: 'ok' | 'error';
  checks: {
    postgres: DependencyStatus;
    sqs: DependencyStatus;
  };
}

/** Diferença entre os dois checks: - liveness: "o processo está de pé". */
@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(
    private readonly orm: MikroORM,
    @Inject(SQS_CLIENT) private readonly sqs: SQSClient,
  ) {}

  async checkReadiness(): Promise<ReadinessResult> {
    const [postgres, sqs] = await Promise.all([this.checkPostgres(), this.checkSqs()]);
    const status = postgres === 'up' && sqs === 'up' ? 'ok' : 'error';
    return { status, checks: { postgres, sqs } };
  }

  private async checkPostgres(): Promise<DependencyStatus> {
    try {
      await this.orm.em.getConnection().execute('select 1');
      return 'up';
    } catch (error) {
      this.logger.warn({ msg: 'readiness: PostgreSQL inalcançável', error: String(error) });
      return 'down';
    }
  }

  private async checkSqs(): Promise<DependencyStatus> {
    try {
      await this.sqs.send(
        new GetQueueAttributesCommand({
          QueueUrl: env.sqs.wagerQueueUrl,
          AttributeNames: ['QueueArn'],
        }),
      );
      return 'up';
    } catch (error) {
      this.logger.warn({ msg: 'readiness: SQS inalcançável', error: String(error) });
      return 'down';
    }
  }
}
