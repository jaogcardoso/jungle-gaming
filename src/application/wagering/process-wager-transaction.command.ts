import type { MoneyProps } from '../../domain/money';
import type { FailureCode, WagerTransactionKind, WagerTransactionStatus } from '../../domain/wagering';

/** Entrada **normalizada** do caso de uso. */
export interface ProcessWagerTransactionCommand {
  /** De onde veio — decide se o inbox entra em ação. */
  source: 'http' | 'sqs';
  /** `Idempotency-Key` (HTTP) ou `data.idempotencyKey` (SQS). */
  idempotencyKey: string;
  providerId: string;
  externalTransactionId: string;
  playerId: string;
  walletId: string;
  roundId: string;
  gameId: string;
  kind: WagerTransactionKind;
  money: MoneyProps;
  referenceExternalTransactionId?: string;
  /** Só quando `source === 'sqs'`: id da mensagem para dedup no inbox. */
  messageId?: string;
  /** Rastreio ponta a ponta (request id / message id). */
  correlationId?: string;
}

export interface ProcessWagerTransactionResult {
  transactionId: string;
  status: WagerTransactionStatus;
  /** Saldo observado no momento da aplicação; `null` quando rejeitada/pendente. */
  balance: MoneyProps | null;
  failureCode?: FailureCode;
  /** `true` quando a resposta veio de uma transação já existente (replay). */
  idempotentReplay: boolean;
}
