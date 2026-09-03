import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import { DomainError } from '../../../domain/shared/domain-error';
import { CurrencyMismatchError, InvalidMoneyError } from '../../../domain/money';
import { WageringRuleError } from '../../../domain/wagering';
import { IdempotencyConflictError } from '../../../application/wagering';
import { WalletAlreadyExistsError } from '../../../application/ports';
import { WalletNotFoundError } from '../../../application/wallet/reconcile-wallet.use-case';
import { RetriesExhaustedError } from '../../../infrastructure/database/retrying-unit-of-work';

@Catch()
export class DomainExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(DomainExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    const { status, code, message } = this.classify(exception);

    if (status >= 500) {
      this.logger.error({ msg: 'erro não tratado', error: String(exception) });
    }
    res.status(status).json({ statusCode: status, failureCode: code, message });
  }

  private classify(e: unknown): { status: number; code: string; message: string } {
    if (e instanceof HttpException) {
      const resp = e.getResponse();
      const message =
        typeof resp === 'string' ? resp : ((resp as { message?: unknown }).message ?? e.message);
      return {
        status: e.getStatus(),
        code: e.getStatus() === 400 ? 'INVALID_PAYLOAD' : 'HTTP_ERROR',
        message: Array.isArray(message) ? message.join('; ') : String(message),
      };
    }
    if (e instanceof IdempotencyConflictError || e instanceof WalletAlreadyExistsError) {
      return { status: HttpStatus.CONFLICT, code: (e as { code?: string }).code ?? 'CONFLICT', message: e.message };
    }
    if (e instanceof WalletNotFoundError) {
      return { status: HttpStatus.NOT_FOUND, code: 'WALLET_NOT_FOUND', message: e.message };
    }
    if (e instanceof RetriesExhaustedError) {
      return {
        status: HttpStatus.SERVICE_UNAVAILABLE,
        code: 'CONCURRENCY_RETRIES_EXHAUSTED',
        message: 'Muitos conflitos de concorrência; tente novamente',
      };
    }
    if (e instanceof WageringRuleError) {
      return { status: HttpStatus.UNPROCESSABLE_ENTITY, code: e.failureCode, message: e.message };
    }
    if (e instanceof InvalidMoneyError || e instanceof CurrencyMismatchError) {
      return { status: HttpStatus.UNPROCESSABLE_ENTITY, code: e.code, message: e.message };
    }
    if (e instanceof DomainError) {
      return { status: HttpStatus.UNPROCESSABLE_ENTITY, code: e.code, message: e.message };
    }
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'INTERNAL_ERROR',
      message: 'Erro interno',
    };
  }
}
