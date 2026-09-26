import { defaultSettings } from '../storage/repository';
import { account } from '../test/factories';
import { netWorth } from './netWorth';
import type { BusinessData } from './types';

const settings = { ...defaultSettings(), baseCurrency: 'NOK' };
const rates = [{ currency: 'EUR', base: 'NOK', rate: 11.5, asOf: '2026-09-25', source: 'test' }];

const personal: BusinessData = {
  name: 'Privat',
  items: [
    { id: 'p1', kind: 'asset', name: 'Leilighet', institution: '', currency: 'NOK', amount: 300_000_000, updatedAt: '' },
    { id: 'p2', kind: 'debt', name: 'Boliglån', institution: '', currency: 'NOK', amount: 200_000_000, updatedAt: '' },
  ],
  holdings: [
    { id: 'h1', symbol: 'BTC-USD', name: 'Bitcoin', exchange: 'CCC', currency: 'USD', quantity: 0.5, costPerShare: null, manualPrice: null, updatedAt: '' },
    { id: 'h2', symbol: null, name: 'Unotert AS', exchange: 'Unotert', currency: 'NOK', quantity: 10, costPerShare: null, manualPrice: 100, updatedAt: '' },
  ],
  quotes: {},
};

const business: BusinessData = {
  name: 'Firma AS',
  ownership: 60,
  items: [{ id: 'b1', kind: 'cash', name: 'Drift', institution: '', currency: 'NOK', amount: 10_000_000, updatedAt: '' }],
  holdings: [],
  quotes: {},
};

describe('nettoformue', () => {
  const accounts = [
    account({ bookedBalance: 5_000_000 }),
    account({ currency: 'EUR', bookedBalance: 100_00 }),
    account({ type: 'credit_card', bookedBalance: -250_000 }),
    account({ bookedBalance: 9_999_999, includedInOverview: false }),
  ];

  it('summerer bank, investeringer og eiendeler minus gjeld, og holder bedriften som egen linje', () => {
    const nw = netWorth({ accounts, transactions: [], rates, settings, personalAssets: personal, business });
    // Bank: 50 000 + 100 EUR × 11,5 = 51 150 kr. Unotert: 1 000 kr. Leilighet: 3 000 000 kr.
    expect(nw.bank.amount).toBe(5_115_000);
    expect(nw.assets).toBe(5_115_000 + 100_000 + 300_000_000);
    // Gjeld: kort 2 500 kr + boliglån 2 000 000 kr
    expect(nw.debt).toBe(250_000 + 200_000_000);
    expect(nw.total).toBe(nw.assets - nw.debt);
    // 60 % av 100 000 kr
    expect(nw.businessShare).toBe(6_000_000);
    expect(nw.totalWithBusiness).toBe(nw.total + 6_000_000);
    // Bitcoin uten kurs gjør totalen ufullstendig i stedet for å telle som 0
    expect(nw.complete).toBe(false);
    expect(nw.personal.missing.join()).toMatch(/Bitcoin/);
  });

  it('bruker markedskurs for krypto og regner om fra USD', () => {
    const withQuote = { ...personal, quotes: { 'BTC-USD': { symbol: 'BTC-USD', price: 60_000, previousClose: 59_000, currency: 'USD', time: null, fetchedAt: '', source: 'test' } } };
    const nw = netWorth({ accounts: [], transactions: [], rates: [{ currency: 'USD', base: 'NOK', rate: 10, asOf: '', source: 'test' }], settings, personalAssets: withQuote });
    // 0,5 × 60 000 USD × 10 = 300 000 kr + 1 000 kr unotert
    expect(nw.personal.shares).toBe(30_100_000);
    expect(nw.business).toBeNull();
    expect(nw.complete).toBe(true);
  });

  it('markerer ukjent kontosaldo som ufullstendig', () => {
    const nw = netWorth({ accounts: [account({ bookedBalance: null, availableBalance: null })], transactions: [], rates, settings });
    expect(nw.complete).toBe(false);
    expect(nw.total).toBe(0);
  });
});
