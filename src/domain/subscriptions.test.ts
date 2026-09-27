import { tx } from '../test/factories';
import { account } from '../test/factories';
import { detectSubscriptions, intervalText, monthlyCost, nextChargeDate, perText, subscriptionTotals, yearlyCost } from './subscriptions';
import { estimateRemaining, upcomingPayments } from './upcoming';
import type { Subscription } from './types';

function sub(p: Partial<Subscription>): Subscription {
  return {
    id: 's',
    name: 'Test',
    amount: 10000,
    currency: 'NOK',
    interval: 'monthly',
    accountId: null,
    anchorDate: '2026-06-09',
    kind: 'subscription',
    status: 'active',
    endedAt: null,
    source: 'manual',
    matchKey: null,
    category: 'abonnementer',
    isDemo: false,
    ...p,
  };
}

describe('kostnader', () => {
  it('fordeler årsabonnement over 12 måneder', () => {
    expect(monthlyCost({ amount: 298800, interval: 'yearly' })).toBe(24900);
    expect(yearlyCost({ amount: 298800, interval: 'yearly' })).toBe(298800);
    expect(monthlyCost({ amount: 10000, interval: 'weekly' })).toBe(43333);
    expect(monthlyCost({ amount: 30000, interval: 'quarterly' })).toBe(10000);
  });

  it('summerer bare aktive abonnementer, ikke faste betalinger', () => {
    const t = subscriptionTotals(
      [
        sub({ id: '1', amount: 17900 }),
        sub({ id: '2', amount: 298800, interval: 'yearly' }),
        sub({ id: '3', amount: 13900, status: 'ended' }),
        sub({ id: '4', amount: 1450000, kind: 'fixed' }),
      ],
      'NOK',
      [],
    );
    expect(t.monthly.amount).toBe(17900 + 24900);
    expect(t.yearly.amount).toBe(17900 * 12 + 298800);
    expect(t.count).toBe(2);
  });
});

describe('nextChargeDate', () => {
  it('estimerer neste trekk fra kjent dato', () => {
    expect(nextChargeDate({ anchorDate: '2026-06-09', interval: 'monthly' }, '2026-09-26')).toBe('2026-10-09');
    expect(nextChargeDate({ anchorDate: '2026-06-09', interval: 'monthly' }, '2026-09-09')).toBe('2026-09-09');
    expect(nextChargeDate({ anchorDate: '2026-01-31', interval: 'monthly' }, '2026-02-10')).toBe('2026-02-28');
    expect(nextChargeDate({ anchorDate: '2026-01-31', interval: 'monthly' }, '2026-03-01')).toBe('2026-03-31');
    expect(nextChargeDate({ anchorDate: '2026-06-06', interval: 'yearly' }, '2026-09-26')).toBe('2027-06-06');
    expect(nextChargeDate({ anchorDate: '2026-09-01', interval: 'weekly' }, '2026-09-26')).toBe('2026-09-29');
  });
});

describe('detectSubscriptions', () => {
  const months = ['2026-06', '2026-07', '2026-08', '2026-09'];
  const netflix = months.map((m, i) => tx({ accountId: 'c', amount: i === 3 ? -17900 : -16900, counterparty: 'NETFLIX.COM', bookingDate: `${m}-09`, category: 'abonnementer' }));
  const rent = months.map((m) => tx({ accountId: 'b', amount: -1450000, counterparty: 'Bjerke Eiendom AS', bookingDate: `${m}-01`, category: 'bolig' }));
  const groceries = months.flatMap((m) => [3, 10, 17].map((d) => tx({ accountId: 'b', amount: -45000, counterparty: 'KIWI', bookingDate: `${m}-${String(d).padStart(2, '0')}`, category: 'dagligvarer' })));
  const transfers = months.map((m) => tx({ accountId: 'b', amount: -500000, counterparty: 'Sparekonto', kind: 'internal_transfer', bookingDate: `${m}-25` }));
  const all = [...netflix, ...rent, ...groceries, ...transfers];

  it('foreslår gjentakende trekk og markerer prisendring', () => {
    const s = detectSubscriptions(all, [], []);
    const n = s.find((x) => x.matchKey === 'netflix');
    expect(n).toMatchObject({ interval: 'monthly', amount: 17900, kind: 'subscription', occurrences: 4 });
    expect(n?.priceChange).toEqual({ from: 16900, to: 17900, date: '2026-09-09' });
  });

  it('skiller faste betalinger (husleie) fra abonnementer', () => {
    const s = detectSubscriptions(all, [], []);
    expect(s.find((x) => x.matchKey === 'bjerke eiendom')?.kind).toBe('fixed');
  });

  it('ignorerer dagligvarer, overføringer, bekreftede og avviste', () => {
    const s = detectSubscriptions(all, [sub({ matchKey: 'netflix' })], ['bjerke eiendom']);
    expect(s.map((x) => x.matchKey)).toEqual([]);
  });
});

describe('kommende betalinger og estimert igjen', () => {
  const bruk = account({ id: 'bruk', availableBalance: 2_000_000 });
  const card = account({
    id: 'card',
    name: 'Kort A',
    type: 'credit_card',
    bookedBalance: -500_000,
    card: { issuer: 'X', last4: '1', creditLimit: 3_000_000, statement: { amount: 400_000, minimumPayment: 30_000, dueDate: '2026-09-28', source: 'provider', updatedAt: '' } },
  });
  const subs = [
    sub({ id: 'rent', name: 'Husleie', amount: 1_450_000, kind: 'fixed', accountId: 'bruk', anchorDate: '2026-07-01' }),
    sub({ id: 'nf', name: 'Netflix', amount: 17_900, accountId: 'card', anchorDate: '2026-07-09' }),
  ];

  it('lister kjente betalinger med estimert/oppgitt kilde', () => {
    const up = upcomingPayments(subs, [bruk, card], '2026-09-26', 30);
    expect(up.map((u) => [u.name, u.date, u.estimated])).toEqual([
      ['Faktura Kort A', '2026-09-28', false],
      ['Husleie', '2026-10-01', true],
      ['Netflix', '2026-10-09', true],
    ]);
  });

  it('trekker ikke kortabonnement og kortgjeld dobbelt', () => {
    const up = upcomingPayments(subs, [bruk, card], '2026-09-26', 30);
    const est = estimateRemaining([bruk, card], up, 'NOK', []);
    // 20 000 − faktura 4 000 − husleie 14 500. Netflix ligger på kortet og trekkes ikke separat.
    expect(est.remaining).toBe(2_000_000 - 400_000 - 1_450_000);
    expect(est.deductions.map((d) => d.name)).not.toContain('Netflix');
    expect(est.complete).toBe(true);
  });

  it('bruker gjeld nå som anslag når kortfaktura mangler', () => {
    const noBill = { ...card, card: { ...card.card!, statement: null } };
    const est = estimateRemaining([bruk, noBill], upcomingPayments(subs, [bruk, noBill], '2026-09-26'), 'NOK', []);
    expect(est.complete).toBe(true);
    expect(est.remaining).toBe(2_000_000 - 500_000 - 1_450_000);
    expect(est.notes.join(' ')).toMatch(/brukt som anslag/);
  });

  it('er ufullstendig når både faktura og gjeld er ukjent', () => {
    const unknown = { ...card, bookedBalance: null, card: { ...card.card!, statement: null } };
    const est = estimateRemaining([bruk, unknown], upcomingPayments(subs, [bruk, unknown], '2026-09-26'), 'NOK', []);
    expect(est.complete).toBe(false);
    expect(est.notes.join(' ')).toMatch(/Gjelden er ukjent/);
  });
});

describe('abonnementer med ujevnt mønster fra ekte banker', () => {
  it('samler Spotify med ulike referansekoder og to trekk samme dag', () => {
    const s = detectSubscriptions(
      [
        tx({ accountId: 'r', amount: -7500, counterparty: 'SpotifySE', bookingDate: '2026-07-21', category: 'abonnementer' }),
        tx({ accountId: 'r', amount: -7500, counterparty: 'Spotify P4608E110B', bookingDate: '2026-08-25', category: 'abonnementer' }),
        tx({ accountId: 'r', amount: -7500, counterparty: 'Spotify P471779FF7', bookingDate: '2026-09-21', category: 'abonnementer' }),
        tx({ accountId: 'r', amount: -7500, counterparty: 'Spotify P471779FF7', bookingDate: '2026-09-21', category: 'abonnementer' }),
      ],
      [],
      [],
    );
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ matchKey: 'spotify', name: 'Spotify', interval: 'monthly', amount: 7500, occurrences: 4 });
    expect(s[0].confidence).toBeLessThan(0.5);
  });

  it('foreslår mobilabonnement med flere trekk per måned som månedens sum', () => {
    const s = detectSubscriptions(
      [
        tx({ accountId: 'l', amount: -11500, counterparty: 'Eesy.dk', bookingDate: '2026-08-01', category: 'abonnementer' }),
        tx({ accountId: 'l', amount: -500, counterparty: 'Eesy.dk', bookingDate: '2026-08-02', category: 'abonnementer' }),
        tx({ accountId: 'l', amount: -13500, counterparty: 'Eesy.dk', bookingDate: '2026-09-02', category: 'abonnementer' }),
        tx({ accountId: 'l', amount: -500, counterparty: 'Eesy.dk', bookingDate: '2026-09-03', category: 'abonnementer' }),
      ],
      [],
      [],
    );
    expect(s[0]).toMatchObject({ matchKey: 'eesy', amount: 13000, anchorDate: '2026-09-02' });
  });

  it('foreslår ikke gamle engangskjøp eller kjøp i andre kategorier', () => {
    const s = detectSubscriptions(
      [
        tx({ accountId: 'a', amount: -9900, counterparty: 'Audible Uk', bookingDate: '2026-06-01', category: 'abonnementer' }),
        tx({ accountId: 'a', amount: -40000, counterparty: 'Zalando', bookingDate: '2026-09-20', category: 'shopping' }),
      ],
      [],
      [],
    );
    expect(s).toHaveLength(0);
  });

  it('hopper over tjenester som allerede er bekreftet', () => {
    const s = detectSubscriptions([tx({ accountId: 'r', amount: -7500, counterparty: 'Spotify P471779FF7', bookingDate: '2026-09-21', category: 'abonnementer' })], [], ['spotify']);
    expect(s).toHaveLength(0);
  });
});

describe('abonnement hver N. måned', () => {
  const sub = { amount: 40_000, interval: 'months' as const, everyMonths: 4 };
  it('fordeles jevnt i den månedlige summen', () => {
    expect(monthlyCost(sub)).toBe(10_000);
    expect(yearlyCost(sub)).toBe(120_000);
    expect(intervalText(sub)).toBe('Hver 4. måned');
    expect(perText(sub)).toBe('/ 4 mnd');
  });
  it('estimerer neste trekk fire måneder frem', () => {
    expect(nextChargeDate({ anchorDate: '2026-06-15', interval: 'months', everyMonths: 4 }, '2026-09-27')).toBe('2026-10-15');
    expect(nextChargeDate({ anchorDate: '2026-06-15', interval: 'months', everyMonths: 4 }, '2026-10-16')).toBe('2027-02-15');
  });
});
