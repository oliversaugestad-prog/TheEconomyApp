import { addDays } from './dates';
import { convert } from './money';
import { nextChargeDate } from './subscriptions';
import type { Account, CurrencyCode, ExchangeRate, IsoDate, Minor, Subscription } from './types';

export interface UpcomingPayment {
  id: string;
  date: IsoDate;
  name: string;
  amount: Minor;
  currency: CurrencyCode;
  accountId: string | null;
  kind: 'subscription' | 'fixed' | 'card_bill';
  /** `true` når datoen er beregnet av Saldo, ikke oppgitt av banken. */
  estimated: boolean;
  /** Hvor opplysningen kommer fra, for visning. */
  basis: string;
}

/**
 * Kjente kommende betalinger innen `days` dager: aktive abonnementer og faste
 * betalinger (estimert dato), samt kredittkortfakturaer med kjent forfall.
 */
export function upcomingPayments(
  subs: Subscription[],
  accounts: Account[],
  today: IsoDate,
  days = 30,
): UpcomingPayment[] {
  const until = addDays(today, days);
  const out: UpcomingPayment[] = [];
  for (const s of subs) {
    if (s.status !== 'active') continue;
    const date = nextChargeDate(s, today);
    if (date > until) continue;
    out.push({
      id: `sub-${s.id}`,
      date,
      name: s.name,
      amount: s.amount,
      currency: s.currency,
      accountId: s.accountId,
      kind: s.kind,
      estimated: true,
      basis: 'Estimert fra tidligere trekk og intervall',
    });
  }
  for (const a of accounts) {
    const st = a.card?.statement;
    if (!st || st.amount === null || !st.dueDate) continue;
    if (st.dueDate < today || st.dueDate > until) continue;
    out.push({
      id: `bill-${a.id}`,
      date: st.dueDate,
      name: `Faktura ${a.name}`,
      amount: st.amount,
      currency: a.currency,
      accountId: a.id,
      kind: 'card_bill',
      estimated: false,
      basis: st.source === 'provider' ? 'Fakturaopplysninger fra kortutsteder' : 'Registrert manuelt av deg',
    });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
}

export interface RemainingEstimate {
  /** Tilgjengelig på brukskontoer (slik kilden oppgir det). */
  available: Minor;
  /** Kommende betalinger som trekkes fra brukskontoene. */
  deductions: UpcomingPayment[];
  deducted: Minor;
  remaining: Minor;
  currency: CurrencyCode;
  complete: boolean;
  /** Forutsetninger og forbehold som vises til brukeren. */
  notes: string[];
}

/**
 * «Estimert igjen etter kommende betalinger» – et anslag, ikke et garantert
 * disponibelt beløp.
 *
 * - Utgangspunkt: tilgjengelig saldo på inkluderte brukskontoer (sparekontoer
 *   holdes utenfor). Reservasjoner trekkes ikke på nytt.
 * - Trekk: abonnementer/faste betalinger som belastes en bankkonto, og kjente
 *   kortfakturaer med forfall i perioden.
 * - Abonnementer som belastes et kredittkort trekkes ikke separat – de havner
 *   på en senere kortfaktura, og ville ellers blitt trukket to ganger.
 * - Kredittkortgjeld trekkes bare fra i form av kjent faktura, ikke i tillegg.
 */
export function estimateRemaining(
  accounts: Account[],
  upcoming: UpcomingPayment[],
  base: CurrencyCode,
  rates: ExchangeRate[],
): RemainingEstimate {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const checking = accounts.filter((a) => a.includedInOverview && a.type === 'checking');
  const notes: string[] = [];
  let complete = true;
  let available = 0;
  for (const a of checking) {
    if (a.availableBalance === null) {
      complete = false;
      notes.push(`${a.name} (${a.bankName}) oppgir ikke tilgjengelig saldo og er holdt utenfor.`);
      continue;
    }
    const c = convert(a.availableBalance, a.currency, base, rates);
    if (!c) {
      complete = false;
      notes.push(`${a.name} mangler valutakurs og er holdt utenfor.`);
      continue;
    }
    available += c.amount;
  }

  const deductions: UpcomingPayment[] = [];
  let deducted = 0;
  for (const p of upcoming) {
    const acc = p.accountId ? byId.get(p.accountId) : undefined;
    if (p.kind !== 'card_bill') {
      if (acc?.type === 'credit_card') continue; // havner på kortfaktura
      if (acc && !acc.includedInOverview) continue;
    }
    const c = convert(p.amount, p.currency, base, rates);
    if (!c) {
      complete = false;
      continue;
    }
    deductions.push(p);
    deducted += c.amount;
  }

  const cardsWithoutBill = accounts.filter(
    (a) => a.includedInOverview && a.type === 'credit_card' && (!a.card?.statement || a.card.statement.amount === null),
  );
  if (cardsWithoutBill.length) {
    complete = false;
    notes.push(
      `Faktura er ikke tilgjengelig for ${cardsWithoutBill.map((a) => a.name).join(', ')}. Kommende kortregning er derfor ikke trukket fra.`,
    );
  }
  notes.push('Abonnementer som belastes kredittkort er ikke trukket separat, siden de kommer på kortfakturaen.');
  notes.push('Datoer for abonnementer er estimert ut fra tidligere trekk og kan avvike.');

  return { available, deductions, deducted, remaining: available - deducted, currency: base, complete, notes };
}
