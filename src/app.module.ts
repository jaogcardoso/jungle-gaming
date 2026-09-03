import { Module } from '@nestjs/common';
import { DatabaseModule } from '@infrastructure/database/database.module';
import { MessagingModule } from '@infrastructure/messaging/messaging.module';
import { HealthModule } from '@interface/http/health/health.module';
import { ObservabilityModule } from '@interface/http/observability/observability.module';
import { HttpApiModule } from '@interface/http/http-api.module';
import { MessagingConsumerModule } from '@interface/messaging/messaging-consumer.module';
import { OutboxModule } from '@infrastructure/outbox/outbox.module';
import { WorkersModule } from '@infrastructure/workers/workers.module';

/** Composição raiz. */
@Module({
  imports: [
    DatabaseModule,
    MessagingModule,
    ObservabilityModule,
    HealthModule,
    HttpApiModule,
    MessagingConsumerModule,
    OutboxModule,
    WorkersModule,
  ],
})
export class AppModule {}
