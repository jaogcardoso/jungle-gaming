import { Module } from '@nestjs/common';
import { WageringProcessingModule } from '../../infrastructure/wagering-processing.module';
import { WagerMessageHandler } from './wager-message.handler';
import { SqsWagerConsumer } from './sqs-wager-consumer';

/** Consumidor SQS. */
@Module({
  imports: [WageringProcessingModule],
  providers: [WagerMessageHandler, SqsWagerConsumer],
  exports: [WagerMessageHandler, SqsWagerConsumer],
})
export class MessagingConsumerModule {}
