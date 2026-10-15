import { paymentTargetCard } from './reconcile';
import type { Account, AppData, CardPayment, IsoDate, Minor } from './types';

/** Kort du har lagt inn selv – gjelden oppdateres ikke av banken. */
export function isManualCard(a: Account, data: Pick<AppData, 'connections'>): boolean {
  if (a.type !== 'credit_card') return false;
  const conn = data.connections.find((c) => c.id === a.connectionId);
  return a.source !== 'bank' && (!conn || conn.providerId === 'manual');
}

/** Trekker en innbetaling fra gjelden. Gjelden går aldri under 0 (mer enn gjelden regnes ikke som tilgode). */
export function withPayment(card: Account, amount: Minor, date: IsoDate, transactionId: string | null, id: string): Account {
  const debt = card.bookedBalance === null ? null : Math.max(0, -card.bookedBalance);
  const applied = debt === null ? 0 : Math.min(debt, amount);
  const payment: CardPayment = { id, amount, date, transactionId, applied };
  return {
    ...card,
    bookedBalance: debt === null ? null : debt - applied === 0 ? 0 : -(debt - applied),
    card: card.card ? { ...card.card, payments: [...(card.card.payments ?? []), payment] } : card.card,
  };
}

/**
 * Bankbetalinger til et manuelt kort (f.eks. «American Express» fra brukskontoen) trekkes
 * automatisk fra kortets gjeld – men bare betalinger etter at gjelden sist ble satt, og
 * hver betaling bare én gang.
 */
export function applyBankCardPayments(data: AppData): AppData {
  const manualCards = data.accounts.filter((a) => isManualCard(a, data) && a.bookedBalance !== null);
  if (!manualCards.length) return data;
  const cardIds = new Set(data.accounts.filter((a) => a.type === 'credit_card').map((a) => a.id));
  let accounts = data.accounts;
  for (const t of data.transactions) {
    if (t.kind !== 'card_payment' || t.amount >= 0 || cardIds.has(t.accountId) || t.status !== 'booked') continue;
    const target = paymentTargetCard(t, manualCards);
    if (!target) continue;
    const card = accounts.find((a) => a.id === target.id)!;
    const since = card.balanceUpdatedAt?.slice(0, 10) ?? '';
    const used = new Set([...(card.card?.payments ?? []).map((p) => p.transactionId), ...(card.card?.ignoredPaymentIds ?? [])]);
    if (used.has(t.id) || t.bookingDate < since) continue;
    const updated = withPayment(card, -t.amount, t.bookingDate, t.id, `pay-${t.id}`);
    accounts = accounts.map((a) => (a.id === card.id ? updated : a));
  }
  return accounts === data.accounts ? data : { ...data, accounts };
}
