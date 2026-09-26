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
    expect(guessCategory('Vipps*Storytel', '', -100)).toBe('abonnementer');
    expect(guessCategory('Rejsekort Som App', '', -100)).toBe('transport');
    expect(guessCategory('Udbetaling   PIZZA OTTO - ELMEG', '', -100)).toBe('restaurant');
    expect(guessCategory('Puregym Denmark As', '', -100)).toBe('abonnementer');
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
