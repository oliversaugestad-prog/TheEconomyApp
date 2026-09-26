import { findRule, guessCategory, normalizeCounterparty } from './categories';
import { daysBetween } from './dates';
import type { Account, CategoryRule, Transaction } from './types';

/**
 * Sammenslåing og klassifisering av transaksjoner.
 *
 * Reglene her sikrer at gjentatt synkronisering eller import ikke gir
 * duplikater, at reservasjoner ikke telles på nytt når de bokføres, og at
 * interne overføringer og kortbetalinger ikke telles som inntekt/forbruk.
 */

export interface MergeStats {
  added: number;
  updated: number;
  pendingReplaced: number;
  pendingRemoved: number;
  /** Gamle kopier fjernet fordi banken ga transaksjonen ny ID. */
  duplicatesRemoved?: number;
}

export interface MergeOptions {
  /**
   * Kilden leverte hele listen over reservasjoner for kontoene i `accountIds`.
   * Reservasjoner som ikke lenger finnes (kansellert/utløpt) fjernes da.
   */
  pendingComplete?: boolean;
  accountIds?: string[];
  /**
   * Kilden leverte alle bokførte transaksjoner fra `from` for disse kontoene. Noen banker gir
   * samme transaksjon ny ID ved ny henting – da gjenkjennes den på dato, beløp og mottaker
   * i stedet for å legges inn på nytt, og gamle kopier ryddes bort.
   */
  window?: { from: string; accountIds: string[] };
}

function sameTxKey(t: Transaction): string {
  return `${t.accountId}|${t.bookingDate}|${t.amount}|${t.currency}|${normalizeCounterparty(t.counterparty)}`;
}

/** Maks antall dager mellom reservasjon og bokføring når vi matcher uten ID. */
const PENDING_MATCH_DAYS = 10;

function carryUserFields(target: Transaction, from: Transaction): Transaction {
  return {
    ...target,
    id: from.id,
    category: from.userCategorized ? from.category : target.category,
    userCategorized: from.userCategorized,
    kind: from.userKind ? from.kind : target.kind,
    userKind: from.userKind,
    linkedTransactionId: from.userKind ? from.linkedTransactionId : target.linkedTransactionId,
  };
}

/**
 * Slår innkommende transaksjoner sammen med eksisterende uten å lage duplikater.
 * - Samme `externalId` på samme konto oppdateres, ikke legges til på nytt.
 * - En bokført transaksjon erstatter reservasjonen den tilhører (via ID fra
 *   kilden, eller ved lik konto, beløp og mottaker innen få dager).
 * - Brukerens egne kategorier og markeringer beholdes.
 */
export function mergeTransactions(
  existing: Transaction[],
  incoming: Transaction[],
  options: MergeOptions = {},
): { transactions: Transaction[]; stats: MergeStats } {
  const stats: MergeStats = { added: 0, updated: 0, pendingReplaced: 0, pendingRemoved: 0 };
  const result = existing.slice();
  const indexByExt = new Map<string, number>();
  result.forEach((t, i) => {
    if (t.externalId) indexByExt.set(`${t.accountId}|${t.externalId}`, i);
  });
  const removed = new Set<number>();
  const seenPendingExt = new Set<string>();

  // Bokførte transaksjoner i hentevinduet som kilden ikke lenger oppgir med samme ID.
  const incomingExt = new Set(incoming.filter((t) => t.externalId).map((t) => `${t.accountId}|${t.externalId}`));
  const incomingKeys = new Set(incoming.filter((t) => t.status === 'booked').map(sameTxKey));
  const windowAccounts = new Set(options.window?.accountIds ?? []);
  const staleByKey = new Map<string, number[]>();
  if (options.window) {
    result.forEach((t, i) => {
      if (
        t.source === 'bank' &&
        t.status === 'booked' &&
        t.externalId &&
        windowAccounts.has(t.accountId) &&
        t.bookingDate >= options.window!.from &&
        !incomingExt.has(`${t.accountId}|${t.externalId}`)
      ) {
        const k = sameTxKey(t);
        staleByKey.set(k, [...(staleByKey.get(k) ?? []), i]);
      }
    });
  }

  for (const tx of incoming) {
    const extKey = tx.externalId ? `${tx.accountId}|${tx.externalId}` : null;
    if (tx.status === 'pending' && extKey) seenPendingExt.add(extKey);

    // 1) Samme transaksjon sett før → oppdater.
    if (extKey && indexByExt.has(extKey)) {
      const i = indexByExt.get(extKey)!;
      result[i] = carryUserFields(tx, result[i]);
      stats.updated += 1;
      continue;
    }

    // 1b) Samme bokførte transaksjon med ny ID fra banken → oppdater den eksisterende.
    if (tx.status === 'booked' && windowAccounts.has(tx.accountId)) {
      const stale = staleByKey.get(sameTxKey(tx));
      const i = stale?.shift();
      if (i !== undefined) {
        const prev = result[i];
        result[i] = carryUserFields(tx, prev);
        if (prev.externalId) indexByExt.delete(`${prev.accountId}|${prev.externalId}`);
        if (extKey) indexByExt.set(extKey, i);
        stats.updated += 1;
        continue;
      }
    }

    // 2) Bokført transaksjon som erstatter en reservasjon.
    if (tx.status === 'booked') {
      let pendingIdx = -1;
      if (tx.replacesPendingExternalId) {
        pendingIdx = indexByExt.get(`${tx.accountId}|${tx.replacesPendingExternalId}`) ?? -1;
      }
      if (pendingIdx < 0) {
        const key = normalizeCounterparty(tx.counterparty);
        pendingIdx = result.findIndex(
          (p, i) =>
            !removed.has(i) &&
            p.status === 'pending' &&
            p.accountId === tx.accountId &&
            p.amount === tx.amount &&
            p.currency === tx.currency &&
            normalizeCounterparty(p.counterparty) === key &&
            daysBetween(p.bookingDate, tx.bookingDate) >= -1 &&
            daysBetween(p.bookingDate, tx.bookingDate) <= PENDING_MATCH_DAYS,
        );
      }
      if (pendingIdx >= 0 && result[pendingIdx].status === 'pending') {
        const prev = result[pendingIdx];
        result[pendingIdx] = carryUserFields(tx, prev);
        if (prev.externalId) indexByExt.delete(`${prev.accountId}|${prev.externalId}`);
        if (extKey) indexByExt.set(extKey, pendingIdx);
        stats.pendingReplaced += 1;
        continue;
      }
    }

    // 3) Ny transaksjon.
    result.push(tx);
    if (extKey) indexByExt.set(extKey, result.length - 1);
    stats.added += 1;
  }

  // 4) Reservasjoner som forsvant fra kilden (kansellert) fjernes.
  if (options.pendingComplete && options.accountIds) {
    const scope = new Set(options.accountIds);
    result.forEach((t, i) => {
      if (
        t.status === 'pending' &&
        scope.has(t.accountId) &&
        t.externalId &&
        !seenPendingExt.has(`${t.accountId}|${t.externalId}`)
      ) {
        removed.add(i);
        stats.pendingRemoved += 1;
      }
    });
  }

  // 5) Overflødige kopier: kilden oppgir transaksjonen, men færre ganger enn vi har den.
  // Poster kilden ikke nevner i det hele tatt, beholdes (for sikkerhets skyld).
  for (const [k, idxs] of staleByKey) {
    if (!incomingKeys.has(k)) continue;
    for (const i of idxs) {
      removed.add(i);
      stats.duplicatesRemoved = (stats.duplicatesRemoved ?? 0) + 1;
    }
  }

  return { transactions: result.filter((_, i) => !removed.has(i)), stats };
}

const TRANSFER_HINT = /(overf|transfer|egen konto|egne konto|innbetaling kort|kredittkort|kreditt as|kredittbank|nedbetaling|sparing|bsu|fra konto|til konto|faktura kort|kortfaktura|top.?up|påfyll|revolut|sent from|exchanged)/i;
/** Veksling mellom valutakontoer hos samme bank (f.eks. Revolut) – flytting av egne penger. */
const EXCHANGE = /^(exchanged (to|from)|exchange (to|from)|valutaveksling|veksling)\b/i;
const REFUND_HINT = /(refusjon|retur|refund|tilbakebetal|kreditering|reklamasjon)/i;
const TRANSFER_MAX_DAYS = 3;
const REFUND_MAX_DAYS = 90;

/**
 * Navn som tilhører brukeren. Treff krever både første og siste del av navnet,
 * slik at «Oliver Saugestad» kjennes igjen fra «Oliver Lundereng Saugestad»,
 * men ikke familiemedlemmer med samme etternavn.
 */
function ownNameMatcher(ownNames: string[]): (text: string) => boolean {
  const pairs = ownNames
    .map((n) => normalizeCounterparty(n).split(' ').filter(Boolean))
    .filter((parts) => parts.length >= 2)
    .map((parts) => [parts[0], parts[parts.length - 1]]);
  return (text: string) => {
    if (!text || !pairs.length) return false;
    const words = new Set(normalizeCounterparty(text).split(' '));
    return pairs.some(([first, last]) => words.has(first) && words.has(last));
  };
}

function hasTransferHint(t: Transaction, accounts: Map<string, Account>, isOwn: (text: string) => boolean): boolean {
  const text = `${t.counterparty} ${t.description}`;
  if (TRANSFER_HINT.test(text)) return true;
  if (isOwn(t.counterparty) || isOwn(t.description)) return true;
  // Mottaker er navnet på en av brukerens egne kontoer.
  const lower = text.toLowerCase();
  for (const a of accounts.values()) {
    if (a.id !== t.accountId && a.name.length > 3 && lower.includes(a.name.toLowerCase())) return true;
  }
  return false;
}

/**
 * Klassifiserer transaksjoner:
 * 1. Kategori fra brukerens regler, ellers søkeord (kun der brukeren ikke har valgt selv).
 * 2. Interne overføringer: motsatte, like beløp mellom to egne kontoer innen tre
 *    dager, der minst én side ser ut som en overføring. Går den ene veien til et
 *    kredittkort, er det en kortbetaling.
 *    Valutaveksling og overføringer til/fra ditt eget navn regnes også som
 *    interne, selv uten motpost.
 * 3. Refusjoner: innbetaling fra en mottaker vi tidligere har handlet hos, som
 *    er merket som refusjon/retur eller har samme beløp som et tidligere kjøp.
 *    Refusjonen får kategorien til kjøpet.
 */
export function classifyTransactions(
  transactions: Transaction[],
  accountsList: Account[],
  rules: CategoryRule[],
  ownNames: string[] = [],
): Transaction[] {
  const accounts = new Map(accountsList.map((a) => [a.id, a]));
  const isOwn = ownNameMatcher(ownNames);

  const txs = transactions.map((t) => {
    let next = t;
    if (!t.userCategorized) {
      const cat = findRule(rules, t.counterparty)?.category ?? guessCategory(t.counterparty, t.description, t.amount, t.mcc);
      if (cat !== t.category) next = { ...next, category: cat };
    }
    if (!t.userKind && t.kind !== 'normal') {
      // Automatisk klassifisering beregnes på nytt for å være konsistent.
      next = { ...next, kind: 'normal', linkedTransactionId: null };
    }
    return next;
  });

  const linked = new Set<number>();
  txs.forEach((t, i) => {
    if (t.userKind && t.linkedTransactionId) linked.add(i);
  });

  // Sorter kandidater etter dato for deterministisk sammenkobling.
  const order = txs
    .map((_, i) => i)
    .sort((a, b) => txs[a].bookingDate.localeCompare(txs[b].bookingDate) || txs[a].id.localeCompare(txs[b].id));

  for (const i of order) {
    const out = txs[i];
    if (out.amount >= 0 || out.userKind || linked.has(i)) continue;
    const outAcc = accounts.get(out.accountId);
    if (!outAcc) continue;
    let best = -1;
    let bestDiff = Infinity;
    for (const j of order) {
      if (j === i || linked.has(j)) continue;
      const inn = txs[j];
      if (inn.userKind || inn.accountId === out.accountId) continue;
      if (inn.amount !== -out.amount || inn.currency !== out.currency) continue;
      if (!accounts.has(inn.accountId)) continue;
      const diff = Math.abs(daysBetween(out.bookingDate, inn.bookingDate));
      if (diff > TRANSFER_MAX_DAYS) continue;
      if (!hasTransferHint(out, accounts, isOwn) && !hasTransferHint(inn, accounts, isOwn)) continue;
      if (diff < bestDiff) {
        best = j;
        bestDiff = diff;
      }
    }
    if (best >= 0) {
      const inn = txs[best];
      const isCard = outAcc.type === 'credit_card' || accounts.get(inn.accountId)?.type === 'credit_card';
      const kind = isCard ? 'card_payment' : 'internal_transfer';
      txs[i] = { ...out, kind, linkedTransactionId: inn.id };
      txs[best] = { ...inn, kind, linkedTransactionId: out.id };
      linked.add(i);
      linked.add(best);
    }
  }

  // Innbetaling til kredittkort der motposten mangler (f.eks. fordi kortutstederen
  // ikke er synkronisert ennå). Teksten må tydelig peke på et av brukerens kort.
  const cards = accountsList.filter((a) => a.type === 'credit_card');
  for (const i of order) {
    const t = txs[i];
    if (t.amount >= 0 || t.userKind || t.kind !== 'normal' || linked.has(i)) continue;
    if (accounts.get(t.accountId)?.type === 'credit_card') continue;
    const text = `${t.counterparty} ${t.description}`.toLowerCase();
    const hinted = /(kredittkort|kortfaktura|faktura kort|innbetaling kort)/.test(text);
    const card = cards.find((c) => {
      const issuer = (c.card?.issuer ?? c.bankName).toLowerCase();
      // Betaling til selve kortutstederen (f.eks. «American Express» eller «Kredittbanken»
      // for SpareBank 1-kort) er innbetaling på kortet, ikke forbruk.
      if (issuer.length >= 5 && text.includes(issuer) && !/sparebank|bank$/.test(issuer)) return true;
      if (/kredittbanken/.test(text) && /sparebank 1/.test(issuer)) return true;
      return hinted && (text.includes(c.name.toLowerCase()) || text.includes(c.bankName.toLowerCase()));
    });
    if (card) txs[i] = { ...t, kind: 'card_payment', linkedTransactionId: null };
  }

  // Innbetaling registrert på selve kortet (f.eks. «BETALING MOTTATT - TAKK» i en Amex-eksport)
  // der betalingen fra bankkontoen ikke finnes i Saldo. Det er nedbetaling av gjeld, ikke inntekt.
  for (const i of order) {
    const t = txs[i];
    if (t.amount <= 0 || t.userKind || t.kind !== 'normal' || linked.has(i)) continue;
    if (accounts.get(t.accountId)?.type !== 'credit_card') continue;
    const text = `${t.counterparty} ${t.description}`.toLowerCase();
    if (/(betaling mottatt|innbetaling|payment received|thank you|takk for betaling|autogiro|avtalegiro)/.test(text)) {
      txs[i] = { ...t, kind: 'card_payment', linkedTransactionId: null };
    }
  }

  // Valutaveksling og overføringer til/fra deg selv der motposten ikke finnes i Saldo
  // (f.eks. en konto i en bank som ikke er koblet til, eller en annen valuta).
  for (const i of order) {
    const t = txs[i];
    if (t.userKind || t.kind !== 'normal' || linked.has(i)) continue;
    if (
      EXCHANGE.test(t.counterparty.trim()) ||
      EXCHANGE.test(t.description.trim()) ||
      isOwn(t.counterparty) ||
      // Påfylling av egen Revolut-konto fra en annen bank («Revolut**2327*»).
      (/^revolut\s*\*/i.test(t.counterparty.trim()) && accountsList.some((a) => /revolut/i.test(a.bankName))) ||
      (/^til:?\s*[\d\s.]+$/i.test(t.counterparty.trim()) && isOwn(t.description))
    ) {
      txs[i] = { ...t, kind: 'internal_transfer', linkedTransactionId: null };
    }
  }

  // Refusjoner
  for (const i of order) {
    const t = txs[i];
    if (t.amount <= 0 || t.userKind || t.kind !== 'normal') continue;
    const key = normalizeCounterparty(t.counterparty);
    const candidates = order
      .map((j) => txs[j])
      .filter(
        (p) =>
          p.amount < 0 &&
          p.kind === 'normal' &&
          normalizeCounterparty(p.counterparty) === key &&
          daysBetween(p.bookingDate, t.bookingDate) >= 0 &&
          daysBetween(p.bookingDate, t.bookingDate) <= REFUND_MAX_DAYS &&
          -p.amount >= t.amount,
      )
      .sort((a, b) => b.bookingDate.localeCompare(a.bookingDate));
    const purchase = candidates.find((p) => -p.amount === t.amount) ?? candidates[0];
    const hinted = REFUND_HINT.test(`${t.counterparty} ${t.description}`);
    if (purchase && (hinted || -purchase.amount === t.amount)) {
      txs[i] = {
        ...t,
        kind: 'refund',
        linkedTransactionId: purchase.id,
        category: t.userCategorized ? t.category : purchase.category,
      };
    } else if (hinted && !t.userCategorized && t.category === 'annen_inntekt') {
      txs[i] = { ...t, kind: 'refund', category: 'annet' };
    }
  }

  return txs;
}
