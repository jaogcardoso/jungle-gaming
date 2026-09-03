import { WagerTransactionKind } from '../../domain/wagering';
import type { ProcessWagerTransactionCommand } from '../../application/wagering';

/** Envelope da mensagem da fila (README §10). */
export interface WagerMessage {
  messageId: string;
  type: 'WagerTransactionRequested';
  occurredAt: string;
  data: {
    providerId: string;
    externalTransactionId: string;
    idempotencyKey: string;
    playerId: string;
    walletId: string;
    roundId: string;
    gameId: string;
    kind: WagerTransactionKind;
    money: { amount: string; currency: string };
    referenceExternalTransactionId?: string;
  };
}

export class MalformedMessageError extends Error {
  constructor(reason: string) {
    super(`Mensagem malformada: ${reason}`);
    this.name = 'MalformedMessageError';
  }
}

const KINDS = new Set(Object.values(WagerTransactionKind));

/** Faz o parse estrito. Erro aqui = mensagem "veneno" → DLQ (não adianta retry). */
export function parseWagerMessage(raw: string): WagerMessage {
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    throw new MalformedMessageError('JSON inválido');
  }
  if (typeof obj !== 'object' || obj === null) {
    throw new MalformedMessageError('corpo não é objeto');
  }
  const m = obj as Record<string, unknown>;
  const data = m['data'];
  if (typeof m['messageId'] !== 'string' || typeof data !== 'object' || data === null) {
    throw new MalformedMessageError('faltam messageId/data');
  }
  const d = data as Record<string, unknown>;
  const str = (k: string): string => {
    if (typeof d[k] !== 'string' || (d[k] as string) === '') {
      throw new MalformedMessageError(`campo "${k}" ausente ou vazio`);
    }
    return d[k] as string;
  };
  const money = d['money'] as Record<string, unknown> | undefined;
  if (!money || typeof money['amount'] !== 'string' || typeof money['currency'] !== 'string') {
    throw new MalformedMessageError('money inválido');
  }
  const kind = str('kind');
  if (!KINDS.has(kind as WagerTransactionKind)) {
    throw new MalformedMessageError(`kind inválido: ${kind}`);
  }
  if (kind === WagerTransactionKind.Opening) {
    throw new MalformedMessageError('OPENING não pode vir pela fila');
  }

  return {
    messageId: m['messageId'] as string,
    type: 'WagerTransactionRequested',
    occurredAt: typeof m['occurredAt'] === 'string' ? (m['occurredAt'] as string) : new Date().toISOString(),
    data: {
      providerId: str('providerId'),
      externalTransactionId: str('externalTransactionId'),
      idempotencyKey: str('idempotencyKey'),
      playerId: str('playerId'),
      walletId: str('walletId'),
      roundId: str('roundId'),
      gameId: str('gameId'),
      kind: kind as WagerTransactionKind,
      money: { amount: money['amount'] as string, currency: money['currency'] as string },
      referenceExternalTransactionId:
        typeof d['referenceExternalTransactionId'] === 'string'
          ? (d['referenceExternalTransactionId'] as string)
          : undefined,
    },
  };
}

export function toCommand(message: WagerMessage): ProcessWagerTransactionCommand {
  return {
    source: 'sqs',
    messageId: message.messageId,
    idempotencyKey: message.data.idempotencyKey,
    providerId: message.data.providerId,
    externalTransactionId: message.data.externalTransactionId,
    playerId: message.data.playerId,
    walletId: message.data.walletId,
    roundId: message.data.roundId,
    gameId: message.data.gameId,
    kind: message.data.kind,
    money: message.data.money,
    referenceExternalTransactionId: message.data.referenceExternalTransactionId,
  };
}
