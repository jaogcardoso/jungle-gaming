import { Module } from '@nestjs/common';
import { MikroORM } from '@mikro-orm/postgresql';
import {
  CLOCK,
  ID_GENERATOR,
  UNIT_OF_WORK,
  type Clock,
  type IdGenerator,
  type UnitOfWork,
} from '../application/ports';
import { ProcessWagerTransaction, ReprocessPendingReferences } from '../application/wagering';
import { env } from '../config/env';
import { DatabaseModule } from './database/database.module';
import { MikroOrmUnitOfWork } from './database/mikro-orm-unit-of-work';
import { RetryingUnitOfWork } from './database/retrying-unit-of-work';
import { SystemClock } from './time/system-clock';
import { UuidGenerator } from './time/uuid-generator';
import { MetricsService } from './observability/metrics.service';

@Module({
  imports: [DatabaseModule],
  providers: [
    { provide: CLOCK, useClass: SystemClock },
    { provide: ID_GENERATOR, useClass: UuidGenerator },
    {
      provide: MikroOrmUnitOfWork,
      useFactory: (orm: MikroORM, ids: IdGenerator) => new MikroOrmUnitOfWork(orm, ids),
      inject: [MikroORM, ID_GENERATOR],
    },
    {
      provide: UNIT_OF_WORK,
      useFactory: (inner: MikroOrmUnitOfWork, metrics: MetricsService) =>
        new RetryingUnitOfWork(inner, 10, 15, (reason) =>
          metrics.concurrencyRetries.inc({ reason }),
        ),
      inject: [MikroOrmUnitOfWork, MetricsService],
    },
    {
      provide: ProcessWagerTransaction,
      useFactory: (uow: UnitOfWork, clock: Clock, ids: IdGenerator) =>
        new ProcessWagerTransaction(uow, clock, ids, env.consumerName),
      inject: [UNIT_OF_WORK, CLOCK, ID_GENERATOR],
    },
    {
      provide: ReprocessPendingReferences,
      useFactory: (uow: UnitOfWork, clock: Clock, ids: IdGenerator) =>
        new ReprocessPendingReferences(uow, clock, ids),
      inject: [UNIT_OF_WORK, CLOCK, ID_GENERATOR],
    },
  ],
  exports: [ProcessWagerTransaction, ReprocessPendingReferences, UNIT_OF_WORK, CLOCK, ID_GENERATOR],
})
export class WageringProcessingModule {}
