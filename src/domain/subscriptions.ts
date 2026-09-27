import { CATEGORY_BY_ID, cleanCounterparty, normalizeCounterparty } from './categories';
import { addDays, addMonths, daysBetween, parseIsoDate } from './dates';
import { convert, sumMoney, type MoneySum } from './money';
import type { BillingInterval, CategoryId, CurrencyCode, ExchangeRate, IsoDate, Minor, Subscription, Transaction } from './types';

export const INTERVAL_LABEL: Record<BillingInterval, string> = {
  weekly: 'Ukentlig',
  monthly: 'Månedlig',
  quarterly: 'Kvartalsvis',
  yearly: 'Årlig',
  months: 'Hver … måned',
};

type IntervalOf = Pick<Subscription, 'interval' | 'everyMonths'>;

/** Måneder mellom trekk (ukentlig håndteres for seg). */
export function monthsBetween(sub: IntervalOf): number {
  switch (sub.interval) {
    case 'weekly':
      return 12 / 52;
    case 'monthly':
      return 1;
    case 'quarterly':
      return 3;
    case 'yearly':
      return 12;
    case 'months':
      return Math.min(36, Math.max(1, Math.round(sub.everyMonths ?? 2)));
  }
}

/** «Månedlig», «Hver 4. måned» osv. */
export function intervalText(sub: IntervalOf): string {
  return sub.interval === 'months' ? `Hver ${monthsBetween(sub)}. måned` : INTERVAL_LABEL[sub.interval];
}

/** Kort enhet rett etter beløpet: «/ mnd», «/ år», «/ 4 mnd». */
export function perText(sub: IntervalOf): string {
  switch (sub.interval) {
    case 'weekly':
      return '/ uke';
    case 'monthly':
      return '/ mnd';
    case 'quarterly':
      return '/ kvartal';
    case 'yearly':
      return '/ år';
    case 'months':
      return `/ ${monthsBetween(sub)} mnd`;
  }
}

/**
 * Månedlig kostnad. Abonnementer som trekkes sjeldnere enn månedlig fordeles jevnt
 * (f.eks. 400 kr hver 4. måned = 100 kr/mnd), slik at månedssammenligningen blir rettferdig.
 */
export function monthlyCost(sub: Pick<Subscription, 'amount' | 'interval' | 'everyMonths'>): Minor {
  if (sub.interval === 'weekly') return Math.round((sub.amount * 52) / 12);
  return Math.round(sub.amount / monthsBetween(sub));
}

export function yearlyCost(sub: Pick<Subscription, 'amount' | 'interval' | 'everyMonths'>): Minor {
  if (sub.interval === 'weekly') return sub.amount * 52;
  return Math.round((sub.amount * 12) / monthsBetween(sub));
}

function step(date: IsoDate, sub: IntervalOf, n: number, day: number): IsoDate {
  if (sub.interval === 'weekly') return addDays(date, 7 * n);
  return addMonths(date, monthsBetween(sub) * n, day);
}

/**
 * Estimert neste trekk (på eller etter `today`), beregnet fra kjent trekkdato
 * og intervall. Dette er et anslag – ikke en opplysning fra leverandøren.
 */
export function nextChargeDate(sub: Pick<Subscription, 'anchorDate' | 'interval' | 'everyMonths'>, today: IsoDate): IsoDate {
  const day = parseIsoDate(sub.anchorDate).getUTCDate();
  let n = 0;
  let d = sub.anchorDate;
  // Hopp tilnærmet frem først for å unngå lange løkker.
  if (sub.interval !== 'weekly') {
    const months = Math.max(0, Math.floor(daysBetween(sub.anchorDate, today) / 31) - 1);
    n = Math.floor(months / monthsBetween(sub));
    d = step(sub.anchorDate, sub, n, day);
  }
  while (d < today) {
    n += 1;
    d = step(sub.anchorDate, sub, n, day);
  }
  return d;
}

export interface SubscriptionTotals {
  monthly: MoneySum;
  yearly: MoneySum;
  count: number;
}

/**
 * Sum av aktive abonnementer. `scope` skiller private abonnementer fra bedriftens
 * abonnementer som eier betaler privat (standard: bare private).
 */
export function subscriptionTotals(
  subs: Subscription[],
  base: CurrencyCode,
  rates: ExchangeRate[],
  kind: Subscription['kind'] | 'all' = 'subscription',
  scope: 'private' | 'business' | 'all' = 'private',
): SubscriptionTotals {
  const active = subs.filter(
    (s) => s.status === 'active' && (kind === 'all' || s.kind === kind) && (scope === 'all' || (scope === 'business') === !!s.business),
  );
  return {
    monthly: sumMoney(
      active.map((s) => ({
        id: s.id,
        label: s.name,
        amount: monthlyCost(s),
        currency: s.currency,
      })),
      base,
      rates,
    ),
    yearly: sumMoney(
      active.map((s) => ({
        id: s.id,
        label: s.name,
        amount: yearlyCost(s),
        currency: s.currency,
      })),
      base,
      rates,
    ),
    count: active.length,
  };
}

/** Kjente tjenester som banken skriver på mange måter («Spotify P4608E110B», «SpotifySE»). */
const BRANDS: Array<[RegExp, string]> = [
  [/netflix/, 'netflix'],
  [/spotify/, 'spotify'],
  [/storytel/, 'storytel'],
  [/audible/, 'audible'],
  [/viaplay/, 'viaplay'],
  [/disney/, 'disney'],
  [/\bhbo|\bmax\.com/, 'hbo'],
  [/youtube/, 'youtube'],
  [/tidal/, 'tidal'],
  [/adobe/, 'adobe'],
  [/puregym/, 'puregym'],
  [/eesy/, 'eesy'],
  [/anthropic|claude\.ai/, 'anthropic'],
  [/openai|chatgpt/, 'openai'],
  [/apple\.com\/bill|itunes|icloud/, 'apple'],
];

/**
 * Nøkkel som samler trekk fra samme tjeneste. Kjente tjenester får fast navn, og
 * referansekoder med tall (f.eks. «P471779FF7») fjernes.
 */
export function subscriptionKey(counterparty: string): string {
  const lower = cleanCounterparty(counterparty).toLowerCase();
  for (const [re, key] of BRANDS) if (re.test(lower)) return key;
  return normalizeCounterparty(lower.replace(/\b(?=[a-z]*\d)[a-z0-9]{6,}\b/g, ' '));
}

/** Trekk som tilhører et abonnement (samme tjeneste), nyeste sist. */
export function chargesFor(sub: Pick<Subscription, 'matchKey'>, transactions: Transaction[]): Transaction[] {
  if (!sub.matchKey) return [];
  return transactions
    .filter((t) => t.amount < 0 && (t.kind === 'normal' || t.kind === 'business') && (subscriptionKey(t.counterparty) === sub.matchKey || normalizeCounterparty(t.counterparty) === sub.matchKey))
    .sort((a, b) => a.bookingDate.localeCompare(b.bookingDate));
}

export interface PriceChange {
  from: Minor;
  to: Minor;
  date: IsoDate;
}

/** Mulig prisendring: siste trekk avviker fra forrige. */
export function detectPriceChange(charges: Transaction[]): PriceChange | null {
  if (charges.length < 2) return null;
  const last = charges[charges.length - 1];
  const prev = charges[charges.length - 2];
  if (last.amount === prev.amount) return null;
  return { from: -prev.amount, to: -last.amount, date: last.bookingDate };
}

/**
 * Prisendring for et registrert abonnement. Små tilleggstrekk (f.eks. 1,75 kr for SMS
 * på mobilabonnementet) og valutasvingninger under 3 % regnes ikke som prisendring.
 */
export function subscriptionPriceChange(sub: Pick<Subscription, 'matchKey' | 'amount'>, transactions: Transaction[]): PriceChange | null {
  const main = chargesFor(sub, transactions).filter((t) => Math.abs(-t.amount - sub.amount) <= sub.amount * 0.5);
  const change = detectPriceChange(main);
  if (!change || Math.abs(change.to - change.from) < change.from * 0.03) return null;
  return change;
}

export interface SubscriptionSuggestion {
  matchKey: string;
  name: string;
  amount: Minor;
  currency: CurrencyCode;
  interval: BillingInterval;
  accountId: string;
  anchorDate: IsoDate;
  occurrences: number;
  kind: Subscription['kind'];
  category: CategoryId;
  /** 0–1: hvor sikkert mønsteret er. Vises som «sannsynlig»/«mulig». */
  confidence: number;
  priceChange: PriceChange | null;
}

function median(values: number[]): number {
  const s = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function intervalFromDays(days: number): BillingInterval | null {
  if (days >= 6 && days <= 8) return 'weekly';
  if (days >= 26 && days <= 35) return 'monthly';
  if (days >= 85 && days <= 97) return 'quarterly';
  if (days >= 355 && days <= 375) return 'yearly';
  return null;
}

/**
 * Finner mulige abonnementer og faste betalinger fra gjentakende trekk hos samme
 * mottaker med jevne mellomrom og omtrent samme beløp. Resultatet er forslag
 * som brukeren må bekrefte – ikke sikre opplysninger.
 */
export function detectSubscriptions(transactions: Transaction[], existing: Subscription[], dismissed: string[]): SubscriptionSuggestion[] {
  const skip = new Set([...existing.map((s) => s.matchKey).filter(Boolean), ...dismissed] as string[]);
  const groups = new Map<string, Transaction[]>();
  for (const t of transactions) {
    if (t.amount >= 0 || t.kind !== 'normal') continue;
    if (t.category === 'dagligvarer' || t.category === 'restaurant') continue;
    const key = subscriptionKey(t.counterparty);
    if (!key || skip.has(key) || skip.has(normalizeCounterparty(t.counterparty))) continue;
    const list = groups.get(key) ?? [];
    list.push(t);
    groups.set(key, list);
  }

  const latest = transactions.reduce((m, t) => (t.bookingDate > m ? t.bookingDate : m), '');
  const out: SubscriptionSuggestion[] = [];
  for (const [key, list] of groups) {
    const txs = list.slice().sort((a, b) => a.bookingDate.localeCompare(b.bookingDate));
    const strict = strictPattern(key, txs);
    if (strict) out.push(strict);
    else if (txs[txs.length - 1].category === 'abonnementer') {
      const loose = loosePattern(key, txs, latest);
      if (loose) out.push(loose);
    }
  }
  return out.sort((a, b) => b.confidence - a.confidence || b.amount - a.amount);
}

/**
 * Trekk som er kategorisert som abonnement, men uten et helt jevnt mønster
 * (f.eks. to trekk samme dag, flere mobilnumre eller bare ett-to trekk så langt).
 * Foreslås som månedlig med månedens samlede beløp, markert som «mulig».
 */
function loosePattern(key: string, txs: Transaction[], latest: IsoDate): SubscriptionSuggestion | null {
  const last = txs[txs.length - 1];
  if (latest && daysBetween(last.bookingDate, latest) > 45) return null;
  const perMonth = new Map<string, Minor>();
  for (const t of txs.filter((x) => x.currency === last.currency)) perMonth.set(t.bookingDate.slice(0, 7), (perMonth.get(t.bookingDate.slice(0, 7)) ?? 0) - t.amount);
  // Den største posten i siste måned regnes som trekkdato.
  const main = txs.filter((t) => t.bookingDate.slice(0, 7) === last.bookingDate.slice(0, 7)).reduce((m, t) => (t.amount < m.amount ? t : m));
  const amount = Math.round(median([...perMonth.values()]));
  return {
    matchKey: key,
    name: displayName(last.counterparty),
    amount,
    currency: last.currency,
    interval: 'monthly',
    accountId: last.accountId,
    anchorDate: main.bookingDate,
    occurrences: txs.length,
    kind: 'subscription',
    category: 'abonnementer',
    confidence: 0.2,
    priceChange: null,
  };
}

function strictPattern(key: string, txs: Transaction[]): SubscriptionSuggestion | null {
  // Maks ett trekk per 5 dager (unngå at flere handler samme uke tolkes som mønster).
  if (txs.length < 2) return null;
  const gaps = txs.slice(1).map((t, i) => daysBetween(txs[i].bookingDate, t.bookingDate));
  if (gaps.some((g) => g < 5)) return null;
  const interval = intervalFromDays(median(gaps));
  if (!interval) return null;
  const minCount = interval === 'yearly' ? 2 : 3;
  if (txs.length < minCount) return null;
  const amounts = txs.map((t) => -t.amount);
  const med = median(amounts);
  const spread = Math.max(...amounts.map((a) => Math.abs(a - med) / med));
  if (spread > 0.25) return null;
  const regular = gaps.every((g) => intervalFromDays(g) === interval);
  const last = txs[txs.length - 1];
  const category = last.category;
  const kind: Subscription['kind'] = category === 'bolig' || med >= 500_000 ? 'fixed' : 'subscription';
  return {
    matchKey: key,
    name: prettyName(last.counterparty),
    amount: -last.amount,
    currency: last.currency,
    interval,
    accountId: last.accountId,
    anchorDate: last.bookingDate,
    occurrences: txs.length,
    kind,
    category: CATEGORY_BY_ID[category]?.type === 'expense' ? category : 'abonnementer',
    confidence: Math.min(1, (regular ? 0.5 : 0.25) + (spread < 0.02 ? 0.3 : 0.1) + Math.min(0.2, txs.length * 0.05)),
    priceChange: detectPriceChange(txs),
  };
}

/** Visningsnavn uten betalingsformidler og referansekoder. */
function displayName(counterparty: string): string {
  const cleaned = cleanCounterparty(counterparty)
    .replace(/\s+\b(?=[A-Za-z]*\d)[A-Za-z0-9]{6,}\b/g, '')
    .trim();
  return prettyName(cleaned || counterparty);
}

export function prettyName(counterparty: string): string {
  const base = counterparty
    .replace(/\*.*$/, '')
    .replace(/\.(com|no)$/i, '')
    .trim();
  if (base === base.toUpperCase() && base.length > 3) {
    return base.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase());
  }
  return base;
}

export function suggestionToSubscription(s: SubscriptionSuggestion, id: string): Subscription {
  return {
    id,
    name: s.name,
    amount: s.amount,
    currency: s.currency,
    interval: s.interval,
    accountId: s.accountId,
    anchorDate: s.anchorDate,
    kind: s.kind,
    status: 'active',
    endedAt: null,
    source: 'detected',
    matchKey: s.matchKey,
    category: s.category,
    isDemo: false,
  };
}

/** Beløp omregnet til basisvaluta (for sortering/visning), `null` ved manglende kurs. */
export function inBase(amount: Minor, currency: CurrencyCode, base: CurrencyCode, rates: ExchangeRate[]): Minor | null {
  return convert(amount, currency, base, rates)?.amount ?? null;
}
