import { account, tx } from '../test/factories';
import { balanceSummary } from './calculations';
import { guessCategory, normalizeCounterparty } from './categories';
import { classifyTransactions } from './reconcile';
import { defaultSettings } from '../storage/repository';
import { mapTransactions } from '../providers/ebMapping';

describe('ekte banktekster', () => {
  it('skiller betalinger via Vipps og MobilePay fra hverandre', () => {
    expect(normalizeCounterparty('Vipps*Storytel')).toBe('storytel');
    expect(normalizeCounterparty('Vipps*VY App')).toBe('vy app');
    expect(normalizeCounterparty('MobilePay: Øl Gl1')).toBe('øl gl1');
    expect(normalizeCounterparty('Udbetaling   LIDL1234NORDREFASAN')).toBe('lidl nordrefasan');
    expect(normalizeCounterparty('NETFLIX.COM*1234')).toBe('netflix');
  });

  it('kategoriserer vanlige norske og danske mottakere', () => {
    expect(guessCategory('Udbetaling   LIDL1234NORDREFASAN', '', -100)).toBe('dagligvarer');
    expect(guessCategory('Apple Pay Top-Up by *7761', '', 200000)).not.toBe('abonnementer');
    expect(guessCategory('APPLE.COM/BILL', '', -2500)).toBe('abonnementer');
    expect(guessCategory('Vipps*Storytel', '', -100)).toBe('abonnementer');
    expect(guessCategory('Rejsekort Som App', '', -100)).toBe('transport');
    expect(guessCategory('Udbetaling   PIZZA OTTO - ELMEG', '', -100)).toBe('restaurant');
    expect(guessCategory('Puregym Denmark As', '', -100)).toBe('abonnementer');
  });

  it('kjenner igjen flere danske og norske steder og bransjekoder', () => {
    expect(guessCategory('Udbetaling   FOETEX NOERREBRO', '', -1)).toBe('dagligvarer');
    expect(guessCategory('Udbetaling   TM *TICKETMASTER', '', -1)).toBe('underholdning');
    expect(guessCategory('Bk 5081 Gol', '', -1)).toBe('restaurant');
    expect(guessCategory('Jysk Noerrebro D045', '', -1)).toBe('shopping');
    expect(guessCategory('APCOA PARKING NORWAY AS', '', -1)).toBe('transport');
    expect(guessCategory('SpotifySE', '', -1)).toBe('abonnementer');
    expect(guessCategory('365 Noerrebrogade', 'Coop365 Kbh N N', -1)).toBe('dagligvarer');
    expect(guessCategory('0019/LØNOVERFØRSEL', '', 1)).toBe('lonn');
    expect(guessCategory('Ukjent butikk', '', -1, '5812')).toBe('restaurant');
    expect(guessCategory('Ukjent butikk', '', -1, '5411')).toBe('dagligvarer');
    expect(guessCategory('Ukjent butikk', '', -1, null)).toBe('annet');
  });

  it('eget navn kjennes igjen uten mellomnavn, men ikke familie med samme etternavn', () => {
    const acc = account({ id: 'sb', name: 'Brukskonto' });
    const own = tx({ accountId: 'sb', amount: -50000, counterparty: 'Til: 1229 56 59775', description: 'Ola Hansen' });
    const fam = tx({ accountId: 'sb', amount: 20000, counterparty: 'Kari Nordmann Hansen' });
    const res = classifyTransactions([own, fam], [acc], [], ['Ola Nordmann Hansen']);
    expect(res.map((t) => t.kind)).toEqual(['internal_transfer', 'normal']);
  });

  it('valutaveksling og overføringer til eget navn er ikke forbruk', () => {
    const rev = account({ id: 'rev', name: 'Revolut NOK', currency: 'NOK' });
    const t1 = tx({ accountId: 'rev', amount: -50000, counterparty: 'Exchanged to DKK' });
    const t2 = tx({ accountId: 'rev', amount: -20000, counterparty: 'Ola Nordmann Hansen' });
    const t3 = tx({ accountId: 'rev', amount: -20000, counterparty: 'Kari Hansen' });
    const res = classifyTransactions([t1, t2, t3], [rev], [], ['Ola Nordmann Hansen']);
    expect(res.map((t) => t.kind)).toEqual(['internal_transfer', 'internal_transfer', 'normal']);
  });

  it('bruker tilgjengelig saldo når banken ikke oppgir bokført, og viser det', () => {
    const a = account({ id: 'a', bookedBalance: 100000, availableBalance: 90000 });
    const r = account({ id: 'r', bankName: 'Revolut', bookedBalance: null, availableBalance: 5000 });
    const s = balanceSummary({ accounts: [a, r], transactions: [], rates: [], settings: defaultSettings() });
    expect(s.booked.amount).toBe(105000);
    expect(s.booked.complete).toBe(true);
    expect(s.bookedSubstituted.map((x) => x.id)).toEqual(['r']);
  });

  it('setter urealistiske fremtidige datoer til i dag', () => {
    const t = mapTransactions(
      {
        account: { uid: 'u' },
        balances: [],
        error: null,
        transactions: [
          { transaction_amount: { currency: 'DKK', amount: '10' }, credit_debit_indicator: 'DBIT', status: 'PDNG', booking_date: '2027-09-28' },
          { transaction_amount: { currency: 'DKK', amount: '10' }, credit_debit_indicator: 'DBIT', status: 'BOOK', booking_date: '2026-09-28' },
        ],
      },
      'eb-u',
      'DKK',
      '2026-09-26',
    );
    expect(t.map((x) => x.bookingDate)).toEqual(['2026-09-26', '2026-09-28']);
  });
});
