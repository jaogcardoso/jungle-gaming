import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import {
  DeleteMessageCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
  type SQSClient,
} from '@aws-sdk/client-sqs';
import { SQS_CLIENT } from '../../infrastructure/messaging/sqs.client';
import { env } from '../../config/env';
import { WagerMessageHandler } from './wager-message.handler';

/** Loop de consumo da `wager-transactions.fifo`. */
@Injectable()
export class SqsWagerConsumer implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(SqsWagerConsumer.name);
  private running = false;
  private stopped = false;
  private loopPromise?: Promise<void>;

  constructor(
    @Inject(SQS_CLIENT) private readonly sqs: SQSClient,
    private readonly handler: WagerMessageHandler,
  ) {}

  onApplicationBootstrap(): void {
    if (env.nodeEnv === 'test') {
      return; 
    }
    this.running = true;
    this.loopPromise = this.loop();
  }

  async onModuleDestroy(): Promise<void> {
    this.running = false;
    this.stopped = true;
    await this.loopPromise; 
  }

  private async loop(): Promise<void> {
    this.logger.log('consumidor SQS iniciado');
    while (this.running) {
      try {
        await this.pollOnce();
      } catch (error) {
        this.logger.error({ msg: 'erro no loop de consumo', error: String(error) });
        await sleep(1000);
      }
    }
    this.logger.log('consumidor SQS parado');
  }

  /** Um ciclo: recebe até 10 mensagens e processa. */
  async pollOnce(waitTimeSeconds = 20): Promise<number> {
    const received = await this.sqs.send(
      new ReceiveMessageCommand({
        QueueUrl: env.sqs.wagerQueueUrl,
        MaxNumberOfMessages: 10,
        WaitTimeSeconds: waitTimeSeconds,
      }),
    );
    const messages = received.Messages ?? [];
    for (const msg of messages) {
      if (this.stopped) break;
      await this.processOne(msg.Body ?? '', msg.ReceiptHandle);
    }
    return messages.length;
  }

  private async processOne(body: string, receiptHandle: string | undefined): Promise<void> {
    const { disposition } = await this.handler.handle(body);

    if (disposition === 'retry') {
      return; 
    }
    if (disposition === 'dlq') {
      await this.sqs.send(
        new SendMessageCommand({
          QueueUrl: env.sqs.wagerDlqUrl,
          MessageBody: body,
          MessageGroupId: 'poison',
          MessageDeduplicationId: crypto.randomUUID(),
        }),
      );
    }
    if (receiptHandle) {
      await this.sqs.send(
        new DeleteMessageCommand({ QueueUrl: env.sqs.wagerQueueUrl, ReceiptHandle: receiptHandle }),
      );
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
