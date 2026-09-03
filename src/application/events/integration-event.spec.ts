import { describe, expect, it } from 'bun:test';
import { LedgerDirection } from '../../domain/shared/ledger-direction';
import { WalletBalanceChanged } from './wagering-events';

describe('IntegrationEvent envelope', () => {
  it('toJSON serializa o envelope com eventType/version no tipo e occurredAt ISO', () => {
    const occurredAt = new Date('2026-02-02T10:00:00.000Z');
    const evt = new WalletBalanceChanged({
      eventId: 'evt-1',
      aggregateId: 'wallet-1',
      correlationId: 'corr-1',
      causationId: 'msg-1',
      occurredAt,
      data: {
        walletId: 'wallet-1',
        transactionId: 'tx-1',
        direction: LedgerDirection.Debit,
        money: { amount: '80.00', currency: 'BRL' },
        balanceBefore: { amount: '100.00', currency: 'BRL' },
        balanceAfter: { amount: '20.00', currency: 'BRL' },
        walletVersion: 2,
      },
    });

    expect(evt.toJSON()).toEqual({
      eventId: 'evt-1',
      eventType: 'WalletBalanceChanged',
      aggregateId: 'wallet-1',
      correlationId: 'corr-1',
      causationId: 'msg-1',
      occurredAt: '2026-02-02T10:00:00.000Z',
      version: 1,
      data: {
        walletId: 'wallet-1',
        transactionId: 'tx-1',
        direction: LedgerDirection.Debit,
        money: { amount: '80.00', currency: 'BRL' },
        balanceBefore: { amount: '100.00', currency: 'BRL' },
        balanceAfter: { amount: '20.00', currency: 'BRL' },
        walletVersion: 2,
      },
    });
  });

  it('toOutboxInput extrai o que vai para a tabela', () => {
    const evt = new WalletBalanceChanged({
      eventId: 'e',
      aggregateId: 'wallet-9',
      correlationId: 'c',
      occurredAt: new Date('2026-01-01T00:00:00.000Z'),
      data: {
        walletId: 'wallet-9',
        transactionId: 't',
        direction: LedgerDirection.Credit,
        money: { amount: '1.00', currency: 'BRL' },
        balanceBefore: { amount: '0.00', currency: 'BRL' },
        balanceAfter: { amount: '1.00', currency: 'BRL' },
        walletVersion: 2,
      },
    });
    const out = evt.toOutboxInput();
    expect(out.aggregateId).toBe('wallet-9');
    expect(out.eventType).toBe('WalletBalanceChanged');
    expect((out.payload as { eventType: string }).eventType).toBe('WalletBalanceChanged');
  });
});
