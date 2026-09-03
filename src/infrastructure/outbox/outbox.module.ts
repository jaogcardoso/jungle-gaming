import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { WageringProcessingModule } from '../wagering-processing.module';
import { OutboxPublisherWorker } from './outbox-publisher.worker';

/** Worker que publica os eventos do outbox. */
@Module({
  imports: [DatabaseModule, WageringProcessingModule],
  providers: [OutboxPublisherWorker],
  exports: [OutboxPublisherWorker],
})
export class OutboxModule {}
