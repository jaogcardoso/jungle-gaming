import { Module } from '@nestjs/common';
import { WageringProcessingModule } from '../wagering-processing.module';
import { PendingReferenceWorker } from './pending-reference.worker';

@Module({
  imports: [WageringProcessingModule],
  providers: [PendingReferenceWorker],
  exports: [PendingReferenceWorker],
})
export class WorkersModule {}
