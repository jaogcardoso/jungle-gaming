import { Money, type MoneyProps } from '../../domain/money';
import type { UnitOfWork } from '../ports';

export interface ReconcileWalletResult {
  walletId: string;
  storedBalance: MoneyProps;
  calculatedBalance: MoneyProps;
  difference: MoneyProps;
  consistent: boolean;
  checkedEntries: number;
}

export class WalletNotFoundError extends Error {
  constructor(walletId: string) {
    super(`Wallet ${walletId} não encontrada`);
    this.name = 'WalletNotFoundError';
  }
}

/** Compara o saldo materializado com a reconstrução pelo ledger (README §9). */
export class ReconcileWallet {
  constructor(private readonly uow: UnitOfWork) {}

  async execute(walletId: string): Promise<ReconcileWalletResult> {
    return this.uow.run(async (ctx) => {
      const wallet = await ctx.wallets.loadForUpdate(walletId);
      if (!wallet) {
        throw new WalletNotFoundError(walletId);
      }

      const { total, count } = await ctx.ledger.sumForWallet(walletId);
      const calculated = total ?? Money.zero(wallet.currency);
      const difference = wallet.balance.subtract(calculated);

      return {
        walletId,
        storedBalance: wallet.balance.toJSON(),
        calculatedBalance: calculated.toJSON(),
        difference: difference.toJSON(),
        consistent: difference.isZero(),
        checkedEntries: count,
      };
    });
  }
}
