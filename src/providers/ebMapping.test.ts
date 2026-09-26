import { mergeTransactions } from '../domain/reconcile';
import { memoryRepository } from '../storage/repository';
import { SaldoStore } from '../state/store';
import { accountTypeOf, mapAccount, mapTransactions, parseDecimal, type EbAccountResult } from './ebMapping';
import { connectionFromSession } from './enableBanking';

const conn = { id: 'eb-s1', institutionName: 'SpareBank 1 SMN' };

const result: EbAccountResult = {
  account: {
    uid: 'uid-1',
    identification_hash: 'hash-1',
    account_id: { iban: 'NO9386011117947' },
    name: 'Brukskonto',
    currency: 'NOK',
    cash_account_type: 'CACC',
  },
  balances: [
    { balance_type: 'ITAV', balance_amount: { currency: 'NOK', amount: '12000.50' } },
    { balance_type: 'CLBD', balance_amount: { currency: 'NOK', amount: '12345.67' } },
  ],
  transactions: [
    {
      entry_reference: 'ref-1',
      transaction_amount: { currency: 'NOK', amount: '345.17' },
      credit_debit_indicator: 'DBIT',
      status: 'BOOK',
      booking_date: '2026-09-20',
      creditor: { name: 'REMA 1000' },
      remittance_information: ['Varekjøp'],
    },
    {
      transaction_amount: { currency: 'NOK', amount: '48500' },
      credit_debit_indicator: 'CRDT',
      status: 'BOOK',
      booking_date: '2026-09-25',
      debtor: { name: 'Arbeidsgiver AS' },
      remittance_information: ['Lønn september'],
    },
    {
      transaction_amount: { currency: 'NOK', amount: '89.00' },
      credit_debit_indicator: 'DBIT',
      status: 'PDNG',
      transaction_date: '2026-09-26',
      remittance_information: ['KIWI 123 OSLO'],
    },
  ],
  error: null,
};

describe('Enable Banking-oversetting', () => {
  it('tolker desimaltall uten flyttallsfeil', () => {
    expect(parseDecimal('12345.67', 'NOK')).toBe(1234567);
    expect(parseDecimal('-0.1', 'NOK')).toBe(-10);
    expect(parseDecimal('5', 'NOK')).toBe(500);
    expect(parseDecimal('1.005', 'NOK')).toBe(101);
    expect(parseDecimal('12.345', 'NOK')).toBe(1235); // ikke tusenskille
    expect(parseDecimal('abc', 'NOK')).toBeNull();
  });

  it('bruker bokført og tilgjengelig saldo slik banken oppgir dem', () => {
    const a = mapAccount(result, conn, '2026-09-26T10:00:00Z');
    expect(a).toMatchObject({
      id: 'eb-hash-1',
      connectionId: 'eb-s1',
      bankName: 'SpareBank 1 SMN',
      type: 'checking',
      bookedBalance: 1234567,
      availableBalance: 1200050,
      maskedNumber: '•••• 7947',
      source: 'bank',
      isDemo: false,
    });
  });

  it('ukjent saldo blir null, ikke 0', () => {
    const a = mapAccount({ ...result, balances: [] }, conn, '2026-09-26T10:00:00Z');
    expect(a.bookedBalance).toBeNull();
    expect(a.availableBalance).toBeNull();
  });

  it('beholder forrige saldo og brukerens valg når kontoen feiler', () => {
    const prev = { ...mapAccount(result, conn, '2026-09-20T10:00:00Z'), includedInOverview: false };
    const a = mapAccount({ ...result, balances: [], error: 'feil' }, conn, '2026-09-26T10:00:00Z', prev);
    expect(a.bookedBalance).toBe(1234567);
    expect(a.balanceUpdatedAt).toBe('2026-09-20T10:00:00Z');
    expect(a.includedInOverview).toBe(false);
  });

  it('gjenkjenner kontotyper', () => {
    expect(accountTypeOf({ uid: 'x', cash_account_type: 'CARD' })).toBe('credit_card');
    expect(accountTypeOf({ uid: 'x', cash_account_type: 'SVGS' })).toBe('savings');
    expect(accountTypeOf({ uid: 'x', name: 'BSU Ung' })).toBe('bsu');
    expect(accountTypeOf({ uid: 'x', name: 'Visa-konto' })).toBe('checking');
  });

  it('oversetter transaksjoner med fortegn, status og mottaker', () => {
    const t = mapTransactions(result, 'eb-hash-1', 'NOK', '2026-09-26');
    expect(t.map((x) => [x.amount, x.status, x.counterparty])).toEqual([
      [-34517, 'booked', 'REMA 1000'],
      [4850000, 'booked', 'Arbeidsgiver AS'],
      [-8900, 'pending', 'KIWI 123 OSLO'],
    ]);
    expect(t[0].externalId).toBe('ref-1');
    // Uten ID fra banken brukes et stabilt fingeravtrykk
    expect(mapTransactions(result, 'eb-hash-1', 'NOK', '2026-09-26')[1].externalId).toBe(t[1].externalId);
  });

  it('gjentatt henting gir ingen duplikater, og reservasjonen erstattes når den bokføres', () => {
    const first = mapTransactions(result, 'eb-hash-1', 'NOK', '2026-09-26');
    const merged1 = mergeTransactions([], first).transactions;
    const again = mergeTransactions(merged1, mapTransactions(result, 'eb-hash-1', 'NOK', '2026-09-26'));
    expect(again.transactions).toHaveLength(3);
    const booked: EbAccountResult = {
      ...result,
      transactions: [
        ...result.transactions.slice(0, 2),
        { ...result.transactions[2], status: 'BOOK', booking_date: '2026-09-27', entry_reference: 'ref-9' },
      ],
    };
    const after = mergeTransactions(again.transactions, mapTransactions(booked, 'eb-hash-1', 'NOK', '2026-09-27'), {
      pendingComplete: true,
      accountIds: ['eb-hash-1'],
    });
    expect(after.transactions).toHaveLength(3);
    expect(after.transactions.filter((x) => x.status === 'pending')).toHaveLength(0);
  });

  it('tilkobling med utløpt samtykke krever ny innlogging', () => {
    const c = connectionFromSession({
      id: 's1',
      aspspName: 'Revolut',
      aspspCountry: 'LT',
      validUntil: '2020-01-01T00:00:00Z',
      status: 'active',
      lastSyncAt: null,
      lastError: null,
      accountCount: 1,
    });
    expect(c).toMatchObject({ id: 'eb-s1', providerId: 'enablebanking', status: 'reauth_required', isDemo: false });
  });
});

describe('store med ekte tilkoblinger', () => {
  it('legger til og markerer tilkoblinger fra serveren', () => {
    const store = new SaldoStore(memoryRepository(), () => new Date('2026-09-26T08:00:00Z'), false);
    expect(store.data.accounts).toHaveLength(0);
    const c = connectionFromSession({
      id: 's1',
      aspspName: 'SpareBank 1 SMN',
      aspspCountry: 'NO',
      validUntil: '2027-03-01T00:00:00Z',
      status: 'active',
      lastSyncAt: null,
      lastError: null,
      accountCount: 2,
    });
    store.upsertConnections('enablebanking', [c]);
    expect(store.data.connections.map((x) => x.id)).toEqual(['eb-s1']);
    store.upsertConnections('enablebanking', []);
    expect(store.data.connections[0].status).toBe('disconnected');
  });
});
