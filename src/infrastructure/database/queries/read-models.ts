import { Injectable } from '@nestjs/common';
import { MikroORM } from '@mikro-orm/postgresql';
import type { MoneyProps } from '../../../domain/money';
import { WalletEntity } from '../entities/wallet.entity';
import { WagerTransactionEntity } from '../entities/wager-transaction.entity';

export interface WalletView {
  id: string;
  playerId: string;
  balance: MoneyProps;
  version: number;
}

export interface LedgerEntryView {
  id: string;
  transactionId: string;
  direction: string;
  money: MoneyProps;
  balanceBefore: MoneyProps;
  balanceAfter: MoneyProps;
  createdAt: string;
}

export interface LedgerPage {
  entries: LedgerEntryView[];
  nextCursor: string | null;
}

export interface TransactionView {
  id: string;
  providerId: string;
  externalTransactionId: string;
  walletId: string;
  playerId: string;
  roundId: string;
  gameId: string;
  kind: string;
  money: MoneyProps;
  status: string;
  failureCode: string | null;
  referenceExternalTransactionId: string | null;
  balance: MoneyProps | null;
  createdAt: string;
  processedAt: string | null;
}

/** Cursor **opaco e estável**: base64url de `[createdAtISO, id]`. */
function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(JSON.stringify([createdAt.toISOString(), id])).toString('base64url');
}
function decodeCursor(cursor: string): { createdAt: string; id: string } | null {
  try {
    const [createdAt, id] = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as [
      string,
      string,
    ];
    if (typeof createdAt !== 'string' || typeof id !== 'string') return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}

@Injectable()
export class ReadModels {
  constructor(private readonly orm: MikroORM) {}

  private get em() {
    return this.orm.em.fork();
  }

  async getWallet(id: string): Promise<WalletView | null> {
    const e = await this.em.findOne(WalletEntity, { id });
    if (!e) return null;
    return {
      id: e.id,
      playerId: e.playerId,
      balance: { amount: e.balanceAmount, currency: e.currency.trim() },
      version: e.version,
    };
  }

  async getLedgerPage(walletId: string, cursor: string | undefined, limit: number): Promise<LedgerPage> {
    const decoded = cursor ? decodeCursor(cursor) : null;
    const params: unknown[] = [walletId];
    let where = 'wallet_id = ?';
    if (decoded) {
      where += ' and (created_at, id) > (?, ?)';
      params.push(decoded.createdAt, decoded.id);
    }
    params.push(limit + 1);

    const rows = (await this.em.getConnection().execute(
      `select id, transaction_id, direction, money_amount, money_currency,
              balance_before_amount, balance_after_amount, created_at
       from wallet_ledger_entry
       where ${where}
       order by created_at asc, id asc
       limit ?`,
      params,
    )) as Array<Record<string, string | Date>>;

    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    const entries: LedgerEntryView[] = page.map((r) => {
      const currency = String(r['money_currency']).trim();
      return {
        id: String(r['id']),
        transactionId: String(r['transaction_id']),
        direction: String(r['direction']),
        money: { amount: String(r['money_amount']), currency },
        balanceBefore: { amount: String(r['balance_before_amount']), currency },
        balanceAfter: { amount: String(r['balance_after_amount']), currency },
        createdAt: new Date(r['created_at'] as string).toISOString(),
      };
    });

    const last = page[page.length - 1];
    const nextCursor =
      hasMore && last ? encodeCursor(new Date(last['created_at'] as string), String(last['id'])) : null;
    return { entries, nextCursor };
  }

  async getTransaction(id: string): Promise<TransactionView | null> {
    return this.toView(await this.em.findOne(WagerTransactionEntity, { id }));
  }

  async getTransactionByProviderExternal(
    providerId: string,
    externalTransactionId: string,
  ): Promise<TransactionView | null> {
    return this.toView(
      await this.em.findOne(WagerTransactionEntity, { providerId, externalTransactionId }),
    );
  }

  private toView(e: WagerTransactionEntity | null): TransactionView | null {
    if (!e) return null;
    const currency = e.moneyCurrency.trim();
    return {
      id: e.id,
      providerId: e.providerId,
      externalTransactionId: e.externalTransactionId,
      walletId: e.walletId,
      playerId: e.playerId,
      roundId: e.roundId,
      gameId: e.gameId,
      kind: e.kind,
      money: { amount: e.moneyAmount, currency },
      status: e.status,
      failureCode: e.failureCode ?? null,
      referenceExternalTransactionId: e.referenceExternalTransactionId ?? null,
      balance: e.observedBalanceAmount != null ? { amount: e.observedBalanceAmount, currency } : null,
      createdAt: e.createdAt.toISOString(),
      processedAt: e.processedAt ? e.processedAt.toISOString() : null,
    };
  }
}
