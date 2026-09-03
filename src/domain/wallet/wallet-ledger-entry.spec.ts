import { describe, expect, it } from 'bun:test';
import { Money } from '../money';
import { LedgerDirection } from '../shared/ledger-direction';
import { WalletLedgerEntry } from './wallet-ledger-entry';
import { InvalidLedgerEntryError } from './wallet.errors';

const brl = (amount: string): Money => Money.from({ amount, currency: 'BRL' });

const baseProps = {
  id: 'entry-1',
  walletId: 'wallet-1',
  transactionId: 'tx-1',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
};

describe('WalletLedgerEntry.create — validação da aritmética', () => {
  it('aceita um DEBIT que fecha: 100 - 80 = 20', () => {
    const entry = WalletLedgerEntry.create({
      ...baseProps,
      direction: LedgerDirection.Debit,
      money: brl('80.00'),
      balanceBefore: brl('100.00'),
      balanceAfter: brl('20.00'),
    });
    expect(entry.isBalanced()).toBe(true);
  });

  it('aceita um CREDIT que fecha: 20 + 80 = 100', () => {
    const entry = WalletLedgerEntry.create({
      ...baseProps,
      direction: LedgerDirection.Credit,
      money: brl('80.00'),
      balanceBefore: brl('20.00'),
      balanceAfter: brl('100.00'),
    });
    expect(entry.isBalanced()).toBe(true);
  });

  it('rejeita quando a aritmética não fecha', () => {
    expect(() =>
      WalletLedgerEntry.create({
        ...baseProps,
        direction: LedgerDirection.Debit,
        money: brl('80.00'),
        balanceBefore: brl('100.00'),
        balanceAfter: brl('30.00'), 
      }),
    ).toThrow(InvalidLedgerEntryError);
  });

  it('rejeita valor não positivo', () => {
    expect(() =>
      WalletLedgerEntry.create({
        ...baseProps,
        direction: LedgerDirection.Credit,
        money: brl('0.00'),
        balanceBefore: brl('10.00'),
        balanceAfter: brl('10.00'),
      }),
    ).toThrow(InvalidLedgerEntryError);
  });

  it('rejeita moedas divergentes', () => {
    expect(() =>
      WalletLedgerEntry.create({
        ...baseProps,
        direction: LedgerDirection.Credit,
        money: brl('10.00'),
        balanceBefore: brl('10.00'),
        balanceAfter: Money.from({ amount: '20.00', currency: 'USD' }),
      }),
    ).toThrow(InvalidLedgerEntryError);
  });
});

describe('WalletLedgerEntry — imutabilidade', () => {
  it('a instância é congelada e não tem métodos de transição', () => {
    const entry = WalletLedgerEntry.create({
      ...baseProps,
      direction: LedgerDirection.Debit,
      money: brl('1.00'),
      balanceBefore: brl('1.00'),
      balanceAfter: brl('0.00'),
    });
    expect(Object.isFrozen(entry)).toBe(true);
  });
});

describe('WalletLedgerEntry.rehydrate — não revalida', () => {
  it('reconstrói mesmo um estado que create rejeitaria', () => {
    const entry = WalletLedgerEntry.rehydrate({
      ...baseProps,
      direction: LedgerDirection.Debit,
      money: brl('80.00'),
      balanceBefore: brl('100.00'),
      balanceAfter: brl('999.00'), 
    });
    expect(entry.isBalanced()).toBe(false);
  });
});
