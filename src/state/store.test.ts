import { balanceSummary, overviewTransactions, summarizeFlows, monthTransactions } from '../domain/calculations';
import { monthKey } from '../domain/dates';
import { DEMO_IDS } from '../providers/demo';
import { memoryRepository } from '../storage/repository';
import { SaldoStore } from './store';

const NOW = new Date('2026-09-26T08:00:00Z');

function makeStore() {
  const repo = memoryRepository();
  const store = new SaldoStore(repo, () => NOW);
  store.updateSettings({ timeZone: 'Europe/Oslo' });
  return { store, repo };
}

describe('demodata', () => {
  it('har minst tre banker, fem kontoer og to kredittkort med tre måneders historikk', () => {
    const { store } = makeStore();
    const d = store.data;
    expect(new Set(d.accounts.map((a) => a.bankName)).size).toBeGreaterThanOrEqual(3);
    expect(d.accounts.filter((a) => a.type !== 'credit_card').length).toBeGreaterThanOrEqual(5);
    expect(d.accounts.filter((a) => a.type === 'credit_card').length).toBeGreaterThanOrEqual(2);
    const months = new Set(d.transactions.map((t) => monthKey(t.bookingDate)));
    expect(months.size).toBeGreaterThanOrEqual(4);
    const kinds = new Set(d.transactions.map((t) => t.kind));
    expect(kinds).toEqual(new Set(['normal', 'internal_transfer', 'card_payment', 'refund']));
    expect(d.transactions.some((t) => t.status === 'pending')).toBe(true);
  });

  it('saldoer stemmer med underliggende transaksjoner', () => {
    const { store } = makeStore();
    const d = store.data;
    const bruk = d.accounts.find((a) => a.id === DEMO_IDS.bruk)!;
    const pending = d.transactions.filter((t) => t.accountId === bruk.id && t.status === 'pending').reduce((s, t) => s + t.amount, 0);
    // Tilgjengelig = bokført + reservasjoner (kilden tar hensyn til dem)
    expect(bruk.availableBalance).toBe(bruk.bookedBalance! + pending);
    const s = balanceSummary(d);
    const manual = s.bankAccounts.reduce((sum, a) => sum + (a.currency === 'NOK' ? a.bookedBalance! : Math.round(a.bookedBalance! * 11.72)), 0);
    expect(s.booked.amount).toBe(manual);
    expect(s.available.complete).toBe(false); // BSU oppgir ikke tilgjengelig saldo
  });

  it('interne overføringer og kortbetalinger påvirker ikke månedens inntekter/forbruk', () => {
    const { store } = makeStore();
    const d = store.data;
    const month = monthTransactions(overviewTransactions(d), '2026-08');
    const s = summarizeFlows(month, 'NOK', d.rates);
    const salary = month.filter((t) => t.counterparty === 'Nordvik Teknologi AS').reduce((a, t) => a + t.amount, 0);
    expect(s.income).toBe(salary);
    const neutral = month.filter((t) => t.kind === 'internal_transfer' || t.kind === 'card_payment');
    expect(neutral.length).toBeGreaterThanOrEqual(8);
    // Summen av alle overføringer mellom egne kontoer er null (penger flyttes, forsvinner ikke)
    const transfers = month.filter((t) => t.kind === 'internal_transfer' && t.linkedTransactionId);
    expect(transfers.reduce((a, t) => a + t.amount, 0)).toBe(0);
  });
});

describe('synkronisering', () => {
  it('gir ingen duplikater, bokfører reservasjoner og beholder data ved feil', async () => {
    const { store } = makeStore();
    const before = store.data.transactions.length;
    const pendingBefore = store.data.transactions.filter((t) => t.status === 'pending');
    const expenseBefore = summarizeFlows(monthTransactions(store.data.transactions, '2026-09'), 'NOK', store.data.rates).expense;
    await store.syncAll();
    const d = store.data;
    // Én ny reservasjon (REMA 1000), ingen duplikater
    expect(d.transactions.length).toBe(before + 1);
    const ids = d.transactions.map((t) => t.externalId);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of pendingBefore) {
      expect(d.transactions.find((t) => t.id === p.id)?.status).toBe('booked');
    }
    const expenseAfter = summarizeFlows(monthTransactions(d.transactions, '2026-09'), 'NOK', d.rates).expense;
    expect(expenseAfter).toBe(expenseBefore + 14790);
    // Vidde Kreditt feiler med behov for ny tilkobling, men beholder data
    const vidde = d.connections.find((c) => c.id === DEMO_IDS.vidde)!;
    expect(vidde.status).toBe('reauth_required');
    expect(d.accounts.find((a) => a.id === DEMO_IDS.mc)?.bookedBalance).not.toBeNull();

    // En synkronisering til gir fortsatt ingen duplikater
    await store.syncAll();
    expect(store.data.transactions.length).toBe(before + 1);
  }, 10_000);
});

describe('brukerendringer', () => {
  it('kategoriendring med regel gjelder alle fra samme mottaker og lagres', () => {
    const { store, repo } = makeStore();
    const kiwi = store.data.transactions.find((t) => t.counterparty === 'KIWI')!;
    store.setCategory(kiwi.id, 'restaurant', true);
    const all = store.data.transactions.filter((t) => t.counterparty === 'KIWI');
    expect(all.every((t) => t.category === 'restaurant')).toBe(true);
    expect(repo.data?.rules).toHaveLength(1);
    const reloaded = new SaldoStore(repo, () => NOW);
    expect(reloaded.data.transactions.find((t) => t.id === kiwi.id)?.category).toBe('restaurant');
  });

  it('konto utenfor oversikten påvirker ikke totalsum', () => {
    const { store } = makeStore();
    const before = balanceSummary(store.data).booked.amount;
    const spar = store.data.accounts.find((a) => a.id === DEMO_IDS.spar)!;
    store.toggleIncluded(spar.id);
    expect(balanceSummary(store.data).booked.amount).toBe(before - spar.bookedBalance!);
  });

  it('manuell konto uten saldo gjør totalsummen ufullstendig', () => {
    const { store } = makeStore();
    store.addManualAccount({ bankName: 'Lokalbanken', name: 'Brukskonto', type: 'checking', currency: 'NOK', bookedBalance: null, availableBalance: null, last4: '1234', creditLimit: null });
    expect(balanceSummary(store.data).booked.complete).toBe(false);
  });

  it('fjerning av demodata etterlater egne data', () => {
    const { store } = makeStore();
    store.addManualAccount({ bankName: 'Lokalbanken', name: 'Egen', type: 'savings', currency: 'NOK', bookedBalance: 100000, availableBalance: null, last4: '', creditLimit: null });
    store.clearDemo();
    expect(store.data.accounts.map((a) => a.name)).toEqual(['Egen']);
    expect(store.data.transactions).toHaveLength(0);
    expect(store.hasDemoData()).toBe(false);
  });

  it('frakobling kan beholde eller slette data', () => {
    const { store } = makeStore();
    store.disconnect(DEMO_IDS.fjord, false);
    expect(store.data.connections.find((c) => c.id === DEMO_IDS.fjord)?.status).toBe('disconnected');
    expect(store.data.accounts.some((a) => a.connectionId === DEMO_IDS.fjord)).toBe(true);
    store.disconnect(DEMO_IDS.fjord, true);
    expect(store.data.accounts.some((a) => a.connectionId === DEMO_IDS.fjord)).toBe(false);
  });

  it('avslutning av abonnement fjerner det fra månedlig kostnad', () => {
    const { store } = makeStore();
    const nf = store.data.subscriptions.find((s) => s.matchKey === 'netflix')!;
    expect(nf).toBeDefined();
    store.setSubscriptionStatus(nf.id, 'ended');
    expect(store.data.subscriptions.find((s) => s.id === nf.id)).toMatchObject({ status: 'ended', endedAt: '2026-09-26' });
  });
});
