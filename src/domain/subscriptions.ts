import { CATEGORY_BY_ID, normalizeCounterparty } from './categories';
import { addDays, addMonths, daysBetween, parseIsoDate } from './dates';
import { convert, sumMoney, type MoneySum } from './money';
import type {
  BillingInterval,
  CategoryId,
  CurrencyCode,
  ExchangeRate,
  IsoDate,
  Minor,
  Subscription,
  Transaction,
} from './types';

export const INTERVAL_LABEL: Record<BillingInterval, string> = {
  weekly: 'Ukentlig',
  monthly: 'Månedlig',
  quarterly: 'Kvartalsvis',
  yearly: 'Årlig',
};

/**
 * Månedlig kostnad. Årsabonnementer fordeles over 12 måneder slik at
 * månedssammenligningen blir rettferdig; faktisk trekkdato vises separat.
 */
export function monthlyCost(sub: Pick<Subscription, 'amount' | 'interval'>): Minor {
  switch (sub.interval) {
    case 'weekly':
      return Math.round((sub.amount * 52) / 12);
    case 'monthly':
      return sub.amount;
    case 'quarterly':
      return Math.round(sub.amount / 3);
    case 'yearly':
      return Math.round(sub.amount / 12);
  }
}

export function yearlyCost(sub: Pick<Subscription, 'amount' | 'interval'>): Minor {
  switch (sub.interval) {
    case 'weekly':
      return sub.amount * 52;
    case 'monthly':
      return sub.amount * 12;
    case 'quarterly':
      return sub.amount * 4;
    case 'yearly':
      return sub.amount;
  }
}

function step(date: IsoDate, interval: BillingInterval, n: number, day: number): IsoDate {
  switch (interval) {
    case 'weekly':
      return addDays(date, 7 * n);
    case 'monthly':
      return addMonths(date, n, day);
    case 'quarterly':
      return addMonths(date, 3 * n, day);
    case 'yearly':
      return addMonths(date, 12 * n, day);
  }
}

/**
 * Estimert neste trekk (på eller etter `today`), beregnet fra kjent trekkdato
 * og intervall. Dette er et anslag – ikke en opplysning fra leverandøren.
 */
export function nextChargeDate(sub: Pick<Subscription, 'anchorDate' | 'interval'>, today: IsoDate): IsoDate {
  const day = parseIsoDate(sub.anchorDate).getUTCDate();
  let n = 0;
  let d = sub.anchorDate;
  // Hopp tilnærmet frem først for å unngå lange løkker.
  if (sub.interval !== 'weekly') {
    const months = Math.max(0, Math.floor(daysBetween(sub.anchorDate, today) / 31) - 1);
    const per = sub.interval === 'monthly' ? 1 : sub.interval === 'quarterly' ? 3 : 12;
    n = Math.floor(months / per);
    d = step(sub.anchorDate, sub.interval, n, day);
  }
  while (d < today) {
    n += 1;
    d = step(sub.anchorDate, sub.interval, n, day);
  }
  return d;
}

export interface SubscriptionTotals {
  monthly: MoneySum;
  yearly: MoneySum;
  count: number;
}

export function subscriptionTotals(
  subs: Subscription[],
  base: CurrencyCode,
  rates: ExchangeRate[],
  kind: Subscription['kind'] | 'all' = 'subscription',
): SubscriptionTotals {
  const active = subs.filter((s) => s.status === 'active' && (kind === 'all' || s.kind === kind));
  return {
    monthly: sumMoney(active.map((s) => ({ id: s.id, label: s.name, amount: monthlyCost(s), currency: s.currency })), base, rates),
    yearly: sumMoney(active.map((s) => ({ id: s.id, label: s.name, amount: yearlyCost(s), currency: s.currency })), base, rates),
    count: active.length,
  };
}

/** Trekk som tilhører et abonnement (samme normaliserte mottaker), nyeste sist. */
export function chargesFor(sub: Pick<Subscription, 'matchKey'>, transactions: Transaction[]): Transaction[] {
  if (!sub.matchKey) return [];
  return transactions
    .filter((t) => t.amount < 0 && t.kind === 'normal' && normalizeCounterparty(t.counterparty) === sub.matchKey)
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
export function detectSubscriptions(
  transactions: Transaction[],
  existing: Subscription[],
  dismissed: string[],
): SubscriptionSuggestion[] {
  const skip = new Set([...existing.map((s) => s.matchKey).filter(Boolean), ...dismissed] as string[]);
  const groups = new Map<string, Transaction[]>();
  for (const t of transactions) {
    if (t.amount >= 0 || t.kind !== 'normal') continue;
    if (t.category === 'dagligvarer' || t.category === 'restaurant') continue;
    const key = normalizeCounterparty(t.counterparty);
    if (!key || skip.has(key)) continue;
    const list = groups.get(key) ?? [];
    list.push(t);
    groups.set(key, list);
  }

  const out: SubscriptionSuggestion[] = [];
  for (const [key, list] of groups) {
    const txs = list.slice().sort((a, b) => a.bookingDate.localeCompare(b.bookingDate));
    // Maks ett trekk per 5 dager (unngå at flere handler samme uke tolkes som mønster).
    if (txs.length < 2) continue;
    const gaps = txs.slice(1).map((t, i) => daysBetween(txs[i].bookingDate, t.bookingDate));
    if (gaps.some((g) => g < 5)) continue;
    const interval = intervalFromDays(median(gaps));
    if (!interval) continue;
    const minCount = interval === 'yearly' ? 2 : 3;
    if (txs.length < minCount) continue;
    const amounts = txs.map((t) => -t.amount);
    const med = median(amounts);
    const spread = Math.max(...amounts.map((a) => Math.abs(a - med) / med));
    if (spread > 0.25) continue;
    const regular = gaps.every((g) => intervalFromDays(g) === interval);
    const last = txs[txs.length - 1];
    const category = last.category;
    const kind: Subscription['kind'] = category === 'bolig' || med >= 500_000 ? 'fixed' : 'subscription';
    out.push({
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
    });
  }
  return out.sort((a, b) => b.confidence - a.confidence || b.amount - a.amount);
}

export function prettyName(counterparty: string): string {
  const base = counterparty.replace(/\*.*$/, '').replace(/\.(com|no)$/i, '').trim();
  if (base === base.toUpperCase() && base.length > 3) {
    return base
      .toLowerCase()
      .replace(/(^|\s)\S/g, (c) => c.toUpperCase());
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
