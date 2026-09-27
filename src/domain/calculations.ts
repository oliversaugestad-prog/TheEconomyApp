import { CATEGORIES } from './categories';
import { lastMonths, monthKey, type MonthKey } from './dates';
import { convert, parseAmount, sumMoney, type MoneySum, type SumItem } from './money';
import type { Account, AppData, CategoryId, CurrencyCode, ExchangeRate, Minor, Transaction, TransactionKind } from './types';

/* ------------------------------------------------------------------ */
/* Saldoer                                                             */
/* ------------------------------------------------------------------ */

export const isCard = (a: Account) => a.type === 'credit_card';
export const isBankAccount = (a: Account) => a.type !== 'credit_card';

export function includedAccounts(accounts: Account[]): Account[] {
  return accounts.filter((a) => a.includedInOverview);
}

function item(a: Account, amount: Minor | null): SumItem {
  return { id: a.id, label: `${a.bankName} · ${a.name}`, amount, currency: a.currency };
}

/** Reserverte (ikke bokførte) beløp på en konto, som positivt tall for utgifter. */
export function reservedAmount(accountId: string, transactions: Transaction[]): Minor {
  return transactions
    .filter((t) => t.accountId === accountId && t.status === 'pending')
    .reduce((s, t) => s - t.amount, 0);
}

/** Utestående gjeld på et kort (positivt tall). `null` = ukjent. */
export function cardDebt(a: Account): Minor | null {
  if (a.bookedBalance === null) return null;
  return -a.bookedBalance;
}

/** Tilgjengelig kreditt slik kilden oppgir den – beregnes ikke dersom grense/saldo mangler. */
export function availableCredit(a: Account, transactions: Transaction[]): Minor | null {
  if (a.availableBalance !== null) return a.availableBalance;
  const limit = a.card?.creditLimit ?? null;
  if (limit === null || a.bookedBalance === null) return null;
  // Kilden oppga ikke tilgjengelig kreditt: grense − bokført gjeld − reservasjoner.
  return limit + a.bookedBalance - reservedAmount(a.id, transactions);
}

export interface BalanceSummary {
  /** Sum bokført saldo på inkluderte bankkontoer (ikke kort). */
  booked: MoneySum;
  /** Sum tilgjengelig saldo slik kilden oppgir den. */
  available: MoneySum;
  /** Sum utestående kredittkortgjeld (bokført). */
  cardDebt: MoneySum;
  /** Reserverte kortkjøp som ennå ikke er bokført. */
  cardReserved: MoneySum;
  /** Bokført kontosaldo minus bokført kredittkortgjeld. */
  net: { amount: Minor; currency: CurrencyCode; complete: boolean };
  bankAccounts: Account[];
  cards: Account[];
  /** Kontoer der tilgjengelig saldo er brukt fordi banken ikke oppgir bokført saldo. */
  bookedSubstituted: Account[];
}

/**
 * Samlet saldo for oversikten.
 * - Kredittgrense og tilgjengelig kreditt legges aldri til kontosaldoen.
 * - Tilgjengelig saldo tas som oppgitt av kilden; reservasjoner trekkes ikke fra
 *   på nytt. Mangler kilden tallet, er summen ufullstendig.
 */
export function balanceSummary(data: Pick<AppData, 'accounts' | 'transactions' | 'rates' | 'settings'>): BalanceSummary {
  const base = data.settings.baseCurrency;
  const inc = includedAccounts(data.accounts);
  const bankAccounts = inc.filter(isBankAccount);
  const cards = inc.filter(isCard);
  // Noen banker (f.eks. Revolut) oppgir bare tilgjengelig saldo. Da brukes den, og
  // kontoen listes i `bookedSubstituted` slik at det vises tydelig.
  const bookedSubstituted = bankAccounts.filter((a) => a.bookedBalance === null && a.availableBalance !== null);
  const booked = sumMoney(bankAccounts.map((a) => item(a, bookedOrAvailable(a))), base, data.rates);
  // Manuelle kontoer der du bare har oppgitt én saldo: den brukes også som tilgjengelig.
  const available = sumMoney(bankAccounts.map((a) => item(a, a.availableBalance ?? (a.source === 'manual' ? a.bookedBalance : null))), base, data.rates);
  const debt = sumMoney(cards.map((a) => item(a, cardDebt(a))), base, data.rates);
  const reserved = sumMoney(cards.map((a) => item(a, reservedAmount(a.id, data.transactions))), base, data.rates);
  return {
    booked,
    available,
    cardDebt: debt,
    cardReserved: reserved,
    net: {
      amount: booked.amount - debt.amount,
      currency: base,
      complete: booked.complete && debt.complete,
    },
    bankAccounts,
    cards,
    bookedSubstituted,
  };
}

/** Bokført saldo, eller tilgjengelig saldo når banken ikke oppgir bokført. */
export function bookedOrAvailable(a: Account): Minor | null {
  return a.bookedBalance ?? (a.type === 'credit_card' ? null : a.availableBalance);
}

/** Bokført og tilgjengelig saldo per bank (for kontolisten). */
export function bankTotals(accounts: Account[], base: CurrencyCode, rates: ExchangeRate[]) {
  const groups = new Map<string, Account[]>();
  for (const a of accounts.filter(isBankAccount)) {
    const list = groups.get(a.bankName) ?? [];
    list.push(a);
    groups.set(a.bankName, list);
  }
  return [...groups.entries()].map(([bank, list]) => ({
    bank,
    accounts: list,
    total: sumMoney(list.map((a) => item(a, bookedOrAvailable(a))), base, rates),
  }));
}

/* ------------------------------------------------------------------ */
/* Inntekter og utgifter                                               */
/* ------------------------------------------------------------------ */

/** Transaksjonstyper som ikke påvirker inntekter eller forbruk. */
export const NEUTRAL_KINDS: TransactionKind[] = ['internal_transfer', 'card_payment', 'business'];

export interface Flow {
  income: Minor;
  expense: Minor;
}

/**
 * Hvordan én transaksjon påvirker inntekt og forbruk (i transaksjonens valuta).
 * - Interne overføringer og kortbetalinger: ingen påvirkning.
 * - Refusjon: reduserer forbruket (i kjøpets kategori), er ikke inntekt.
 * - Ellers: positive beløp er inntekt, negative er forbruk.
 */
export function flowOf(t: Transaction): Flow {
  if (NEUTRAL_KINDS.includes(t.kind)) return { income: 0, expense: 0 };
  if (t.kind === 'refund') return { income: 0, expense: -t.amount };
  return t.amount >= 0 ? { income: t.amount, expense: 0 } : { income: 0, expense: -t.amount };
}

export interface FlowSummary {
  income: Minor;
  expense: Minor;
  net: Minor;
  /** Herav reserverte (ikke bokførte) utgifter. */
  pendingExpense: Minor;
  refunds: Minor;
  byCategory: Map<CategoryId, Minor>;
  incomeByCategory: Map<CategoryId, Minor>;
  currency: CurrencyCode;
  /** Transaksjoner i fremmed valuta uten kurs – ikke tatt med. */
  skipped: number;
  count: number;
}

/**
 * Summerer inntekter og utgifter for en (allerede filtrert) liste transaksjoner.
 * Reserverte transaksjoner telles én gang; når de bokføres erstattes de (se
 * `mergeTransactions`), slik at de aldri telles dobbelt.
 */
export function summarizeFlows(transactions: Transaction[], base: CurrencyCode, rates: ExchangeRate[]): FlowSummary {
  const s: FlowSummary = {
    income: 0,
    expense: 0,
    net: 0,
    pendingExpense: 0,
    refunds: 0,
    byCategory: new Map(),
    incomeByCategory: new Map(),
    currency: base,
    skipped: 0,
    count: 0,
  };
  for (const t of transactions) {
    const f = flowOf(t);
    if (f.income === 0 && f.expense === 0) continue;
    const inc = convert(f.income, t.currency, base, rates);
    const exp = convert(f.expense, t.currency, base, rates);
    if (!inc || !exp) {
      s.skipped += 1;
      continue;
    }
    s.count += 1;
    s.income += inc.amount;
    s.expense += exp.amount;
    if (t.kind === 'refund') s.refunds += -exp.amount;
    if (t.status === 'pending') s.pendingExpense += exp.amount;
    if (exp.amount !== 0) s.byCategory.set(t.category, (s.byCategory.get(t.category) ?? 0) + exp.amount);
    if (inc.amount !== 0) s.incomeByCategory.set(t.category, (s.incomeByCategory.get(t.category) ?? 0) + inc.amount);
  }
  s.net = s.income - s.expense;
  return s;
}

/** Transaksjoner på kontoer som inngår i oversikten. */
export function overviewTransactions(data: Pick<AppData, 'accounts' | 'transactions'>): Transaction[] {
  const ids = new Set(includedAccounts(data.accounts).map((a) => a.id));
  return data.transactions.filter((t) => ids.has(t.accountId));
}

export function monthTransactions(transactions: Transaction[], month: MonthKey): Transaction[] {
  return transactions.filter((t) => monthKey(t.bookingDate) === month);
}

export interface MonthPoint {
  month: MonthKey;
  income: Minor;
  expense: Minor;
  net: Minor;
}

export function monthlySeries(
  transactions: Transaction[],
  lastMonth: MonthKey,
  count: number,
  base: CurrencyCode,
  rates: ExchangeRate[],
): MonthPoint[] {
  return lastMonths(lastMonth, count).map((m) => {
    const s = summarizeFlows(monthTransactions(transactions, m), base, rates);
    return { month: m, income: s.income, expense: s.expense, net: s.net };
  });
}

export interface CategoryShare {
  category: CategoryId;
  amount: Minor;
  share: number;
}

/** Utgifter per kategori, sortert synkende. Fast fargerekkefølge beholdes via kategori-ID. */
export function categoryBreakdown(summary: FlowSummary): CategoryShare[] {
  const positive = [...summary.byCategory.entries()].filter(([, v]) => v > 0);
  const total = positive.reduce((s, [, v]) => s + v, 0);
  return positive
    .map(([category, amount]) => ({ category, amount, share: total ? amount / total : 0 }))
    .sort((a, b) => b.amount - a.amount || CATEGORIES.findIndex((c) => c.id === a.category) - CATEGORIES.findIndex((c) => c.id === b.category));
}

/**
 * Bedriftens utgifter betalt av eier, per kategori – egen post som ikke inngår i
 * private utgifter eller prosentfordelingen.
 */
export function businessBreakdown(transactions: Transaction[], base: CurrencyCode, rates: ExchangeRate[]): { shares: CategoryShare[]; total: Minor; skipped: number } {
  const by = new Map<CategoryId, Minor>();
  let skipped = 0;
  for (const t of transactions) {
    if (t.kind !== 'business' || t.amount >= 0) continue;
    const c = convert(-t.amount, t.currency, base, rates);
    if (!c) {
      skipped += 1;
      continue;
    }
    by.set(t.category, (by.get(t.category) ?? 0) + c.amount);
  }
  const total = [...by.values()].reduce((s, v) => s + v, 0);
  const shares = [...by.entries()].map(([category, amount]) => ({ category, amount, share: total ? amount / total : 0 })).sort((a, b) => b.amount - a.amount);
  return { shares, total, skipped };
}

/* ------------------------------------------------------------------ */
/* Filtrering                                                          */
/* ------------------------------------------------------------------ */

export type TxTypeFilter = 'all' | 'income' | 'expense' | 'transfer' | 'refund' | 'business';
export type TxStatusFilter = 'all' | 'booked' | 'pending';

export interface TransactionFilter {
  query: string;
  from: string | null;
  to: string | null;
  bank: string | null;
  accountId: string | null;
  category: CategoryId | null;
  type: TxTypeFilter;
  status: TxStatusFilter;
}

export const EMPTY_FILTER: TransactionFilter = {
  query: '',
  from: null,
  to: null,
  bank: null,
  accountId: null,
  category: null,
  type: 'all',
  status: 'all',
};

function matchesQuery(t: Transaction, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (t.counterparty.toLowerCase().includes(q) || t.description.toLowerCase().includes(q)) return true;
  // Beløpssøk: «179», «179,00», «-179», «1 299,50»
  const amt = parseAmount(q, t.currency);
  if (amt !== null && amt !== 0) {
    const abs = Math.abs(amt);
    if (Math.abs(t.amount) === abs) return true;
    // «179» skal også treffe 179,50
    if (!/[.,]/.test(q) && Math.floor(Math.abs(t.amount) / 100) === abs / 100) return true;
  }
  return false;
}

export function filterTransactions(transactions: Transaction[], accounts: Account[], f: TransactionFilter): Transaction[] {
  const accById = new Map(accounts.map((a) => [a.id, a]));
  return transactions.filter((t) => {
    if (f.from && t.bookingDate < f.from) return false;
    if (f.to && t.bookingDate > f.to) return false;
    if (f.accountId && t.accountId !== f.accountId) return false;
    if (f.bank && accById.get(t.accountId)?.bankName !== f.bank) return false;
    if (f.category && t.category !== f.category) return false;
    if (f.status !== 'all' && t.status !== f.status) return false;
    switch (f.type) {
      case 'income':
        if (!(t.kind === 'normal' && t.amount > 0)) return false;
        break;
      case 'expense':
        if (!(t.kind === 'normal' && t.amount < 0)) return false;
        break;
      case 'transfer':
        if (t.kind !== 'internal_transfer' && t.kind !== 'card_payment') return false;
        break;
      case 'business':
        if (t.kind !== 'business') return false;
        break;
      case 'refund':
        if (t.kind !== 'refund') return false;
        break;
    }
    return matchesQuery(t, f.query);
  });
}

export function sortByDateDesc(transactions: Transaction[]): Transaction[] {
  return transactions
    .slice()
    .sort(
      (a, b) =>
        (a.status === 'pending' ? 0 : 1) - (b.status === 'pending' ? 0 : 1) ||
        b.bookingDate.localeCompare(a.bookingDate) ||
        b.id.localeCompare(a.id),
    );
}
