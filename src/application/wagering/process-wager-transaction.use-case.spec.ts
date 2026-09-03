import { beforeEach, describe, expect, it } from 'bun:test';
import { Money } from '../../domain/money';
import { Wallet } from '../../domain/wallet';
import { FailureCode, WagerTransactionKind, WagerTransactionStatus } from '../../domain/wagering';
import { FakeClock, InMemoryUnitOfWork, SequentialIdGenerator } from '../../../test/fakes';
import { ProcessWagerTransaction } from './process-wager-transaction.use-case';
import type { ProcessWagerTransactionCommand } from './process-wager-transaction.command';
import { IdempotencyConflictError } from './process-wager-transaction.errors';

let uow: InMemoryUnitOfWork;
let clock: FakeClock;
let useCase: ProcessWagerTransaction;

function seedWallet(balance = '100.00'): void {
  const { wallet } = Wallet.open({
    id: 'wallet-1',
    playerId: 'player-1',
    initialBalance: Money.from({ amount: balance, currency: 'BRL' }),
    openingTransactionId: 'op',
    openingEntryId: 'op-e',
    now: clock.now(),
  });
  uow.wallets.set('wallet-1', wallet);
}

function command(over: Partial<ProcessWagerTransactionCommand> = {}): ProcessWagerTransactionCommand {
  return {
    source: 'http',
    idempotencyKey: 'provider-a:tx-1',
    providerId: 'provider-a',
    externalTransactionId: 'tx-1',
    playerId: 'player-1',
    walletId: 'wallet-1',
    roundId: 'round-1',
    gameId: 'game-1',
    kind: WagerTransactionKind.Bet,
    money: { amount: '80.00', currency: 'BRL' },
    ...over,
  };
}

const walletBalance = (): string => uow.wallets.get('wallet-1')!.balance.toJSON().amount;

beforeEach(() => {
  uow = new InMemoryUnitOfWork();
  clock = new FakeClock();
  useCase = new ProcessWagerTransaction(uow, clock, new SequentialIdGenerator(), 'test-consumer');
  seedWallet('100.00');
});

describe('BET', () => {
  it('processa: debita, gera 1 lançamento e 2 eventos', async () => {
    const result = await useCase.execute(command());

    expect(result.status).toBe(WagerTransactionStatus.Processed);
    expect(result.balance).toEqual({ amount: '20.00', currency: 'BRL' });
    expect(result.idempotentReplay).toBe(false);
    expect(walletBalance()).toBe('20.00');
    expect(uow.ledger).toHaveLength(1);
    expect(uow.transactions).toHaveLength(1);
    expect(uow.eventTypes()).toEqual(['WagerTransactionProcessed', 'WalletBalanceChanged']);
  });

  it('sem saldo: rejeita com INSUFFICIENT_FUNDS, sem lançamento, saldo intacto', async () => {
    const result = await useCase.execute(command({ money: { amount: '150.00', currency: 'BRL' } }));

    expect(result.status).toBe(WagerTransactionStatus.Rejected);
    expect(result.failureCode).toBe(FailureCode.InsufficientFunds);
    expect(result.balance).toBeNull();
    expect(walletBalance()).toBe('100.00');
    expect(uow.ledger).toHaveLength(0);
    expect(uow.eventTypes()).toEqual(['WagerTransactionRejected']);
  });
});

describe('WIN / LOSS', () => {
  it('WIN credita', async () => {
    const result = await useCase.execute(
      command({ kind: WagerTransactionKind.Win, money: { amount: '50.00', currency: 'BRL' } }),
    );
    expect(result.status).toBe(WagerTransactionStatus.Processed);
    expect(result.balance).toEqual({ amount: '150.00', currency: 'BRL' });
    expect(uow.ledger).toHaveLength(1);
  });

  it('LOSS: processa sem mover saldo, sem lançamento, sem WalletBalanceChanged', async () => {
    const result = await useCase.execute(
      command({ kind: WagerTransactionKind.Loss, money: { amount: '50.00', currency: 'BRL' } }),
    );
    expect(result.status).toBe(WagerTransactionStatus.Processed);
    expect(result.balance).toEqual({ amount: '100.00', currency: 'BRL' });
    expect(uow.ledger).toHaveLength(0);
    expect(uow.eventTypes()).toEqual(['WagerTransactionProcessed']);
  });
});

describe('idempotência', () => {
  it('replay: 2ª chamada idêntica devolve o resultado ORIGINAL, sem reaplicar', async () => {
    const first = await useCase.execute(command());
    const second = await useCase.execute(command());

    expect(second.idempotentReplay).toBe(true);
    expect(second.transactionId).toBe(first.transactionId);
    expect(second.balance).toEqual({ amount: '20.00', currency: 'BRL' });
    expect(walletBalance()).toBe('20.00'); 
    expect(uow.ledger).toHaveLength(1);
    expect(uow.transactions).toHaveLength(1);
  });

  it('replay de uma REJECTED também devolve o resultado original', async () => {
    await useCase.execute(command({ money: { amount: '150.00', currency: 'BRL' } }));
    const replay = await useCase.execute(command({ money: { amount: '150.00', currency: 'BRL' } }));
    expect(replay.idempotentReplay).toBe(true);
    expect(replay.status).toBe(WagerTransactionStatus.Rejected);
    expect(replay.failureCode).toBe(FailureCode.InsufficientFunds);
  });

  it('conflito: mesma key + payload diferente lança IdempotencyConflictError e não altera nada', async () => {
    await useCase.execute(command());
    await expect(
      useCase.execute(command({ money: { amount: '90.00', currency: 'BRL' } })),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);

    expect(walletBalance()).toBe('20.00');
    expect(uow.transactions).toHaveLength(1);
    expect(uow.ledger).toHaveLength(1);
  });
});

describe('dedup por inbox (source = sqs)', () => {
  it('a mesma mensagem processada 2x debita uma vez só', async () => {
    const msg = command({ source: 'sqs', messageId: 'msg-1' });
    const first = await useCase.execute(msg);
    const second = await useCase.execute(msg);

    expect(first.status).toBe(WagerTransactionStatus.Processed);
    expect(second.idempotentReplay).toBe(true);
    expect(walletBalance()).toBe('20.00');
    expect(uow.ledger).toHaveLength(1);
  });
});

describe('referência (REFUND / ROLLBACK)', () => {
  it('REFUND sem referenceExternalTransactionId: REJECTED REFERENCE_REQUIRED', async () => {
    const result = await useCase.execute(
      command({ kind: WagerTransactionKind.Refund, idempotencyKey: 'k:refund' }),
    );
    expect(result.status).toBe(WagerTransactionStatus.Rejected);
    expect(result.failureCode).toBe(FailureCode.ReferenceRequired);
  });

  it('ROLLBACK com referência inexistente: PENDING_REFERENCE, saldo intacto', async () => {
    const result = await useCase.execute(
      command({
        kind: WagerTransactionKind.Rollback,
        idempotencyKey: 'k:rb',
        externalTransactionId: 'rb-1',
        referenceExternalTransactionId: 'nao-existe',
      }),
    );
    expect(result.status).toBe(WagerTransactionStatus.PendingReference);
    expect(result.balance).toBeNull();
    expect(walletBalance()).toBe('100.00');
    expect(uow.eventTypes()).toEqual(['WagerTransactionPendingReference']);
  });

  it('ROLLBACK de uma BET PROCESSED: credita de volta (sentido invertido)', async () => {
    await useCase.execute(
      command({ idempotencyKey: 'k:bet', externalTransactionId: 'bet-1' }), 
    );
    const result = await useCase.execute(
      command({
        kind: WagerTransactionKind.Rollback,
        idempotencyKey: 'k:rb',
        externalTransactionId: 'rb-1',
        referenceExternalTransactionId: 'bet-1',
        money: { amount: '80.00', currency: 'BRL' },
      }),
    );

    expect(result.status).toBe(WagerTransactionStatus.Processed);
    expect(result.balance).toEqual({ amount: '100.00', currency: 'BRL' });
    expect(walletBalance()).toBe('100.00');
    expect(uow.ledger).toHaveLength(2); 
  });
});

describe('moeda', () => {
  it('moeda da operação diferente da wallet: REJECTED CURRENCY_MISMATCH', async () => {
    const result = await useCase.execute(
      command({ money: { amount: '80.00', currency: 'USD' } }),
    );
    expect(result.status).toBe(WagerTransactionStatus.Rejected);
    expect(result.failureCode).toBe(FailureCode.CurrencyMismatch);
    expect(walletBalance()).toBe('100.00');
  });
});
