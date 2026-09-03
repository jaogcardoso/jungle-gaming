import { Global, Module } from '@nestjs/common';
import { DatabaseModule } from '../../../infrastructure/database/database.module';
import { MetricsService } from '../../../infrastructure/observability/metrics.service';
import { MetricsController } from './metrics.controller';

/** Expõe `MetricsService` para toda a aplicação e serve `/metrics`. */
@Global()
@Module({
  imports: [DatabaseModule],
  controllers: [MetricsController],
  providers: [MetricsService],
  exports: [MetricsService],
})
export class ObservabilityModule {}
