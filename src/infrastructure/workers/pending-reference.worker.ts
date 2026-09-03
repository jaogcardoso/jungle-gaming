import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { ReprocessPendingReferences } from '../../application/wagering';
import { env } from '../../config/env';

/** Worker agendado que reprocessa `PENDING_REFERENCE` com backoff exponencial (README 7.1). */
@Injectable()
export class PendingReferenceWorker implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(PendingReferenceWorker.name);
  private running = false;
  private loop?: Promise<void>;

  constructor(private readonly reprocess: ReprocessPendingReferences) {}

  onApplicationBootstrap(): void {
    if (env.nodeEnv === 'test') return;
    this.running = true;
    this.loop = this.run();
  }

  async onModuleDestroy(): Promise<void> {
    this.running = false;
    await this.loop;
  }

  private async run(): Promise<void> {
    this.logger.log('pending-reference worker iniciado');
    while (this.running) {
      try {
        const n = await this.reprocess.runOnce();
        await sleep(n > 0 ? 500 : 5000);
      } catch (error) {
        this.logger.error({ msg: 'erro no worker de PENDING_REFERENCE', error: String(error) });
        await sleep(5000);
      }
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
