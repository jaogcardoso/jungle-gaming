import { describe, expect, it } from 'bun:test';
import { Money } from './money';
import { CurrencyMismatchError, InvalidMoneyError } from './money.errors';

const brl = (amount: string): Money => Money.from({ amount, currency: 'BRL' });

describe('Money.from — contrato de entrada', () => {
  it('normaliza a escala para 2 casas', () => {
    expect(brl('25').toJSON()).toEqual({ amount: '25.00', currency: 'BRL' });
    expect(brl('25.5').toJSON()).toEqual({ amount: '25.50', currency: 'BRL' });
    expect(brl('25.55').toJSON()).toEqual({ amount: '25.55', currency: 'BRL' });
    expect(brl('0').toJSON()).toEqual({ amount: '0.00', currency: 'BRL' });
  });

  it.each([
    ['string vazia', ''],
    ['só espaços', '   '],
    ['3 casas decimais', '25.001'],
    ['notação científica minúscula', '1e2'],
    ['notação científica maiúscula', '1E2'],
    ['notação científica com fração', '2.5e3'],
    ['NaN textual', 'NaN'],
    ['Infinity textual', 'Infinity'],
    ['negativo', '-5.00'],
    ['sinal de mais', '+5.00'],
    ['ponto sem casas', '5.'],
    ['sem parte inteira', '.5'],
    ['vírgula como separador', '12,50'],
    ['texto', 'abc'],
    ['espaço no fim', '25.00 '],
  ])('rejeita amount inválido: %s', (_label, amount) => {
    expect(() => brl(amount)).toThrow(InvalidMoneyError);
  });

  it('rejeita amount que não é string', () => {
    expect(() => Money.from({ amount: 25 as unknown as string, currency: 'BRL' })).toThrow(
      InvalidMoneyError,
    );
  });

  it.each([
    ['minúsculas', 'brl'],
    ['2 letras', 'BR'],
    ['4 letras', 'BRLL'],
    ['vazia', ''],
    ['símbolo', 'R$'],
    ['com dígito', 'BR1'],
  ])('rejeita currency inválida: %s', (_label, currency) => {
    expect(() => Money.from({ amount: '10.00', currency })).toThrow(InvalidMoneyError);
  });
});

describe('Money.zero', () => {
  it('cria valor zero na moeda pedida', () => {
    const z = Money.zero('BRL');
    expect(z.toJSON()).toEqual({ amount: '0.00', currency: 'BRL' });
    expect(z.isZero()).toBe(true);
  });

  it('valida a moeda', () => {
    expect(() => Money.zero('xxx')).toThrow(InvalidMoneyError);
  });
});

describe('imutabilidade', () => {
  it('add/subtract/negate não alteram a instância original', () => {
    const original = brl('25.00');
    original.add(brl('10.00'));
    original.subtract(brl('5.00'));
    original.negate();
    expect(original.toJSON().amount).toBe('25.00');
  });

  it('a instância é congelada', () => {
    expect(Object.isFrozen(brl('1.00'))).toBe(true);
  });
});

describe('aritmética exata (sem erro de ponto flutuante)', () => {
  it('0.10 + 0.20 === 0.30', () => {
    expect(brl('0.10').add(brl('0.20')).toJSON().amount).toBe('0.30');
  });

  it('soma e subtração comuns', () => {
    expect(brl('25.00').add(brl('0.10')).toJSON().amount).toBe('25.10');
    expect(brl('100.00').subtract(brl('80.00')).toJSON().amount).toBe('20.00');
  });

  it('subtração pode resultar negativo (uso interno, não contrato de entrada)', () => {
    const r = brl('20.00').subtract(brl('80.00'));
    expect(r.toJSON().amount).toBe('-60.00');
    expect(r.isNegative()).toBe(true);
  });

  it('negate é involutivo', () => {
    expect(brl('25.00').negate().toJSON().amount).toBe('-25.00');
    expect(brl('25.00').negate().negate().toJSON().amount).toBe('25.00');
  });
});

describe('predicados', () => {
  it('isZero / isPositive / isNegative', () => {
    expect(brl('0').isZero()).toBe(true);
    expect(brl('0').isPositive()).toBe(false);
    expect(brl('0').isNegative()).toBe(false);

    expect(brl('0.01').isPositive()).toBe(true);
    expect(brl('5.00').negate().isNegative()).toBe(true);
  });

  it('isLessThan ordena valores da mesma moeda', () => {
    expect(brl('20.00').isLessThan(brl('80.00'))).toBe(true);
    expect(brl('80.00').isLessThan(brl('20.00'))).toBe(false);
    expect(brl('20.00').isLessThan(brl('20.00'))).toBe(false);
  });

  it('equals compara valor e moeda', () => {
    expect(brl('10.00').equals(brl('10.00'))).toBe(true);
    expect(brl('10.00').equals(brl('10.01'))).toBe(false);
    expect(brl('10.5').equals(brl('10.50'))).toBe(true);
  });
});

describe('conflito de moeda', () => {
  const usd = (amount: string): Money => Money.from({ amount, currency: 'USD' });

  it('add / subtract / isLessThan lançam CurrencyMismatchError', () => {
    expect(() => brl('10.00').add(usd('10.00'))).toThrow(CurrencyMismatchError);
    expect(() => brl('10.00').subtract(usd('10.00'))).toThrow(CurrencyMismatchError);
    expect(() => brl('10.00').isLessThan(usd('10.00'))).toThrow(CurrencyMismatchError);
  });

  it('equals NÃO lança — retorna false para moedas diferentes', () => {
    expect(brl('10.00').equals(usd('10.00'))).toBe(false);
  });

  it('o erro carrega as duas moedas envolvidas', () => {
    try {
      brl('10.00').add(usd('10.00'));
      throw new Error('deveria ter lançado');
    } catch (error) {
      expect(error).toBeInstanceOf(CurrencyMismatchError);
      expect((error as CurrencyMismatchError).left).toBe('BRL');
      expect((error as CurrencyMismatchError).right).toBe('USD');
    }
  });
});

describe('serialização', () => {
  it('toString é legível', () => {
    expect(brl('25.5').toString()).toBe('25.50 BRL');
    expect(brl('25.00').negate().toString()).toBe('-25.00 BRL');
  });

  it('round-trip: Money.from(m.toJSON()) é igual a m', () => {
    const m = brl('1234.56');
    expect(Money.from(m.toJSON()).equals(m)).toBe(true);
  });
});
