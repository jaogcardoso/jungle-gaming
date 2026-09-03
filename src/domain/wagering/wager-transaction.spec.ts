import { describe, expect, it } from 'bun:test';
import { Money } from '../money';
import { LedgerDirection } from '../shared/ledger-direction';
import { FailureCode } from './failure-code';
import { WagerTransaction, type CreateWagerTransactionProps } from './wager-transaction';
import { WagerTransactionKind } from './wager-transaction-kind';
import { WagerTransactionStatus } from './wager-transaction-status';
import {
  InvalidTransactionStateError,
  LedgerDirectionNotApplicableError,
  OpeningNotSubmittableError,
  ReferenceAmountMismatchError,
  ReferenceKindNotAllowedError,
  ReferenceMismatchError,
  ReferenceNotProcessedError,
  ReferenceRequiredError,
} from './wagering.errors';

const brl = (amount: string): Money => Money.from({ amount, currency: 'BRL' });
const at = new Date('2026-01-01T00:00:00.000Z');

let seq = 0;
function make(
  kind: WagerTransactionKind,
  over: Partial<CreateWagerTransactionProps> = {},
): WagerTransaction {
  seq += 1;
  return WagerTransaction.create({
    id: `tx-${seq}`,
    providerId: 'provider-a',
    externalTransactionId: `ext-${seq}`,
    idempotencyKey: `provider-a:ext-${seq}`,
    payloadHash: 'hash-1',
    walletId: 'wallet-1',
    playerId: 'player-1',
    roundId: 'round-1',
    gameId: 'game-1',
    kind,
    money: brl('80.00'),
    createdAt: at,
    ...over,
  });
}

/** Uma BET já aplicada, pronta para ser referenciada por REFUND/ROLLBACK. */
function processedBet(over: Partial<CreateWagerTransactionProps> = {}): WagerTransaction {
  const bet = make(WagerTransactionKind.Bet, over);
  bet.markProcessed(undefined, at);
  return bet;
}

describe('WagerTransaction.create', () => {
  it('nasce em PENDING', () => {
    expect(make(WagerTransactionKind.Bet).status).toBe(WagerTransactionStatus.Pending);
  });

  it('rejeita kind OPENING (interno, não submetível)', () => {
    expect(() => make(WagerTransactionKind.Opening)).toThrow(OpeningNotSubmittableError);
  });

  it('REFUND/ROLLBACK sem referência: nasce PENDING (a rejeição é responsabilidade do caso de uso)', () => {
    const refund = make(WagerTransactionKind.Refund);
    expect(refund.status).toBe(WagerTransactionStatus.Pending);
    expect(refund.requiresReference()).toBe(true);
    expect(make(WagerTransactionKind.Rollback).requiresReference()).toBe(true);
  });

  it('BET / WIN / LOSS não exigem referência', () => {
    for (const kind of [
      WagerTransactionKind.Bet,
      WagerTransactionKind.Win,
      WagerTransactionKind.Loss,
    ]) {
      expect(make(kind).status).toBe(WagerTransactionStatus.Pending);
    }
  });
});

describe('consultas de domínio', () => {
  it('affectsBalance é false só para LOSS', () => {
    expect(make(WagerTransactionKind.Loss).affectsBalance()).toBe(false);
    expect(make(WagerTransactionKind.Bet).affectsBalance()).toBe(true);
    expect(make(WagerTransactionKind.Win).affectsBalance()).toBe(true);
  });

  it('requiresReference é true para REFUND e ROLLBACK', () => {
    expect(
      make(WagerTransactionKind.Refund, { referenceExternalTransactionId: 'x' }).requiresReference(),
    ).toBe(true);
    expect(
      make(WagerTransactionKind.Rollback, {
        referenceExternalTransactionId: 'x',
      }).requiresReference(),
    ).toBe(true);
    expect(make(WagerTransactionKind.Bet).requiresReference()).toBe(false);
  });

  it('matchesPayload compara o hash', () => {
    const tx = make(WagerTransactionKind.Bet, { payloadHash: 'abc' });
    expect(tx.matchesPayload('abc')).toBe(true);
    expect(tx.matchesPayload('xyz')).toBe(false);
  });

  describe('ledgerDirectionFor', () => {
    it('BET -> DEBIT', () => {
      expect(make(WagerTransactionKind.Bet).ledgerDirectionFor()).toBe(LedgerDirection.Debit);
    });

    it('WIN e REFUND -> CREDIT', () => {
      expect(make(WagerTransactionKind.Win).ledgerDirectionFor()).toBe(LedgerDirection.Credit);
      expect(
        make(WagerTransactionKind.Refund, { referenceExternalTransactionId: 'x' }).ledgerDirectionFor(),
      ).toBe(LedgerDirection.Credit);
    });

    it('ROLLBACK inverte o sentido da referência', () => {
      const rollback = make(WagerTransactionKind.Rollback, {
        referenceExternalTransactionId: 'x',
      });
      expect(rollback.ledgerDirectionFor(make(WagerTransactionKind.Bet))).toBe(
        LedgerDirection.Credit,
      );
      expect(rollback.ledgerDirectionFor(make(WagerTransactionKind.Win))).toBe(
        LedgerDirection.Debit,
      );
    });

    it('ROLLBACK sem referência lança', () => {
      expect(() =>
        make(WagerTransactionKind.Rollback, { referenceExternalTransactionId: 'x' }).ledgerDirectionFor(),
      ).toThrow(ReferenceRequiredError);
    });

    it('LOSS não tem lançamento', () => {
      expect(() => make(WagerTransactionKind.Loss).ledgerDirectionFor()).toThrow(
        LedgerDirectionNotApplicableError,
      );
    });
  });
});

describe('máquina de estados', () => {
  it('PENDING -> markProcessed -> PROCESSED (grava processedAt e referenceTransactionId)', () => {
    const tx = make(WagerTransactionKind.Bet);
    const when = new Date('2026-03-03T12:00:00.000Z');
    tx.markProcessed('ref-tx-99', when);
    expect(tx.status).toBe(WagerTransactionStatus.Processed);
    expect(tx.processedAt).toEqual(when);
    expect(tx.referenceTransactionId).toBe('ref-tx-99');
    expect(tx.isTerminal()).toBe(true);
  });

  it('PENDING -> reject -> REJECTED (grava failureCode)', () => {
    const tx = make(WagerTransactionKind.Bet);
    tx.reject(FailureCode.InsufficientFunds);
    expect(tx.status).toBe(WagerTransactionStatus.Rejected);
    expect(tx.failureCode).toBe(FailureCode.InsufficientFunds);
    expect(tx.isTerminal()).toBe(true);
  });

  it('PENDING -> fail -> FAILED', () => {
    const tx = make(WagerTransactionKind.Bet);
    tx.fail(FailureCode.PermanentInfrastructureError);
    expect(tx.status).toBe(WagerTransactionStatus.Failed);
    expect(tx.failureCode).toBe(FailureCode.PermanentInfrastructureError);
  });

  it('PENDING -> markPendingReference -> PENDING_REFERENCE -> markProcessed -> PROCESSED', () => {
    const tx = make(WagerTransactionKind.Rollback, { referenceExternalTransactionId: 'x' });
    tx.markPendingReference();
    expect(tx.status).toBe(WagerTransactionStatus.PendingReference);
    expect(tx.isTerminal()).toBe(false);
    tx.markProcessed('ref-1', at);
    expect(tx.status).toBe(WagerTransactionStatus.Processed);
  });

  it('estado terminal não transiciona mais (erro de programação)', () => {
    const processed = make(WagerTransactionKind.Bet);
    processed.markProcessed(undefined, at);
    expect(() => processed.markProcessed(undefined, at)).toThrow(InvalidTransactionStateError);
    expect(() => processed.reject(FailureCode.InsufficientFunds)).toThrow(
      InvalidTransactionStateError,
    );

    const rejected = make(WagerTransactionKind.Bet);
    rejected.reject(FailureCode.InsufficientFunds);
    expect(() => rejected.markProcessed(undefined, at)).toThrow(InvalidTransactionStateError);
  });

  it('markPendingReference só a partir de PENDING', () => {
    const tx = make(WagerTransactionKind.Rollback, { referenceExternalTransactionId: 'x' });
    tx.markPendingReference();
    expect(() => tx.markPendingReference()).toThrow(InvalidTransactionStateError);
  });
});

describe('assertCanReference', () => {
  const refExt = { referenceExternalTransactionId: 'bet-ext' };

  it('ROLLBACK sobre BET PROCESSED, mesmo contexto e mesmo valor: ok', () => {
    const rollback = make(WagerTransactionKind.Rollback, refExt);
    expect(() => rollback.assertCanReference(processedBet())).not.toThrow();
  });

  it('referência não PROCESSED -> ReferenceNotProcessedError', () => {
    const rollback = make(WagerTransactionKind.Rollback, refExt);
    const pendingBet = make(WagerTransactionKind.Bet);
    expect(() => rollback.assertCanReference(pendingBet)).toThrow(ReferenceNotProcessedError);
  });

  it('REFUND só referencia BET; apontar para WIN -> ReferenceKindNotAllowedError', () => {
    const refund = make(WagerTransactionKind.Refund, refExt);
    const processedWin = make(WagerTransactionKind.Win);
    processedWin.markProcessed(undefined, at);
    expect(() => refund.assertCanReference(processedWin)).toThrow(ReferenceKindNotAllowedError);
  });

  it('contexto divergente (walletId) -> ReferenceMismatchError', () => {
    const rollback = make(WagerTransactionKind.Rollback, refExt);
    const otherWalletBet = processedBet({ walletId: 'wallet-OUTRA' });
    expect(() => rollback.assertCanReference(otherWalletBet)).toThrow(ReferenceMismatchError);
  });

  it('valor diferente da referência -> ReferenceAmountMismatchError', () => {
    const rollback = make(WagerTransactionKind.Rollback, { ...refExt, money: brl('50.00') });
    expect(() => rollback.assertCanReference(processedBet())).toThrow(ReferenceAmountMismatchError);
  });

  it('operação que não exige referência: no-op (não lança)', () => {
    const bet = make(WagerTransactionKind.Bet);
    expect(() => bet.assertCanReference(processedBet())).not.toThrow();
  });
});

describe('WagerTransaction.rehydrate — não revalida', () => {
  it('reconstrói direto em estado terminal', () => {
    const tx = WagerTransaction.rehydrate({
      id: 'tx-r',
      providerId: 'provider-a',
      externalTransactionId: 'ext-r',
      idempotencyKey: 'provider-a:ext-r',
      payloadHash: 'h',
      walletId: 'w',
      playerId: 'p',
      roundId: 'r',
      gameId: 'g',
      kind: WagerTransactionKind.Bet,
      money: brl('10.00'),
      createdAt: at,
      status: WagerTransactionStatus.Processed,
      processedAt: at,
    });
    expect(tx.status).toBe(WagerTransactionStatus.Processed);
    expect(tx.isTerminal()).toBe(true);
  });
});
