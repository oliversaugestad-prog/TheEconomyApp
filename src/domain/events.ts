import { CATEGORIES } from './categories';
import { addDays } from './dates';
import { convert } from './money';
import type { CategoryId, CurrencyCode, ExchangeRate, IsoDate, Minor, SpendEvent, Transaction } from './types';

export interface EventSummary {
  currency: CurrencyCode;
  /** Brukt totalt: koblede kjøp (minus refusjoner) + manuelle utgifter. */
  spent: Minor;
  /** Herav manuelle utgifter. */
  manual: Minor;
  budget: Minor | null;
  /** Budsjett minus brukt. Negativt = over budsjett. `null` uten budsjett. */
  remaining: Minor | null;
  /** Brukt andel av budsjettet (0–1+), `null` uten budsjett. */
  usage: number | null;
  status: 'none' | 'ok' | 'warn' | 'over';
  byCategory: { category: CategoryId; amount: Minor }[];
  transactions: Transaction[];
  /** Kjøp i fremmed valuta uten kurs – ikke med i summen. */
  missing: number;
  first: IsoDate | null;
  last: IsoDate | null;
}

/** Hva en koblet transaksjon koster hendelsen (refusjoner trekkes fra). */
function costOf(t: Transaction): number {
  if (t.kind === 'internal_transfer' || t.kind === 'card_payment') return 0;
  return -t.amount;
}

/**
 * Oppsummerer en hendelse. Hendelser er en egen visning: de endrer ikke inntekter,
 * utgifter eller kategorier i oversikten.
 */
export function summarizeEvent(ev: SpendEvent, transactions: Transaction[], rates: ExchangeRate[]): EventSummary {
  const linked = transactions.filter((t) => t.eventId === ev.id).sort((a, b) => b.bookingDate.localeCompare(a.bookingDate));
  const by = new Map<CategoryId, Minor>();
  let spent = 0;
  let missing = 0;
  for (const t of linked) {
    const cost = costOf(t);
    if (!cost) continue;
    const c = convert(cost, t.currency, ev.currency, rates);
    if (!c) {
      missing += 1;
      continue;
    }
    spent += c.amount;
    by.set(t.category, (by.get(t.category) ?? 0) + c.amount);
  }
  let manual = 0;
  for (const it of ev.items) {
    const c = convert(it.amount, it.currency, ev.currency, rates);
    if (!c) {
      missing += 1;
      continue;
    }
    manual += c.amount;
  }
  spent += manual;
  const remaining = ev.budget === null ? null : ev.budget - spent;
  const usage = ev.budget ? spent / ev.budget : ev.budget === 0 ? (spent > 0 ? Infinity : 0) : null;
  const status = usage === null ? 'none' : usage > 1 ? 'over' : usage >= 0.85 ? 'warn' : 'ok';
  const dates = [...linked.map((t) => t.bookingDate), ...ev.items.map((i) => i.date).filter((d): d is string => !!d)].sort();
  return {
    currency: ev.currency,
    spent,
    manual,
    budget: ev.budget,
    remaining,
    usage,
    status,
    byCategory: [...by.entries()]
      .filter(([, v]) => v > 0)
      .map(([category, amount]) => ({ category, amount }))
      .sort((a, b) => b.amount - a.amount || CATEGORIES.findIndex((c) => c.id === a.category) - CATEGORIES.findIndex((c) => c.id === b.category)),
    transactions: linked,
    missing,
    first: dates[0] ?? null,
    last: dates[dates.length - 1] ?? null,
  };
}

/**
 * Forslag til kjøp som kan høre til hendelsen: utgifter i perioden (med to dagers margin
 * før, for f.eks. flybilletter og hotell betalt rett før avreise) som ikke er koblet ennå.
 */
export function suggestEventTransactions(ev: SpendEvent, transactions: Transaction[]): Transaction[] {
  if (!ev.startDate) return [];
  const from = addDays(ev.startDate, -2);
  const to = ev.endDate ?? ev.startDate;
  return transactions
    .filter((t) => !t.eventId && t.amount < 0 && t.kind !== 'internal_transfer' && t.kind !== 'card_payment' && t.bookingDate >= from && t.bookingDate <= to)
    .sort((a, b) => a.bookingDate.localeCompare(b.bookingDate));
}
