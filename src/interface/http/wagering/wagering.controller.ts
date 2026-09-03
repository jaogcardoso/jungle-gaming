import {
  BadRequestException,
  UseGuards,
  Body,
  Controller,
  Get,
  Headers,
  Logger,
  NotFoundException,
  Param,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ProcessWagerTransaction } from '../../../application/wagering';
import { WagerTransactionStatus } from '../../../domain/wagering';
import { ReadModels } from '../../../infrastructure/database/queries/read-models';
import { MetricsService } from '../../../infrastructure/observability/metrics.service';
import { SubmitTransactionDto } from '../shared/dtos';
import { AuthGuard } from '../shared/auth.guard';

@UseGuards(AuthGuard)
@Controller()
export class WageringController {
  private readonly logger = new Logger(WageringController.name);

  constructor(
    private readonly process: ProcessWagerTransaction,
    private readonly reads: ReadModels,
    private readonly metrics: MetricsService,
  ) {}

  @Post('wagering/transactions')
  async submit(
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: SubmitTransactionDto,
    @Req() req: Request & { correlationId?: string },
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!idempotencyKey || idempotencyKey.trim() === '') {
      throw new BadRequestException('Header Idempotency-Key é obrigatório');
    }

    const stopTimer = this.metrics.duration.startTimer({ source: 'http' });
    const result = await this.process.execute({
      source: 'http',
      idempotencyKey,
      correlationId: req.correlationId,
      providerId: body.providerId,
      externalTransactionId: body.externalTransactionId,
      playerId: body.playerId,
      walletId: body.walletId,
      roundId: body.roundId,
      gameId: body.gameId,
      kind: body.kind,
      money: body.money,
      referenceExternalTransactionId: body.referenceExternalTransactionId,
    });
    stopTimer();

    this.metrics.transactions.inc({ status: result.status, source: 'http', kind: body.kind });
    if (result.idempotentReplay) {
      this.metrics.idempotentReplays.inc({ source: 'http' });
    }
    this.logger.log({
      msg: 'transação HTTP processada',
      correlationId: req.correlationId,
      transactionId: result.transactionId,
      walletId: body.walletId,
      providerId: body.providerId,
      status: result.status,
      idempotentReplay: result.idempotentReplay,
    });

    const payload = {
      transactionId: result.transactionId,
      status: result.status,
      balance: result.balance,
      failureCode: result.failureCode ?? null,
      idempotentReplay: result.idempotentReplay,
    };

    switch (result.status) {
      case WagerTransactionStatus.PendingReference:
        res.status(202);
        break;
      case WagerTransactionStatus.Rejected:
        res.status(422);
        break;
      default:
        res.status(200);
    }
    return payload;
  }

  @Get('wagering/transactions/:transactionId')
  async byId(@Param('transactionId') id: string) {
    const tx = await this.reads.getTransaction(id);
    if (!tx) throw new NotFoundException(`Transação ${id} não encontrada`);
    return tx;
  }

  @Get('providers/:providerId/wagering/transactions/:externalTransactionId')
  async byProviderExternal(
    @Param('providerId') providerId: string,
    @Param('externalTransactionId') externalId: string,
  ) {
    const tx = await this.reads.getTransactionByProviderExternal(providerId, externalId);
    if (!tx) throw new NotFoundException('Transação não encontrada');
    return tx;
  }
}
