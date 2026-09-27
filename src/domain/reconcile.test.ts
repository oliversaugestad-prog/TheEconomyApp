import { account, tx } from '../test/factories';
import { summarizeFlows } from './calculations';
import { classifyTransactions, mergeTransactions } from './reconcile';

const bruk = account({ id: 'bruk', name: 'Brukskonto' });
const spar = account({ id: 'spar', name: 'Sparekonto', type: 'savings' });
const card = account({ id: 'card', name: 'Test Visa', bankName: 'Kortbanken', type: 'credit_card' });
const accounts = [bruk, spar, card];

describe('mergeTransactions', () => {
  it('lager ikke duplikater ved gjentatt synkronisering', () => {
    const a = tx({ accountId: 'bruk', amount: -10000, externalId: 'x1' });
    const first = mergeTransactions([], [a]);
    const second = mergeTransactions(first.transactions, [{ ...a, id: 'annen-id' }]);
    expect(second.transactions).toHaveLength(1);
    expect(second.stats).toMatchObject({ added: 0, updated: 1 });
  });

  it('erstatter reservasjonen når den bokføres (via ID fra kilden)', () => {
    const pending = tx({ accountId: 'bruk', amount: -31240, externalId: 'p1', status: 'pending', bookingDate: '2026-09-24' });
    const booked = tx({ accountId: 'bruk', amount: -31240, externalId: 'b1', status: 'booked', bookingDate: '2026-09-26', replacesPendingExternalId: 'p1' });
    const r = mergeTransactions([pending], [booked]);
    expect(r.transactions).toHaveLength(1);
    expect(r.transactions[0].status).toBe('booked');
    expect(r.stats.pendingReplaced).toBe(1);
  });

  it('erstatter reservasjonen uten ID når konto, beløp og mottaker stemmer', () => {
    const pending = tx({ accountId: 'bruk', amount: -28900, externalId: 'p2', status: 'pending', counterparty: 'Foodora', bookingDate: '2026-09-24' });
    const booked = tx({ accountId: 'bruk', amount: -28900, externalId: 'b2', counterparty: 'FOODORA', bookingDate: '2026-09-26' });
    const r = mergeTransactions([pending], [booked]);
    expect(r.transactions).toHaveLength(1);
    // Beløpet telles kun én gang
    expect(summarizeFlows(r.transactions, 'NOK', []).expense).toBe(28900);
  });

  it('beholder brukerens kategori når reservasjonen bokføres', () => {
    const pending = tx({ accountId: 'bruk', amount: -5000, externalId: 'p3', status: 'pending', category: 'helse', userCategorized: true });
    const booked = tx({ accountId: 'bruk', amount: -5000, externalId: 'b3', replacesPendingExternalId: 'p3' });
    const r = mergeTransactions([pending], [booked]);
    expect(r.transactions[0]).toMatchObject({ category: 'helse', userCategorized: true, id: pending.id });
  });

  it('gjenkjenner transaksjon som banken har gitt ny ID, og rydder bort gamle kopier', () => {
    const base = { accountId: 'sb1', amount: -525971, counterparty: 'American Express', bookingDate: '2026-09-14', source: 'bank' as const };
    // Tidligere henting ga samme betaling to ulike ID-er
    const a = tx({ ...base, externalId: 'id-a', category: 'annet' });
    const b = tx({ ...base, externalId: 'id-b' });
    const older = tx({ ...base, bookingDate: '2026-06-01', externalId: 'old' });
    const fresh = tx({ ...base, externalId: 'id-c' });
    const window = { from: '2026-09-01', accountIds: ['sb1'] };
    const r = mergeTransactions([a, b, older], [fresh], { window });
    const sept = r.transactions.filter((t) => t.bookingDate === '2026-09-14');
    expect(sept).toHaveLength(1);
    expect(sept[0]).toMatchObject({ id: a.id, externalId: 'id-c' });
    // Utenfor hentevinduet røres ingenting
    expect(r.transactions.some((t) => t.externalId === 'old')).toBe(true);
    expect(r.stats.duplicatesRemoved).toBe(1);
  });

  it('beholder to like kjøp samme dag når banken oppgir begge', () => {
    const base = { accountId: 'sb1', amount: -4500, counterparty: 'Nordland fylkeskomm', bookingDate: '2026-09-21', source: 'bank' as const };
    const existing = [tx({ ...base, externalId: 'a' }), tx({ ...base, externalId: 'b' })];
    const incoming = [tx({ ...base, externalId: 'c' }), tx({ ...base, externalId: 'd' })];
    const r = mergeTransactions(existing, incoming, { window: { from: '2026-09-01', accountIds: ['sb1'] } });
    expect(r.transactions).toHaveLength(2);
  });

  it('beholder poster banken ikke lenger nevner', () => {
    const t = tx({ accountId: 'sb1', amount: -100, externalId: 'x', bookingDate: '2026-09-20', source: 'bank' });
    const r = mergeTransactions([t], [], { window: { from: '2026-09-01', accountIds: ['sb1'] } });
    expect(r.transactions).toHaveLength(1);
  });

  it('fjerner kansellerte reservasjoner når kilden leverer komplett liste', () => {
    const pending = tx({ accountId: 'bruk', amount: -5000, externalId: 'p4', status: 'pending' });
    const r = mergeTransactions([pending], [], { pendingComplete: true, accountIds: ['bruk'] });
    expect(r.transactions).toHaveLength(0);
    expect(r.stats.pendingRemoved).toBe(1);
  });
});

describe('classifyTransactions', () => {
  it('regner betaling til Amex fra banken som kortinnbetaling når Amex-kortet finnes i Saldo', () => {
    const bank = account({ id: 'sb1', bankName: 'SpareBank 1 SMN' });
    const amex = account({ id: 'amex', type: 'credit_card', bankName: 'American Express', name: 'Amex EB SAS', card: { issuer: 'American Express', last4: '', creditLimit: null, statement: null } });
    const pay = tx({ accountId: 'sb1', amount: -1051942, counterparty: 'American Express', bookingDate: '2026-09-10' });
    const topUp = tx({ accountId: 'sb1', amount: -297713, counterparty: 'Revolut**2327*', bookingDate: '2026-09-12' });
    const revolut = account({ id: 'rev', bankName: 'Revolut' });
    const res = classifyTransactions([pay, topUp], [bank, amex, revolut], []);
    expect(res.find((t) => t.id === pay.id)?.kind).toBe('card_payment');
    expect(res.find((t) => t.id === topUp.id)?.kind).toBe('internal_transfer');
    // Uten Amex-kortet i Saldo er det fortsatt forbruk (der kortkjøpene ellers ville mangle)
    expect(classifyTransactions([pay], [bank], [])[0].kind).toBe('normal');
  });

  it('markerer overføring mellom egne kontoer, som ikke teller som inntekt eller forbruk', () => {
    const out = tx({ accountId: 'bruk', amount: -500000, counterparty: 'Sparekonto', description: 'Overføring til egen konto', bookingDate: '2026-09-25' });
    const inn = tx({ accountId: 'spar', amount: 500000, counterparty: 'Brukskonto', description: 'Overføring fra egen konto', bookingDate: '2026-09-26' });
    const salary = tx({ accountId: 'bruk', amount: 4850000, counterparty: 'Arbeidsgiver AS', description: 'Lønn' });
    const res = classifyTransactions([out, inn, salary], accounts, []);
    expect(res[0]).toMatchObject({ kind: 'internal_transfer', linkedTransactionId: inn.id });
    expect(res[1]).toMatchObject({ kind: 'internal_transfer', linkedTransactionId: out.id });
    const flows = summarizeFlows(res, 'NOK', []);
    expect(flows.income).toBe(4850000);
    expect(flows.expense).toBe(0);
  });

  it('kortbetaling reduserer gjeld, men telles ikke som ny utgift', () => {
    const purchase1 = tx({ accountId: 'card', amount: -40000, counterparty: 'XXL' });
    const purchase2 = tx({ accountId: 'card', amount: -10000, counterparty: 'REMA 1000' });
    const payOut = tx({ accountId: 'bruk', amount: -50000, counterparty: 'Kortbanken', description: 'Innbetaling kredittkort', bookingDate: '2026-09-20' });
    const payIn = tx({ accountId: 'card', amount: 50000, counterparty: 'Innbetaling', description: 'Innbetaling', bookingDate: '2026-09-20' });
    const res = classifyTransactions([purchase1, purchase2, payOut, payIn], accounts, []);
    expect(res.find((t) => t.id === payOut.id)?.kind).toBe('card_payment');
    expect(res.find((t) => t.id === payIn.id)?.kind).toBe('card_payment');
    expect(summarizeFlows(res, 'NOK', []).expense).toBe(50000); // bare kjøpene
  });

  it('gjenkjenner kortbetaling selv om kortsiden ikke er synkronisert', () => {
    const payOut = tx({ accountId: 'bruk', amount: -50000, counterparty: 'Kortbanken', description: 'Innbetaling kredittkort Test Visa' });
    const res = classifyTransactions([payOut], accounts, []);
    expect(res[0].kind).toBe('card_payment');
  });

  it('parer ikke tilfeldige like beløp uten tegn på overføring', () => {
    const buy = tx({ accountId: 'card', amount: -50000, counterparty: 'XXL' });
    const gift = tx({ accountId: 'bruk', amount: 50000, counterparty: 'Ola Nordmann', description: 'Vipps' });
    const res = classifyTransactions([buy, gift], accounts, []);
    expect(res.map((t) => t.kind)).toEqual(['normal', 'normal']);
  });

  it('refusjon knyttes til kjøpets kategori og reduserer forbruket', () => {
    const buy = tx({ accountId: 'card', amount: -89900, counterparty: 'ZALANDO SE', bookingDate: '2026-09-04' });
    const refund = tx({ accountId: 'card', amount: 89900, counterparty: 'ZALANDO SE', description: 'Refusjon', bookingDate: '2026-09-17' });
    const res = classifyTransactions([buy, refund], accounts, []);
    expect(res[0].category).toBe('shopping');
    expect(res[1]).toMatchObject({ kind: 'refund', category: 'shopping', linkedTransactionId: buy.id });
    const flows = summarizeFlows(res, 'NOK', []);
    expect(flows.income).toBe(0);
    expect(flows.expense).toBe(0);
    expect(flows.byCategory.get('shopping')).toBe(0);
  });

  it('delvis refusjon reduserer forbruket med refusjonsbeløpet', () => {
    const buy = tx({ accountId: 'card', amount: -449000, counterparty: 'Elkjøp', bookingDate: '2026-09-04' });
    const refund = tx({ accountId: 'card', amount: 75000, counterparty: 'Elkjøp', description: 'Prisgaranti – delvis refusjon', bookingDate: '2026-09-12' });
    const res = classifyTransactions([buy, refund], accounts, []);
    expect(res[1].kind).toBe('refund');
    expect(summarizeFlows(res, 'NOK', []).byCategory.get('shopping')).toBe(374000);
  });

  it('brukerens regler går foran automatisk kategorisering, men ikke manuelle valg', () => {
    const a = tx({ accountId: 'bruk', amount: -10000, counterparty: 'KIWI 123' });
    const b = tx({ accountId: 'bruk', amount: -20000, counterparty: 'Kiwi', category: 'helse', userCategorized: true });
    const res = classifyTransactions([a, b], accounts, [{ id: 'r', matchKey: 'kiwi', category: 'restaurant', createdAt: '' }]);
    expect(res[0].category).toBe('restaurant');
    expect(res[1].category).toBe('helse');
  });

  it('respekterer manuell markering av type', () => {
    const t = tx({ accountId: 'bruk', amount: -20000, counterparty: 'Mamma', kind: 'internal_transfer', userKind: true });
    expect(classifyTransactions([t], accounts, [])[0].kind).toBe('internal_transfer');
  });
});

describe('bedriftsutgifter betalt av eier', () => {
  it('holdes utenfor private utgifter og markeres via regel for lignende kjøp', () => {
    const a = tx({ accountId: 'k', amount: -50000, counterparty: 'Lovable Dover' });
    const b = tx({ accountId: 'k', amount: -30000, counterparty: 'Lovable London' });
    const res = classifyTransactions([a, b], [account({ id: 'k' })], [{ id: 'r', matchKey: 'lovable', category: 'abonnementer', business: true, createdAt: '' }]);
    expect(res.map((t) => t.kind)).toEqual(['business', 'business']);
    expect(summarizeFlows(res, 'NOK', []).expense).toBe(0);
  });
});
