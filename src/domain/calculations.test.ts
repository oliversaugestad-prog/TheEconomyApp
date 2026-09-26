import { account, tx } from '../test/factories';
import { balanceSummary, categoryBreakdown, EMPTY_FILTER, filterTransactions, monthlySeries, summarizeFlows, availableCredit } from './calculations';
import { defaultSettings } from '../storage/repository';
import type { ExchangeRate } from './types';

const settings = { ...defaultSettings(), baseCurrency: 'NOK' };
const rates: ExchangeRate[] = [{ currency: 'EUR', base: 'NOK', rate: 11.5, asOf: '2026-09-26T06:00:00Z', source: 'test' }];

describe('balanceSummary', () => {
  const bruk = account({ id: 'bruk', bookedBalance: 1_000_000, availableBalance: 968_760 });
  const eur = account({ id: 'eur', currency: 'EUR', bookedBalance: 10_000, availableBalance: 10_000 });
  const bsu = account({ id: 'bsu', type: 'bsu', bookedBalance: 5_000_000, availableBalance: null });
  const card = account({
    id: 'card',
    type: 'credit_card',
    bookedBalance: -300_000,
    availableBalance: 2_671_100,
    card: { issuer: 'X', last4: '1234', creditLimit: 3_000_000, statement: null },
  });
  const excluded = account({ id: 'ex', bookedBalance: 99_999_999, includedInOverview: false });
  const pendingCard = tx({ accountId: 'card', amount: -28_900, status: 'pending' });
  const data = { accounts: [bruk, eur, bsu, card, excluded], transactions: [pendingCard], rates, settings };

  it('legger aldri kredittgrense eller tilgjengelig kreditt til kontosaldoen', () => {
    const s = balanceSummary(data);
    expect(s.booked.amount).toBe(1_000_000 + 115_000 + 5_000_000);
    expect(s.booked.conversions[0].currency).toBe('EUR');
  });

  it('holder kontoer utenfor oversikten ute av summene', () => {
    const s = balanceSummary(data);
    expect(s.bankAccounts.map((a) => a.id)).not.toContain('ex');
  });

  it('tilgjengelig saldo tas som oppgitt og er ufullstendig når en konto mangler tallet', () => {
    const s = balanceSummary(data);
    // Ingen reservasjoner trekkes fra på nytt
    expect(s.available.amount).toBe(968_760 + 115_000);
    expect(s.available.complete).toBe(false);
    expect(s.available.missing.map((m) => m.id)).toEqual(['bsu']);
  });

  it('beregner kortgjeld, reservasjoner og netto separat', () => {
    const s = balanceSummary(data);
    expect(s.cardDebt.amount).toBe(300_000);
    expect(s.cardReserved.amount).toBe(28_900);
    expect(s.net.amount).toBe(s.booked.amount - 300_000);
    expect(s.net.complete).toBe(true);
  });

  it('ukjent kortsaldo gjør netto ufullstendig i stedet for å bli null', () => {
    const unknown = account({ id: 'c2', type: 'credit_card', bookedBalance: null, availableBalance: null });
    const s = balanceSummary({ ...data, accounts: [bruk, unknown] });
    expect(s.cardDebt.complete).toBe(false);
    expect(s.net.complete).toBe(false);
  });

  it('tilgjengelig kreditt tas fra kilden og beregnes ellers uten dobbelt reservasjonstrekk', () => {
    expect(availableCredit(card, [pendingCard])).toBe(2_671_100);
    const noAvail = { ...card, availableBalance: null };
    expect(availableCredit(noAvail, [pendingCard])).toBe(3_000_000 - 300_000 - 28_900);
    expect(availableCredit({ ...noAvail, card: { ...card.card!, creditLimit: null } }, [])).toBeNull();
  });
});

describe('summarizeFlows og filtre', () => {
  const t = [
    tx({ accountId: 'a', amount: 4_850_000, counterparty: 'Arbeidsgiver', category: 'lonn', bookingDate: '2026-08-25' }),
    tx({ accountId: 'a', amount: -1_450_000, counterparty: 'Utleier', category: 'bolig', bookingDate: '2026-09-01' }),
    tx({ accountId: 'a', amount: -31_240, counterparty: 'KIWI', category: 'dagligvarer', bookingDate: '2026-09-25', status: 'pending' }),
    tx({ accountId: 'b', amount: -4_520, currency: 'EUR', counterparty: 'MERCADONA', category: 'dagligvarer', bookingDate: '2026-09-03' }),
    tx({ accountId: 'a', amount: -500_000, kind: 'internal_transfer', counterparty: 'Sparekonto', bookingDate: '2026-09-25' }),
  ];
  const accs = [account({ id: 'a', bankName: 'Nordlys' }), account({ id: 'b', bankName: 'Fjord', currency: 'EUR' })];

  it('teller reservasjoner én gang og viser dem som «herav reservert»', () => {
    const sep = t.filter((x) => x.bookingDate.startsWith('2026-09'));
    const s = summarizeFlows(sep, 'NOK', rates);
    expect(s.expense).toBe(1_450_000 + 31_240 + 51_980);
    expect(s.pendingExpense).toBe(31_240);
    expect(s.income).toBe(0);
  });

  it('hopper over fremmed valuta uten kurs og rapporterer det', () => {
    const s = summarizeFlows(t, 'NOK', []);
    expect(s.skipped).toBe(1);
  });

  it('filtre påvirker både liste og summer', () => {
    const filtered = filterTransactions(t, accs, { ...EMPTY_FILTER, category: 'dagligvarer' });
    expect(filtered).toHaveLength(2);
    expect(summarizeFlows(filtered, 'NOK', rates).expense).toBe(31_240 + 51_980);
    expect(filterTransactions(t, accs, { ...EMPTY_FILTER, bank: 'Fjord' })).toHaveLength(1);
    expect(filterTransactions(t, accs, { ...EMPTY_FILTER, status: 'pending' })).toHaveLength(1);
    expect(filterTransactions(t, accs, { ...EMPTY_FILTER, type: 'transfer' })).toHaveLength(1);
    expect(filterTransactions(t, accs, { ...EMPTY_FILTER, type: 'income' })).toHaveLength(1);
    expect(filterTransactions(t, accs, { ...EMPTY_FILTER, from: '2026-09-02', to: '2026-09-30' })).toHaveLength(3);
  });

  it('søker på mottaker, beskrivelse og beløp', () => {
    expect(filterTransactions(t, accs, { ...EMPTY_FILTER, query: 'kiwi' })).toHaveLength(1);
    expect(filterTransactions(t, accs, { ...EMPTY_FILTER, query: '312,40' })).toHaveLength(1);
    expect(filterTransactions(t, accs, { ...EMPTY_FILTER, query: '312' })).toHaveLength(1);
    expect(filterTransactions(t, accs, { ...EMPTY_FILTER, query: '14 500' })).toHaveLength(1);
  });

  it('månedsserie og kategorifordeling bygger på samme data', () => {
    const series = monthlySeries(t, '2026-09', 2, 'NOK', rates);
    expect(series.map((p) => p.month)).toEqual(['2026-08', '2026-09']);
    expect(series[0].income).toBe(4_850_000);
    const sep = summarizeFlows(t.filter((x) => x.bookingDate.startsWith('2026-09')), 'NOK', rates);
    expect(series[1].expense).toBe(sep.expense);
    const breakdown = categoryBreakdown(sep);
    expect(breakdown.reduce((s, c) => s + c.amount, 0)).toBe(sep.expense);
    expect(breakdown[0].category).toBe('bolig');
  });
});
