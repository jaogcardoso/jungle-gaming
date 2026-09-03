import { describe, expect, it } from 'bun:test';
import { Money } from '../money';
import { CurrencyMismatchError } from '../money';
import { LedgerDirection } from '../shared/ledger-direction';
import { Wallet, type WalletMovementContext } from './wallet';
import { InsufficientBalanceError, InvalidInitialBalanceError, NonPositiveMovementError } from './wallet.errors';

const brl = (amount: string): Money => Money.from({ amount, currency: 'BRL' });
const now = new Date('2026-01-01T00:00:00.000Z');

const ctx = (over: Partial<WalletMovementContext> = {}): WalletMovementContext => ({
  transactionId: 'tx-1',
  entryId: 'entry-1',
  occurredAt: now,
  ...over,
});

const openWith = (amount: string) =>
  Wallet.open({
    id: 'wallet-1',
    playerId: 'player-1',
    initialBalance: brl(amount),
    openingTransactionId: 'opening-tx',
    openingEntryId: 'opening-entry',
    now,
  });

describe('Wallet.open', () => {
  it('saldo inicial zero: versão 1, sem lançamento de abertura', () => {
    const { wallet, openingEntry } = openWith('0.00');
    expect(wallet.balance.toJSON().amount).toBe('0.00');
    expect(wallet.version).toBe(1);
    expect(openingEntry).toBeNull();
  });

  it('saldo inicial positivo: versão 1 e lançamento CREDIT de abertura (0 -> saldo)', () => {
    const { wallet, openingEntry } = openWith('1000.00');
    expect(wallet.balance.toJSON().amount).toBe('1000.00');
    expect(wallet.version).toBe(1); 
    expect(openingEntry).not.toBeNull();
    expect(openingEntry?.direction).toBe(LedgerDirection.Credit);
    expect(openingEntry?.balanceBefore.toJSON().amount).toBe('0.00');
    expect(openingEntry?.balanceAfter.toJSON().amount).toBe('1000.00');
    expect(openingEntry?.isBalanced()).toBe(true);
  });

  it('deriva a moeda do saldo inicial', () => {
    const { wallet } = Wallet.open({
      id: 'w',
      playerId: 'p',
      initialBalance: Money.from({ amount: '10.00', currency: 'USD' }),
      openingTransactionId: 't',
      openingEntryId: 'e',
      now,
    });
    expect(wallet.currency).toBe('USD');
  });

  it('rejeita saldo inicial negativo', () => {
    expect(() =>
      Wallet.open({
        id: 'w',
        playerId: 'p',
        initialBalance: brl('10.00').negate(),
        openingTransactionId: 't',
        openingEntryId: 'e',
        now,
      }),
    ).toThrow(InvalidInitialBalanceError);
  });
});

describe('Wallet.debit / credit — invariantes', () => {
  it('debit devolve o lançamento DEBIT e atualiza saldo, versão e updatedAt', () => {
    const { wallet } = openWith('100.00');
    const at = new Date('2026-02-02T10:00:00.000Z');

    const entry = wallet.debit(brl('30.00'), ctx({ occurredAt: at }));

    expect(wallet.balance.toJSON().amount).toBe('70.00');
    expect(wallet.version).toBe(2); 
    expect(wallet.updatedAt).toEqual(at);
    expect(entry.direction).toBe(LedgerDirection.Debit);
    expect(entry.balanceBefore.toJSON().amount).toBe('100.00');
    expect(entry.balanceAfter.toJSON().amount).toBe('70.00');
    expect(entry.isBalanced()).toBe(true);
  });

  it('credit devolve o lançamento CREDIT e incrementa a versão', () => {
    const { wallet } = openWith('100.00');
    const entry = wallet.credit(brl('25.00'), ctx());
    expect(wallet.balance.toJSON().amount).toBe('125.00');
    expect(wallet.version).toBe(2);
    expect(entry.direction).toBe(LedgerDirection.Credit);
  });

  it('saldo NUNCA fica negativo: debit acima do saldo lança e não altera nada', () => {
    const { wallet } = openWith('100.00');
    expect(() => wallet.debit(brl('100.01'), ctx())).toThrow(InsufficientBalanceError);
    expect(wallet.balance.toJSON().amount).toBe('100.00'); 
    expect(wallet.version).toBe(1); 
  });

  it('debit exatamente igual ao saldo é permitido (zera)', () => {
    const { wallet } = openWith('80.00');
    wallet.debit(brl('80.00'), ctx());
    expect(wallet.balance.isZero()).toBe(true);
  });

  it('moeda da operação deve ser igual à da wallet', () => {
    const { wallet } = openWith('100.00');
    expect(() => wallet.debit(Money.from({ amount: '10.00', currency: 'USD' }), ctx())).toThrow(
      CurrencyMismatchError,
    );
  });

  it('rejeita movimentação de valor zero', () => {
    const { wallet } = openWith('100.00');
    expect(() => wallet.credit(brl('0.00'), ctx())).toThrow(NonPositiveMovementError);
  });

  it('cenário do README §8: 100 - 80 - 80 => segunda rejeita, saldo final 20', () => {
    const { wallet } = openWith('100.00');
    wallet.debit(brl('80.00'), ctx({ transactionId: 'a', entryId: 'ea' }));
    expect(() => wallet.debit(brl('80.00'), ctx({ transactionId: 'b', entryId: 'eb' }))).toThrow(
      InsufficientBalanceError,
    );
    expect(wallet.balance.toJSON().amount).toBe('20.00');
    expect(wallet.version).toBe(2); 
  });
});

describe('Wallet.rehydrate — não revalida', () => {
  it('reconstrói a partir do estado persistido', () => {
    const wallet = Wallet.rehydrate({
      id: 'w',
      playerId: 'p',
      currency: 'BRL',
      balance: brl('42.00'),
      version: 7,
      createdAt: now,
      updatedAt: now,
    });
    expect(wallet.balance.toJSON().amount).toBe('42.00');
    expect(wallet.version).toBe(7);
  });
});
