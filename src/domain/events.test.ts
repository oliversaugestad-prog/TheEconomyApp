import { tx } from '../test/factories';
import { summarizeEvent, suggestEventTransactions } from './events';
import { mergeTransactions } from './reconcile';
import type { SpendEvent } from './types';

const ev: SpendEvent = {
  id: 'ev1',
  name: 'Marokko-tur',
  emoji: '✈️',
  budget: 1_500_000,
  currency: 'NOK',
  startDate: '2026-10-10',
  endDate: '2026-10-17',
  note: '',
  items: [{ id: 'i1', name: 'Kontanter', amount: 100_000, currency: 'NOK', date: '2026-10-11' }],
  archived: false,
  createdAt: '',
};
const rates = [{ currency: 'EUR', base: 'NOK', rate: 11.5, asOf: '', source: 'test' }];

describe('hendelser', () => {
  it('summerer koblede kjøp, refusjoner og utgifter uten kort mot budsjettet', () => {
    const txs = [
      tx({ accountId: 'k', amount: -450_000, counterparty: 'Norwegian', bookingDate: '2026-10-08', category: 'transport', eventId: 'ev1' }),
      tx({ accountId: 'k', amount: -20_000, currency: 'EUR', counterparty: 'Riad', bookingDate: '2026-10-11', category: 'restaurant', eventId: 'ev1' }),
      tx({ accountId: 'k', amount: 50_000, counterparty: 'Norwegian', bookingDate: '2026-10-20', kind: 'refund', category: 'transport', eventId: 'ev1' }),
      tx({ accountId: 'k', amount: -99_900, counterparty: 'Rema', bookingDate: '2026-10-12' }),
    ];
    const s = summarizeEvent(ev, txs, rates);
    // 4 500 + 200 EUR (2 300) − 500 refusjon + 1 000 kontanter = 7 300 kr
    expect(s.spent).toBe(730_000);
    expect(s.manual).toBe(100_000);
    expect(s.remaining).toBe(770_000);
    expect(s.status).toBe('ok');
    expect(s.byCategory[0]).toEqual({ category: 'transport', amount: 400_000 });
    expect(s.transactions).toHaveLength(3);
  });

  it('markerer når budsjettet er overskredet', () => {
    const s = summarizeEvent({ ...ev, budget: 500_000, items: [] }, [tx({ accountId: 'k', amount: -600_000, counterparty: 'Hotell', eventId: 'ev1' })], rates);
    expect(s.status).toBe('over');
    expect(s.remaining).toBe(-100_000);
  });

  it('foreslår ukoblede kjøp i perioden, inkludert to dager før start', () => {
    const txs = [
      tx({ id: 'a', accountId: 'k', amount: -1000, counterparty: 'Fly', bookingDate: '2026-10-08' }),
      tx({ id: 'b', accountId: 'k', amount: -1000, counterparty: 'For tidlig', bookingDate: '2026-10-07' }),
      tx({ id: 'c', accountId: 'k', amount: -1000, counterparty: 'Overføring', bookingDate: '2026-10-12', kind: 'internal_transfer' }),
      tx({ id: 'd', accountId: 'k', amount: -1000, counterparty: 'Alt koblet', bookingDate: '2026-10-12', eventId: 'annen' }),
      tx({ id: 'e', accountId: 'k', amount: -1000, counterparty: 'Middag', bookingDate: '2026-10-17' }),
    ];
    expect(suggestEventTransactions(ev, txs).map((t) => t.id)).toEqual(['a', 'e']);
  });

  it('beholder koblingen når banken oppdaterer transaksjonen', () => {
    const linked = tx({ accountId: 'k', amount: -1000, externalId: 'x1', eventId: 'ev1' });
    const fresh = { ...linked, id: 'ny', eventId: undefined, description: 'oppdatert' };
    const r = mergeTransactions([linked], [fresh]);
    expect(r.transactions[0].eventId).toBe('ev1');
  });
});
