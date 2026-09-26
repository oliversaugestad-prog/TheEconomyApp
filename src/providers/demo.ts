import { addDays, addMonths, monthKey, shiftMonth } from '../domain/dates';
import type { Account, Connection, ExchangeRate, IsoDate, Minor, Subscription, Transaction } from '../domain/types';
import type { BankDataProvider, InitialData, SyncContext, SyncOutcome } from './types';

/**
 * Syntetiske, norske demodata. Bankene er fiktive («Nordlys Bank»,
 * «Fjordsparebanken», «Vidde Kreditt») slik at ingen kan forveksle demoen med en
 * ekte banktilkobling. Dataene genereres deterministisk relativt til dagens dato.
 */

const kr = (n: number): Minor => Math.round(n * 100);

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const DEMO_IDS = {
  nordlys: 'demo-conn-nordlys',
  fjord: 'demo-conn-fjord',
  vidde: 'demo-conn-vidde',
  bruk: 'demo-acc-bruk',
  spar: 'demo-acc-spar',
  eur: 'demo-acc-eur',
  felles: 'demo-acc-felles',
  bsu: 'demo-acc-bsu',
  visa: 'demo-card-visa',
  mc: 'demo-card-mc',
} as const;

const OPENING: Record<string, Minor> = {
  [DEMO_IDS.bruk]: kr(18_400),
  [DEMO_IDS.spar]: kr(142_000),
  [DEMO_IDS.eur]: kr(850),
  [DEMO_IDS.felles]: kr(4_200),
  [DEMO_IDS.bsu]: kr(55_000),
  [DEMO_IDS.visa]: kr(-4_312.5),
  [DEMO_IDS.mc]: kr(-6_870.3),
};

/** Kilden oppgir tilgjengelig saldo for disse kontoene (inkl. reservasjoner). */
const PROVIDES_AVAILABLE = new Set<string>([DEMO_IDS.bruk, DEMO_IDS.spar, DEMO_IDS.eur, DEMO_IDS.felles, DEMO_IDS.visa, DEMO_IDS.mc]);

function isoMinus(now: Date, minutes: number): string {
  return new Date(now.getTime() - minutes * 60_000).toISOString();
}

function baseAccounts(): Omit<Account, 'bookedBalance' | 'availableBalance' | 'balanceUpdatedAt'>[] {
  const common = { includedInOverview: true, isDemo: true, source: 'demo' as const, availableIncludesReservations: true };
  return [
    { ...common, id: DEMO_IDS.bruk, connectionId: DEMO_IDS.nordlys, bankName: 'Nordlys Bank', name: 'Brukskonto', type: 'checking', currency: 'NOK', maskedNumber: '•••• •• 40 213' },
    { ...common, id: DEMO_IDS.spar, connectionId: DEMO_IDS.nordlys, bankName: 'Nordlys Bank', name: 'Sparekonto', type: 'savings', currency: 'NOK', maskedNumber: '•••• •• 40 988' },
    { ...common, id: DEMO_IDS.eur, connectionId: DEMO_IDS.nordlys, bankName: 'Nordlys Bank', name: 'Valutakonto EUR', type: 'checking', currency: 'EUR', maskedNumber: '•••• •• 71 506' },
    { ...common, id: DEMO_IDS.felles, connectionId: DEMO_IDS.fjord, bankName: 'Fjordsparebanken', name: 'Felleskonto', type: 'checking', currency: 'NOK', maskedNumber: '•••• •• 12 047' },
    { ...common, id: DEMO_IDS.bsu, connectionId: DEMO_IDS.fjord, bankName: 'Fjordsparebanken', name: 'BSU', type: 'bsu', currency: 'NOK', maskedNumber: '•••• •• 12 330' },
    {
      ...common,
      id: DEMO_IDS.visa,
      connectionId: DEMO_IDS.nordlys,
      bankName: 'Nordlys Bank',
      name: 'Nordlys Visa',
      type: 'credit_card',
      currency: 'NOK',
      maskedNumber: '•••• 4417',
      card: { issuer: 'Nordlys Bank', last4: '4417', creditLimit: kr(30_000), statement: null },
    },
    {
      ...common,
      id: DEMO_IDS.mc,
      connectionId: DEMO_IDS.vidde,
      bankName: 'Vidde Kreditt',
      name: 'Vidde Mastercard',
      type: 'credit_card',
      currency: 'NOK',
      maskedNumber: '•••• 9082',
      card: { issuer: 'Vidde Kreditt', last4: '9082', creditLimit: kr(50_000), statement: null },
    },
  ];
}

interface RawTx {
  accountId: string;
  date: IsoDate;
  amount: Minor;
  counterparty: string;
  description: string;
  status?: 'booked' | 'pending';
  currency?: string;
}

function toTransaction(r: RawTx, n: number): Transaction {
  const ext = `${r.status === 'pending' ? 'p' : 'b'}-${r.accountId}-${r.date}-${n}`;
  return {
    id: `demo-tx-${ext}`,
    accountId: r.accountId,
    externalId: ext,
    bookingDate: r.date,
    amount: r.amount,
    currency: r.currency ?? 'NOK',
    counterparty: r.counterparty,
    description: r.description,
    status: r.status ?? 'booked',
    category: 'annet',
    kind: 'normal',
    linkedTransactionId: null,
    userCategorized: false,
    userKind: false,
    isDemo: true,
    source: 'demo',
  };
}

/** Siste vellykkede synkronisering for Vidde Kreditt ligger tre dager tilbake. */
export const VIDDE_STALE_DAYS = 3;

export function generateDemoData(today: IsoDate, now: Date = new Date()): InitialData {
  const rand = mulberry32(20260926);
  const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
  const between = (a: number, b: number) => Math.round((a + rand() * (b - a)) * 100) / 100;

  const currentMonth = monthKey(today);
  const startMonth = shiftMonth(currentMonth, -3);
  const start = `${startMonth}-01`;
  const viddeCutoff = addDays(today, -VIDDE_STALE_DAYS);
  const raw: RawTx[] = [];
  const add = (r: RawTx) => {
    if (r.date > today || r.date < start) return;
    if (r.accountId === DEMO_IDS.mc && r.date > viddeCutoff) return; // ikke synkronisert
    raw.push(r);
  };

  const months: string[] = [];
  for (let m = startMonth; m <= currentMonth; m = shiftMonth(m, 1)) months.push(m);
  const d = (m: string, day: number) => `${m}-${String(day).padStart(2, '0')}`;

  // Faste hendelser per måned
  months.forEach((m, mi) => {
    add({ accountId: DEMO_IDS.bruk, date: d(m, 1), amount: kr(-14_500), counterparty: 'Bjerke Eiendom AS', description: 'Husleie' });
    add({ accountId: DEMO_IDS.bruk, date: d(m, 3), amount: kr(-449), counterparty: 'TELENOR NORGE AS', description: 'Mobilabonnement' });
    add({ accountId: DEMO_IDS.bruk, date: d(m, 5), amount: kr(-between(640, 1580)), counterparty: 'Fjordkraft', description: 'Strøm' });
    add({ accountId: DEMO_IDS.bruk, date: d(m, 10), amount: kr(-890), counterparty: 'Ruter', description: '30-dagersbillett' });
    add({ accountId: DEMO_IDS.bruk, date: d(m, 15), amount: kr(-599), counterparty: 'SATS NORGE AS', description: 'Treningsavgift' });
    add({ accountId: DEMO_IDS.bruk, date: d(m, 25), amount: kr(48_500), counterparty: 'Nordvik Teknologi AS', description: 'Lønn' });
    add({ accountId: DEMO_IDS.bruk, date: d(m, 25), amount: kr(-5_000), counterparty: 'Sparekonto', description: 'Overføring til egen konto' });
    add({ accountId: DEMO_IDS.spar, date: d(m, 25), amount: kr(5_000), counterparty: 'Brukskonto', description: 'Overføring fra egen konto' });
    add({ accountId: DEMO_IDS.bruk, date: d(m, 25), amount: kr(-6_000), counterparty: 'Felleskonto Fjordsparebanken', description: 'Overføring' });
    add({ accountId: DEMO_IDS.felles, date: d(m, 26), amount: kr(6_000), counterparty: 'Nordlys Bank', description: 'Overføring fra Brukskonto' });
    add({ accountId: DEMO_IDS.felles, date: d(m, 27), amount: kr(-2_291.67), counterparty: 'BSU', description: 'Sparing BSU' });
    add({ accountId: DEMO_IDS.bsu, date: d(m, 27), amount: kr(2_291.67), counterparty: 'Felleskonto', description: 'Sparing BSU' });

    // Abonnementer på kort
    add({ accountId: DEMO_IDS.visa, date: d(m, 7), amount: kr(-139), counterparty: 'SPOTIFY', description: 'Spotify Premium' });
    add({ accountId: DEMO_IDS.visa, date: d(m, 12), amount: kr(-39), counterparty: 'APPLE.COM/BILL', description: 'iCloud+ 50 GB' });
    const netflixPrice = mi === months.length - 1 ? 179 : 169;
    add({ accountId: DEMO_IDS.mc, date: d(m, 9), amount: kr(-netflixPrice), counterparty: 'NETFLIX.COM', description: 'Netflix Standard' });
    add({ accountId: DEMO_IDS.mc, date: d(m, 18), amount: kr(-129), counterparty: 'Max', description: 'Max Basis' });
  });

  // Engangshendelser
  add({ accountId: DEMO_IDS.bruk, date: d(startMonth, 6), amount: kr(-2_988), counterparty: 'AFTENPOSTEN', description: 'Årsabonnement Aftenposten Digital' });
  add({ accountId: DEMO_IDS.bruk, date: d(shiftMonth(currentMonth, -2), 20), amount: kr(3_412), counterparty: 'Skatteetaten', description: 'Tilbakebetaling skatt' });
  const zalandoDate = d(shiftMonth(currentMonth, -1), 4);
  add({ accountId: DEMO_IDS.mc, date: zalandoDate, amount: kr(-899), counterparty: 'ZALANDO SE', description: 'Nettkjøp' });
  add({ accountId: DEMO_IDS.mc, date: addDays(zalandoDate, 13), amount: kr(899), counterparty: 'ZALANDO SE', description: 'Refusjon retur' });
  add({ accountId: DEMO_IDS.visa, date: d(shiftMonth(currentMonth, -2), 14), amount: kr(-4_490), counterparty: 'Elkjøp', description: 'Kaffemaskin' });
  add({ accountId: DEMO_IDS.visa, date: d(shiftMonth(currentMonth, -2), 22), amount: kr(750), counterparty: 'Elkjøp', description: 'Prisgaranti – delvis refusjon' });
  // Utenlandstur (EUR)
  const trip = shiftMonth(currentMonth, -2);
  [
    [3, -45.2, 'MERCADONA', 'Dagligvarer'],
    [3, -62.5, 'Restaurante La Mar', 'Restaurant'],
    [4, -18.9, 'Taxi Valencia', 'Taxi'],
    [5, -120, 'Hotel Marina', 'Hotell'],
    [6, -34.75, 'Farmacia Central', 'Apotek'],
  ].forEach(([day, amount, cp, desc]) =>
    add({ accountId: DEMO_IDS.eur, date: d(trip, day as number), amount: kr(amount as number), counterparty: cp as string, description: desc as string, currency: 'EUR' }),
  );

  // Varierende kjøp
  const grocers = ['KIWI', 'REMA 1000', 'Coop Extra', 'MENY', 'Joker'];
  for (let day = start; day <= today; day = addDays(day, 1)) {
    if (rand() < 0.42) add({ accountId: DEMO_IDS.bruk, date: day, amount: kr(-between(89, 780)), counterparty: pick(grocers), description: 'Varekjøp' });
    if (rand() < 0.12) add({ accountId: DEMO_IDS.felles, date: day, amount: kr(-between(850, 1650)), counterparty: 'Oda', description: 'Matlevering' });
    if (rand() < 0.14) add({ accountId: DEMO_IDS.visa, date: day, amount: kr(-between(180, 520)), counterparty: pick(['Foodora', 'Peppes Pizza', 'Espresso House', 'Wolt']), description: 'Varekjøp' });
    if (rand() < 0.07) add({ accountId: DEMO_IDS.mc, date: day, amount: kr(-between(450, 980)), counterparty: pick(['Circle K', 'Uno-X']), description: 'Drivstoff' });
    if (rand() < 0.05) add({ accountId: DEMO_IDS.mc, date: day, amount: kr(-between(120, 450)), counterparty: 'Apotek 1', description: 'Varekjøp' });
    if (rand() < 0.04) add({ accountId: DEMO_IDS.visa, date: day, amount: kr(-between(299, 1899)), counterparty: pick(['XXL', 'H&M', 'Clas Ohlson', 'Komplett']), description: 'Varekjøp' });
    if (rand() < 0.035) add({ accountId: DEMO_IDS.mc, date: day, amount: kr(-between(150, 420)), counterparty: pick(['Nordisk Film Kino', 'Ticketmaster']), description: 'Billetter' });
    if (rand() < 0.03) add({ accountId: DEMO_IDS.bruk, date: day, amount: kr(-between(249, 1299)), counterparty: 'Vy', description: 'Togbillett' });
  }

  // Kortbetalinger: hele forrige måneds kortsaldo betales hver måned.
  const cardPlans = [
    { card: DEMO_IDS.visa, name: 'Nordlys Visa', bank: 'Nordlys Bank', day: 20 },
    { card: DEMO_IDS.mc, name: 'Vidde Mastercard', bank: 'Vidde Kreditt', day: 28 },
  ];
  for (const plan of cardPlans) {
    months.forEach((m, mi) => {
      const prev = shiftMonth(m, -1);
      const amount =
        mi === 0
          ? -OPENING[plan.card]
          : -raw.filter((r) => r.accountId === plan.card && monthKey(r.date) === prev && !r.description.startsWith('Innbetaling')).reduce((s, r) => s + r.amount, 0);
      if (amount <= 0) return;
      add({ accountId: DEMO_IDS.bruk, date: d(m, plan.day), amount: -amount, counterparty: plan.bank, description: `Innbetaling kredittkort ${plan.name}` });
      add({ accountId: plan.card, date: d(m, plan.day), amount, counterparty: 'Innbetaling', description: 'Innbetaling fra Brukskonto' });
    });
  }

  // Reservasjoner (ikke bokført ennå)
  add({ accountId: DEMO_IDS.bruk, date: addDays(today, -1), amount: kr(-312.4), counterparty: 'KIWI', description: 'Varekjøp', status: 'pending' });
  add({ accountId: DEMO_IDS.visa, date: today, amount: kr(-289), counterparty: 'Foodora', description: 'Varekjøp', status: 'pending' });
  add({ accountId: DEMO_IDS.felles, date: today, amount: kr(-1_184.9), counterparty: 'Oda', description: 'Matlevering', status: 'pending' });

  const transactions = raw
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((r, i) => toTransaction(r, i));

  const accounts: Account[] = baseAccounts().map((a) => ({
    ...a,
    ...computeBalances(a.id, transactions),
    balanceUpdatedAt: a.connectionId === DEMO_IDS.vidde ? isoMinus(now, VIDDE_STALE_DAYS * 1440 + 95) : isoMinus(now, 12),
  }));

  // Faktura fra kortutsteder (Vidde oppgir faktura; Nordlys Visa gjør ikke det).
  const lastMonth = shiftMonth(currentMonth, -1);
  const mcStatement = -transactions
    .filter((t) => t.accountId === DEMO_IDS.mc && monthKey(t.bookingDate) === lastMonth && t.description !== 'Innbetaling fra Brukskonto')
    .reduce((s, t) => s + t.amount, 0);
  const mc = accounts.find((a) => a.id === DEMO_IDS.mc)!;
  mc.card!.statement = {
    amount: mcStatement,
    minimumPayment: Math.max(kr(300), Math.round(mcStatement * 0.03)),
    dueDate: `${currentMonth}-28`,
    source: 'provider',
    updatedAt: isoMinus(now, VIDDE_STALE_DAYS * 1440 + 95),
  };

  const connections: Connection[] = [
    {
      id: DEMO_IDS.nordlys,
      providerId: 'demo',
      institutionName: 'Nordlys Bank',
      status: 'ok',
      lastSuccessfulSync: isoMinus(now, 12),
      lastAttempt: isoMinus(now, 12),
      error: null,
      consentExpiresAt: addMonths(today, 5) + 'T00:00:00.000Z',
      isDemo: true,
      source: 'demo',
    },
    {
      id: DEMO_IDS.fjord,
      providerId: 'demo',
      institutionName: 'Fjordsparebanken',
      status: 'ok',
      lastSuccessfulSync: isoMinus(now, 12),
      lastAttempt: isoMinus(now, 12),
      error: null,
      consentExpiresAt: addMonths(today, 2) + 'T00:00:00.000Z',
      isDemo: true,
      source: 'demo',
    },
    {
      id: DEMO_IDS.vidde,
      providerId: 'demo',
      institutionName: 'Vidde Kreditt',
      status: 'reauth_required',
      lastSuccessfulSync: isoMinus(now, VIDDE_STALE_DAYS * 1440 + 95),
      lastAttempt: isoMinus(now, 12),
      error: 'Samtykket har utløpt. Koble til på nytt for å hente nye data.',
      consentExpiresAt: isoMinus(now, 2 * 1440),
      isDemo: true,
      source: 'demo',
    },
  ];

  const subscriptions: Subscription[] = [
    {
      id: 'demo-sub-aftenposten',
      name: 'Aftenposten Digital',
      amount: kr(2_988),
      currency: 'NOK',
      interval: 'yearly',
      accountId: DEMO_IDS.bruk,
      anchorDate: d(startMonth, 6),
      kind: 'subscription',
      status: 'active',
      endedAt: null,
      source: 'manual',
      matchKey: 'aftenposten',
      category: 'abonnementer',
      isDemo: true,
    },
  ];

  const asOf = `${today}T06:00:00.000Z`;
  const rates: ExchangeRate[] = [
    { currency: 'EUR', base: 'NOK', rate: 11.72, asOf, source: 'Demokurs (fast verdi, ikke markedskurs)' },
    { currency: 'SEK', base: 'NOK', rate: 1.01, asOf, source: 'Demokurs (fast verdi, ikke markedskurs)' },
    { currency: 'USD', base: 'NOK', rate: 10.48, asOf, source: 'Demokurs (fast verdi, ikke markedskurs)' },
  ];

  return { connections, accounts, transactions, subscriptions, rates };
}

function computeBalances(accountId: string, transactions: Transaction[]) {
  const own = transactions.filter((t) => t.accountId === accountId);
  const booked = (OPENING[accountId] ?? 0) + own.filter((t) => t.status === 'booked').reduce((s, t) => s + t.amount, 0);
  const pending = own.filter((t) => t.status === 'pending').reduce((s, t) => s + t.amount, 0);
  const acc = baseAccounts().find((a) => a.id === accountId);
  let available: Minor | null = null;
  if (PROVIDES_AVAILABLE.has(accountId)) {
    available = acc?.card ? acc.card.creditLimit! + booked + pending : booked + pending;
  }
  return { bookedBalance: booked, availableBalance: available };
}

/**
 * Demotilbyder. «Synkronisering» henter de siste dagene på nytt (for å vise at
 * gjentatt henting ikke gir duplikater), bokfører reservasjonene og legger til
 * et nytt kjøp. Vidde Kreditt svarer at samtykket må fornyes.
 */
export const demoProvider: BankDataProvider = {
  id: 'demo',
  name: 'Demodata',
  isDemo: true,
  availability: () => ({ available: true }),
  async sync(connection: Connection, ctx: SyncContext): Promise<SyncOutcome> {
    await new Promise((r) => setTimeout(r, 900));
    const nowIso = ctx.now.toISOString();
    if (connection.id === DEMO_IDS.vidde && connection.status === 'reauth_required') {
      return {
        ok: false,
        connection: { ...connection, status: 'reauth_required', lastAttempt: nowIso, error: 'Samtykket har utløpt. Koble til på nytt for å hente nye data.' },
        reason: 'reauth',
        message: 'Vidde Kreditt krever ny tilkobling (demo).',
      };
    }
    const accounts = ctx.accounts.filter((a) => a.connectionId === connection.id);
    const accIds = new Set(accounts.map((a) => a.id));
    const today = nowIso.slice(0, 10);
    const own = ctx.transactions.filter((t) => accIds.has(t.accountId) && t.source === 'demo');
    const incoming: Transaction[] = [];

    // Samme transaksjoner igjen (siste 10 dager) – skal ikke gi duplikater.
    for (const t of own) {
      if (t.status === 'booked' && t.bookingDate >= addDays(today, -10)) incoming.push({ ...t });
    }
    // Reservasjoner bokføres. Den ene med ID-kobling, den andre uten (matches heuristisk).
    own
      .filter((t) => t.status === 'pending')
      .forEach((p, i) => {
        const ext = `b-sync-${p.externalId}`;
        incoming.push({
          ...p,
          id: `demo-tx-${ext}`,
          externalId: ext,
          status: 'booked',
          bookingDate: today > p.bookingDate ? today : p.bookingDate,
          replacesPendingExternalId: i % 2 === 0 ? p.externalId : null,
        });
      });
    // Et nytt kjøp dukker opp som reservasjon.
    const alreadyHasNew = own.some((t) => t.counterparty === 'REMA 1000' && t.amount === kr(-147.9) && t.bookingDate === today);
    if (connection.id === DEMO_IDS.nordlys && !alreadyHasNew) {
      const ext = `p-${DEMO_IDS.bruk}-${nowIso}`;
      incoming.push({
        id: `demo-tx-${ext}`,
        accountId: DEMO_IDS.bruk,
        externalId: ext,
        bookingDate: today,
        amount: kr(-147.9),
        currency: 'NOK',
        counterparty: 'REMA 1000',
        description: 'Varekjøp',
        status: 'pending',
        category: 'annet',
        kind: 'normal',
        linkedTransactionId: null,
        userCategorized: false,
        userKind: false,
        isDemo: true,
        source: 'demo',
      });
    }

    // Nye saldoer: bokført saldo endres med nylig bokførte beløp.
    const updatedAccounts = accounts.map((a) => {
      const newlyBooked = incoming
        .filter((t) => t.accountId === a.id && t.status === 'booked' && t.externalId?.startsWith('b-sync-'))
        .reduce((s, t) => s + t.amount, 0);
      const pendingNow = incoming.filter((t) => t.accountId === a.id && t.status === 'pending').reduce((s, t) => s + t.amount, 0);
      const booked = a.bookedBalance === null ? null : a.bookedBalance + newlyBooked;
      let available = a.availableBalance;
      if (available !== null && booked !== null) {
        available = a.card ? (a.card.creditLimit ?? 0) + booked + pendingNow : booked + pendingNow;
      }
      return { ...a, bookedBalance: booked, availableBalance: available, balanceUpdatedAt: nowIso };
    });

    return {
      ok: true,
      connection: { ...connection, status: 'ok', lastAttempt: nowIso, lastSuccessfulSync: nowIso, error: null },
      accounts: updatedAccounts,
      transactions: incoming,
      pendingComplete: true,
    };
  },
};
