import { Injectable, Logger } from '@nestjs/common';
import { ProcessWagerTransaction } from '../../application/wagering';
import { MetricsService } from '../../infrastructure/observability/metrics.service';
import { MalformedMessageError, parseWagerMessage, toCommand } from './wager-message';

/** O que fazer com a mensagem depois de tentar processá-la. */
export type Disposition = 'ack' | 'retry' | 'dlq';

@Injectable()
export class WagerMessageHandler {
  private readonly logger = new Logger(WagerMessageHandler.name);

  constructor(
    private readonly process: ProcessWagerTransaction,
    private readonly metrics: MetricsService,
  ) {}

  async handle(rawBody: string): Promise<{ disposition: Disposition; messageId?: string }> {
    let messageId: string | undefined;
    const stopTimer = this.metrics.duration.startTimer({ source: 'sqs' });
    try {
      const message = parseWagerMessage(rawBody);
      messageId = message.messageId;
      const result = await this.process.execute({ ...toCommand(message), correlationId: messageId });
      stopTimer();
      this.metrics.sqsMessages.inc({ disposition: 'ack' });
      this.metrics.transactions.inc({
        status: result.status,
        source: 'sqs',
        kind: message.data.kind,
      });
      if (result.idempotentReplay) this.metrics.idempotentReplays.inc({ source: 'sqs' });
      this.logger.log({
        msg: 'mensagem processada',
        messageId,
        correlationId: messageId,
        transactionId: result.transactionId,
        walletId: message.data.walletId,
        providerId: message.data.providerId,
        status: result.status,
        idempotentReplay: result.idempotentReplay,
      });
      return { disposition: 'ack', messageId };
    } catch (error) {
      stopTimer();
      if (error instanceof MalformedMessageError) {
        this.metrics.sqsMessages.inc({ disposition: 'dlq' });
        this.metrics.dlqMessages.inc();
        this.logger.warn({ msg: 'mensagem malformada → DLQ', messageId, error: error.message });
        return { disposition: 'dlq', messageId };
      }
      this.metrics.sqsMessages.inc({ disposition: 'retry' });
      this.logger.warn({ msg: 'falha transitória → retry', messageId, error: String(error) });
      return { disposition: 'retry', messageId };
    }
  }
}
