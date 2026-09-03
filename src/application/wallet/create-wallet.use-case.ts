import { Money, type MoneyProps } from '../../domain/money';
import { LedgerDirection } from '../../domain/shared/ledger-direction';
import { Wallet } from '../../domain/wallet';
import { WagerTransaction, WagerTransactionKind } from '../../domain/wagering';
import type { Clock, IdGenerator, UnitOfWork } from '../ports';
import { WagerTransactionProcessed, WalletBalanceChanged } from '../events';

export interface CreateWalletCommand {
  playerId: string;
  initialBalance: MoneyProps;
}

export interface CreateWalletResult {
  id: string;
  playerId: string;
  balance: MoneyProps;
  version: number;
}

/** Cria a wallet. */
export class CreateWallet {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async execute(command: CreateWalletCommand): Promise<CreateWalletResult> {
    const now = this.clock.now();
    const initialBalance = Money.from(command.initialBalance);
    const openingTransactionId = this.ids.next();

    const { wallet, openingEntry } = Wallet.open({
      id: this.ids.next(),
      playerId: command.playerId,
      initialBalance,
      openingTransactionId,
      openingEntryId: this.ids.next(),
      now,
    });

    return this.uow.run(async (ctx) => {
      await ctx.wallets.insert(wallet);

      if (openingEntry) {
        const opening = WagerTransaction.opening({
          id: openingTransactionId,
          walletId: wallet.id,
          playerId: wallet.playerId,
          money: initialBalance,
          createdAt: now,
          observedBalance: wallet.balance,
        });
        await ctx.transactions.insert(opening);
        await ctx.ledger.insert(openingEntry);

        const base = { aggregateId: wallet.id, correlationId: wallet.id, occurredAt: now };
        await ctx.outbox.enqueue([
          new WagerTransactionProcessed({
            ...base,
            eventId: this.ids.next(),
            data: {
              transactionId: opening.id,
              providerId: 'internal',
              externalTransactionId: `opening:${wallet.id}`,
              kind: WagerTransactionKind.Opening,
              walletId: wallet.id,
              money: initialBalance.toJSON(),
            },
          }).toOutboxInput(),
          new WalletBalanceChanged({
            ...base,
            eventId: this.ids.next(),
            data: {
              walletId: wallet.id,
              transactionId: opening.id,
              direction: LedgerDirection.Credit,
              money: initialBalance.toJSON(),
              balanceBefore: Money.zero(wallet.currency).toJSON(),
              balanceAfter: wallet.balance.toJSON(),
              walletVersion: wallet.version,
            },
          }).toOutboxInput(),
        ]);
      }

      return {
        id: wallet.id,
        playerId: wallet.playerId,
        balance: wallet.balance.toJSON(),
        version: wallet.version,
      };
    });
  }
}
