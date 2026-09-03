import { Injectable, type NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

/** Garante um `correlationId` por requisição: usa `X-Correlation-Id` se veio, senão gera. */
@Injectable()
export class CorrelationMiddleware implements NestMiddleware {
  use(req: Request & { correlationId?: string }, res: Response, next: NextFunction): void {
    const incoming = req.header('x-correlation-id');
    const id = incoming && incoming.trim() !== '' ? incoming : randomUUID();
    req.correlationId = id;
    res.setHeader('x-correlation-id', id);
    next();
  }
}
