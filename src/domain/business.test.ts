import { normalizeQuoteCurrency, summarizeBusiness, valueHolding } from './business';
import type { BusinessData, Holding } from './types';

const rates = [
  { currency: 'USD', base: 'NOK', rate: 10.84, asOf: '2026-09-25T12:15:00Z', source: 'test' },
  { currency: 'GBP', base: 'NOK', rate: 14, asOf: '2026-09-25T12:15:00Z', source: 'test' },
];

function holding(p: Partial<Holding>): Holding {
  return { id: 'h', symbol: 'EQNR.OL', name: 'Equinor', exchange: 'Oslo', currency: 'NOK', quantity: 10, costPerShare: null, manualPrice: null, updatedAt: '', ...p };
}

describe('bedrift', () => {
  it('regner verdi, dagens endring og gevinst fra markedskurs', () => {
    const v = valueHolding(holding({ costPerShare: 300 }), {
      'EQNR.OL': { symbol: 'EQNR.OL', price: 404.7, previousClose: 416.3, currency: 'NOK', time: '2026-09-25T14:25:00Z', fetchedAt: '', source: 'test' },
    });
    expect(v.value).toBe(404700);
    expect(v.dayChange).toBe(-11600);
    expect(v.gain).toBe(104700);
    expect(v.priceSource).toBe('market');
  });

  it('bruker manuell kurs for unoterte og markerer ukjent kurs', () => {
    expect(valueHolding(holding({ symbol: null, manualPrice: 120 }), {}).value).toBe(120000);
    expect(valueHolding(holding({ symbol: 'UKJENT' }), {}).value).toBeNull();
  });

  it('håndterer kurs i pence', () => {
    expect(normalizeQuoteCurrency('GBp', 250)).toEqual({ currency: 'GBP', price: 2.5 });
  });

  it('summerer bank, aksjer, eiendeler og gjeld i NOK', () => {
    const b: BusinessData = {
      name: 'Test AS',
      items: [
        { id: '1', kind: 'cash', name: 'Driftskonto', institution: 'SpareBank 1 SMN', currency: 'NOK', amount: 5_000_000, updatedAt: '' },
        { id: '2', kind: 'asset', name: 'Bil', institution: '', currency: 'NOK', amount: 20_000_000, updatedAt: '' },
        { id: '3', kind: 'debt', name: 'Billån', institution: '', currency: 'NOK', amount: 15_000_000, updatedAt: '' },
      ],
      holdings: [holding({ id: 'a', symbol: 'AAPL', currency: 'USD', quantity: 2 })],
      quotes: { AAPL: { symbol: 'AAPL', price: 200, previousClose: 190, currency: 'USD', time: '2026-09-25T20:00:00Z', fetchedAt: '', source: 'test' } },
    };
    const s = summarizeBusiness(b, 'NOK', rates);
    expect(s.shares).toBe(Math.round(40_000 * 10.84));
    expect(s.total).toBe(5_000_000 + 20_000_000 - 15_000_000 + Math.round(40_000 * 10.84));
    expect(s.dayChange).toBe(Math.round(2_000 * 10.84));
    expect(s.missing).toEqual([]);
  });

  it('holder poster uten valutakurs utenfor og rapporterer dem', () => {
    const b: BusinessData = {
      name: 'x',
      items: [{ id: '1', kind: 'cash', name: 'Konto i CHF', institution: '', currency: 'CHF', amount: 100, updatedAt: '' }],
      holdings: [],
      quotes: {},
    };
    expect(summarizeBusiness(b, 'NOK', rates).missing[0]).toMatch(/CHF/);
  });
});
