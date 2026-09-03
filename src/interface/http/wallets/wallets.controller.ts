import {
  BadRequestException,
  UseGuards,
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  Logger,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  Query,
} from '@nestjs/common';
import { CreateWallet } from '../../../application/wallet/create-wallet.use-case';
import { ReconcileWallet } from '../../../application/wallet/reconcile-wallet.use-case';
import { ReadModels } from '../../../infrastructure/database/queries/read-models';
import { MetricsService } from '../../../infrastructure/observability/metrics.service';
import { CreateWalletDto } from '../shared/dtos';
import { AuthGuard } from '../shared/auth.guard';

@UseGuards(AuthGuard)
@Controller('wallets')
export class WalletsController {
  private readonly logger = new Logger(WalletsController.name);

  constructor(
    private readonly createWallet: CreateWallet,
    private readonly reconcileWallet: ReconcileWallet,
    private readonly reads: ReadModels,
    private readonly metrics: MetricsService,
  ) {}

  @Post()
  async create(@Body() body: CreateWalletDto) {
    return this.createWallet.execute({
      playerId: body.playerId,
      initialBalance: body.initialBalance,
    });
  }

  @Get(':walletId')
  async get(@Param('walletId') walletId: string) {
    const wallet = await this.reads.getWallet(walletId);
    if (!wallet) {
      throw new NotFoundException(`Wallet ${walletId} não encontrada`);
    }
    return wallet;
  }

  @Get(':walletId/ledger')
  async ledger(
    @Param('walletId') walletId: string,
    @Query('cursor') cursor: string | undefined,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
  ) {
    if (limit < 1 || limit > 200) {
      throw new BadRequestException('limit deve estar entre 1 e 200');
    }
    return this.reads.getLedgerPage(walletId, cursor, limit);
  }

  @Post(':walletId/reconciliation')
  async reconcile(@Param('walletId') walletId: string) {
    const result = await this.reconcileWallet.execute(walletId);
    if (!result.consistent) {
      this.metrics.reconciliationMismatch.inc();
      this.logger.error({
        msg: 'DIVERGÊNCIA de reconciliação',
        walletId,
        storedBalance: result.storedBalance,
        calculatedBalance: result.calculatedBalance,
        difference: result.difference,
      });
    }
    return result;
  }
}
