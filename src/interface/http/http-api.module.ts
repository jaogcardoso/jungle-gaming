import { type MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import {
  CLOCK,
  ID_GENERATOR,
  UNIT_OF_WORK,
  type Clock,
  type IdGenerator,
  type UnitOfWork,
} from '../../application/ports';
import { CreateWallet } from '../../application/wallet/create-wallet.use-case';
import { ReconcileWallet } from '../../application/wallet/reconcile-wallet.use-case';
import { WageringProcessingModule } from '../../infrastructure/wagering-processing.module';
import { ReadModels } from '../../infrastructure/database/queries/read-models';
import { PROVIDER_IDENTITY, NoopProviderIdentity } from '../../application/ports';
import { WalletsController } from './wallets/wallets.controller';
import { WageringController } from './wagering/wagering.controller';
import { CorrelationMiddleware } from './shared/correlation.middleware';
import { AuthGuard } from './shared/auth.guard';

@Module({
  imports: [WageringProcessingModule],
  controllers: [WalletsController, WageringController],
  providers: [
    ReadModels,
    AuthGuard,
    { provide: PROVIDER_IDENTITY, useClass: NoopProviderIdentity },
    {
      provide: CreateWallet,
      useFactory: (uow: UnitOfWork, clock: Clock, ids: IdGenerator) =>
        new CreateWallet(uow, clock, ids),
      inject: [UNIT_OF_WORK, CLOCK, ID_GENERATOR],
    },
    {
      provide: ReconcileWallet,
      useFactory: (uow: UnitOfWork) => new ReconcileWallet(uow),
      inject: [UNIT_OF_WORK],
    },
  ],
})
export class HttpApiModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationMiddleware).forRoutes('*');
  }
}
