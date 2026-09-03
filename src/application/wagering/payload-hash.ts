import { createHash } from 'node:crypto';
import { Money, type MoneyProps } from '../../domain/money';

/** Subconjunto de **campos de negócio** que entram no hash. */
export interface PayloadHashInput {
  providerId: string;
  externalTransactionId: string;
  playerId: string;
  walletId: string;
  roundId: string;
  gameId: string;
  kind: string;
  money: MoneyProps;
  referenceExternalTransactionId?: string;
}

/** JSON canônico: chaves ordenadas recursivamente, sem espaços, campos `undefined` descartados. */
export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null';
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`).join(',')}}`;
}

/** `payloadHash` = SHA-256 (hex) do JSON canônico do subconjunto de negócio. */
export function computePayloadHash(input: PayloadHashInput): string {
  const normalized = {
    providerId: input.providerId,
    externalTransactionId: input.externalTransactionId,
    playerId: input.playerId,
    walletId: input.walletId,
    roundId: input.roundId,
    gameId: input.gameId,
    kind: input.kind,
    money: Money.from(input.money).toJSON(),
    referenceExternalTransactionId: input.referenceExternalTransactionId,
  };
  return createHash('sha256').update(canonicalize(normalized)).digest('hex');
}
