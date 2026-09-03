import { describe, expect, it } from 'bun:test';
import { canonicalize, computePayloadHash, type PayloadHashInput } from './payload-hash';

const base: PayloadHashInput = {
  providerId: 'provider-a',
  externalTransactionId: 'tx-123',
  playerId: 'player-1',
  walletId: 'wallet-1',
  roundId: 'round-1',
  gameId: 'game-1',
  kind: 'BET',
  money: { amount: '25.00', currency: 'BRL' },
};

describe('canonicalize', () => {
  it('ordena as chaves — ordem de escrita não importa', () => {
    expect(canonicalize({ b: 1, a: 2 })).toBe(canonicalize({ a: 2, b: 1 }));
    expect(canonicalize({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  it('ordena recursivamente e descarta undefined', () => {
    expect(canonicalize({ x: { d: 4, c: 3 }, y: undefined })).toBe('{"x":{"c":3,"d":4}}');
  });

  it('preserva a ordem de arrays', () => {
    expect(canonicalize([3, 1, 2])).toBe('[3,1,2]');
  });
});

describe('computePayloadHash', () => {
  it('é estável para o mesmo conteúdo em ordem diferente', () => {
    const reordered: PayloadHashInput = {
      money: { currency: 'BRL', amount: '25.00' },
      kind: 'BET',
      gameId: 'game-1',
      roundId: 'round-1',
      walletId: 'wallet-1',
      playerId: 'player-1',
      externalTransactionId: 'tx-123',
      providerId: 'provider-a',
    };
    expect(computePayloadHash(base)).toBe(computePayloadHash(reordered));
  });

  it('normaliza a escala do dinheiro: "25" e "25.00" dão o mesmo hash', () => {
    expect(computePayloadHash({ ...base, money: { amount: '25', currency: 'BRL' } })).toBe(
      computePayloadHash({ ...base, money: { amount: '25.00', currency: 'BRL' } }),
    );
  });

  it('muda quando um campo de negócio muda', () => {
    expect(computePayloadHash(base)).not.toBe(
      computePayloadHash({ ...base, money: { amount: '25.01', currency: 'BRL' } }),
    );
    expect(computePayloadHash(base)).not.toBe(
      computePayloadHash({ ...base, kind: 'WIN' }),
    );
  });

  it('é um hex SHA-256 (64 chars)', () => {
    expect(computePayloadHash(base)).toMatch(/^[0-9a-f]{64}$/);
  });
});
