import { Money } from '../../../domain/money';
import { LedgerDirection } from '../../../domain/shared/ledger-direction';
import { Wallet, WalletLedgerEntry } from '../../../domain/wallet';
import {
  FailureCode,
  WagerTransaction,
  WagerTransactionKind,
  WagerTransactionStatus,
} from '../../../domain/wagering';
import type { WalletEntity } from '../entities/wallet.entity';
import type { WagerTransactionEntity } from '../entities/wager-transaction.entity';
import type { WalletLedgerEntryEntity } from '../entities/wallet-ledger-entry.entity';

/** As enums do domínio são string enums cujos valores batem com as colunas. */

export function walletToDomain(e: WalletEntity): Wallet {
  return Wallet.rehydrate({
    id: e.id,
    playerId: e.playerId,
    currency: e.currency.trim(),
    balance: Money.from({ amount: e.balanceAmount, currency: e.currency.trim() }),
    version: e.version,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
  });
}

export function walletToInsert(w: Wallet): Record<string, unknown> {
  const balance = w.balance.toJSON();
  return {
    id: w.id,
    playerId: w.playerId,
    currency: balance.currency,
    balanceAmount: balance.amount,
    version: w.version,
    createdAt: w.createdAt,
    updatedAt: w.updatedAt,
  };
}

export function wagerTransactionToDomain(e: WagerTransactionEntity): WagerTransaction {
  return WagerTransaction.rehydrate({
    id: e.id,
    providerId: e.providerId,
    externalTransactionId: e.externalTransactionId,
    idempotencyKey: e.idempotencyKey,
    payloadHash: e.payloadHash,
    walletId: e.walletId,
    playerId: e.playerId,
    roundId: e.roundId,
    gameId: e.gameId,
    kind: e.kind as WagerTransactionKind,
    money: Money.from({ amount: e.moneyAmount, currency: e.moneyCurrency.trim() }),
    referenceExternalTransactionId: e.referenceExternalTransactionId ?? undefined,
    createdAt: e.createdAt,
    status: e.status as WagerTransactionStatus,
    referenceTransactionId: e.referenceTransactionId ?? undefined,
    failureCode: (e.failureCode as FailureCode | null) ?? undefined,
    processedAt: e.processedAt ?? undefined,
    observedBalance:
      e.observedBalanceAmount != null
        ? Money.from({ amount: e.observedBalanceAmount, currency: e.moneyCurrency.trim() })
        : undefined,
  });
}

export function wagerTransactionToInsert(t: WagerTransaction): Record<string, unknown> {
  const money = t.money.toJSON();
  return {
    id: t.id,
    providerId: t.providerId,
    externalTransactionId: t.externalTransactionId,
    idempotencyKey: t.idempotencyKey,
    payloadHash: t.payloadHash,
    walletId: t.walletId,
    playerId: t.playerId,
    roundId: t.roundId,
    gameId: t.gameId,
    kind: t.kind,
    moneyAmount: money.amount,
    moneyCurrency: money.currency,
    referenceExternalTransactionId: t.referenceExternalTransactionId ?? null,
    referenceTransactionId: t.referenceTransactionId ?? null,
    status: t.status,
    failureCode: t.failureCode ?? null,
    observedBalanceAmount: t.observedBalance ? t.observedBalance.toJSON().amount : null,
    createdAt: t.createdAt,
    processedAt: t.processedAt ?? null,
  };
}

export function ledgerEntryToInsert(entry: WalletLedgerEntry): Record<string, unknown> {
  const money = entry.money.toJSON();
  return {
    id: entry.id,
    walletId: entry.walletId,
    transactionId: entry.transactionId,
    direction: entry.direction,
    moneyAmount: money.amount,
    moneyCurrency: money.currency,
    balanceBeforeAmount: entry.balanceBefore.toJSON().amount,
    balanceAfterAmount: entry.balanceAfter.toJSON().amount,
    createdAt: entry.createdAt,
  };
}

export function ledgerEntryToDomain(e: WalletLedgerEntryEntity): WalletLedgerEntry {
  const currency = e.moneyCurrency.trim();
  return WalletLedgerEntry.rehydrate({
    id: e.id,
    walletId: e.walletId,
    transactionId: e.transactionId,
    direction: e.direction as LedgerDirection,
    money: Money.from({ amount: e.moneyAmount, currency }),
    balanceBefore: Money.from({ amount: e.balanceBeforeAmount, currency }),
    balanceAfter: Money.from({ amount: e.balanceAfterAmount, currency }),
    createdAt: e.createdAt,
  });
}
