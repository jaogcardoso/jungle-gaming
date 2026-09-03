import { Global, Module } from '@nestjs/common';
import { SQS_CLIENT, createSqsClient } from './sqs.client';

/** Expõe o cliente SQS para toda a aplicação. */
@Global()
@Module({
  providers: [{ provide: SQS_CLIENT, useFactory: createSqsClient }],
  exports: [SQS_CLIENT],
})
export class MessagingModule {}
