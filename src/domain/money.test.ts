import { convert, formatMoney, parseAmount, sumMoney } from './money';
import type { ExchangeRate } from './types';

const nbsp = (s: string) => s.replace(/[\u00a0\u202f]/g, ' ').replace(/\u2212/g, '-');

describe('formatMoney', () => {
  it('formaterer i norsk format', () => {
    expect(nbsp(formatMoney(2485050))).toBe('24 850,50 kr');
    expect(nbsp(formatMoney(-17900))).toBe('-179,00 kr');
    expect(nbsp(formatMoney(17900, 'NOK', { signed: true }))).toBe('+179,00 kr');
    expect(nbsp(formatMoney(-17900, 'NOK', { absolute: true }))).toBe('179,00 kr');
    expect(nbsp(formatMoney(4520, 'EUR'))).toBe('45,20 EUR');
  });
});

describe('parseAmount', () => {
  it.each([
    ['1 234,50', 123450],
    ['-1234.50', -123450],
    ['1.234,50', 123450],
    ['1,234.50', 123450],
    ['kr 99', 9900],
    ['−45,00', -4500],
    ['(45,00)', -4500],
    ['1.234', 123400],
    ['12,5', 1250],
    ['0,1', 10],
    ['+300', 30000],
    ['0,005', 1],
    ['1 000 000', 100000000],
  ])('%s → %i', (input, expected) => {
    expect(parseAmount(input)).toBe(expected);
  });

  it('avviser ugyldige verdier', () => {
    expect(parseAmount('')).toBeNull();
    expect(parseAmount('abc')).toBeNull();
    expect(parseAmount('12-3')).toBeNull();
  });

  it('bruker heltall og mister ingen øre', () => {
    // 0.1 + 0.2 i flyttall er ikke 0.3 – i øre går det opp.
    expect((parseAmount('0,10') ?? 0) + (parseAmount('0,20') ?? 0)).toBe(parseAmount('0,30'));
  });
});

const rates: ExchangeRate[] = [{ currency: 'EUR', base: 'NOK', rate: 11.72, asOf: '2026-09-26T06:00:00Z', source: 'test' }];

describe('sumMoney', () => {
  it('summerer ikke ulike valutaer direkte, men omregner og rapporterer kurs', () => {
    const s = sumMoney(
      [
        { id: 'a', label: 'A', amount: 100000, currency: 'NOK' },
        { id: 'b', label: 'B', amount: 10000, currency: 'EUR' },
      ],
      'NOK',
      rates,
    );
    expect(s.amount).toBe(100000 + 117200);
    expect(s.complete).toBe(true);
    expect(s.conversions).toEqual([{ currency: 'EUR', rate: 11.72, asOf: '2026-09-26T06:00:00Z', source: 'test' }]);
  });

  it('behandler manglende saldo som ukjent og merker summen ufullstendig', () => {
    const s = sumMoney(
      [
        { id: 'a', label: 'A', amount: 5000, currency: 'NOK' },
        { id: 'b', label: 'B', amount: null, currency: 'NOK' },
      ],
      'NOK',
      rates,
    );
    expect(s.amount).toBe(5000);
    expect(s.complete).toBe(false);
    expect(s.missing.map((m) => m.id)).toEqual(['b']);
  });

  it('merker summen ufullstendig når valutakurs mangler', () => {
    const s = sumMoney([{ id: 'a', label: 'A', amount: 5000, currency: 'SEK' }], 'NOK', rates);
    expect(s.complete).toBe(false);
    expect(s.amount).toBe(0);
    expect(s.unconvertible).toHaveLength(1);
  });

  it('convert returnerer null uten kurs', () => {
    expect(convert(100, 'SEK', 'NOK', rates)).toBeNull();
    expect(convert(100, 'NOK', 'NOK', rates)).toEqual({ amount: 100, rate: null });
  });
});
