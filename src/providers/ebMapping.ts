import { normalizeCounterparty } from '../domain/categories';
import { currencyExponent } from '../domain/money';
import type { Account, AccountType, Connection, IsoDate, Minor, Transaction } from '../domain/types';

/**
 * Oversetter svar fra Enable Banking (Berlin Group-lignende format) til Saldos
 * domenemodell. Rene funksjoner uten nettverk, slik at de kan testes.
 */

export interface EbAmount {
  currency: string;
  amount: string;
}

export interface EbAccountResource {
  uid: string;
  identification_hash?: string | null;
  account_id?: { iban?: string | null; other?: { identification?: string | null } | null } | null;
  name?: string | null;
  details?: string | null;
  product?: string | null;
  currency?: string | null;
  cash_account_type?: string | null;
  credit_limit?: EbAmount | null;
}

export interface EbBalance {
  balance_amount: EbAmount;
  balance_type: string;
  name?: string | null;
  reference_date?: string | null;
  last_change_date_time?: string | null;
}

export interface EbTransaction {
  entry_reference?: string | null;
  transaction_id?: string | null;
  transaction_amount: EbAmount;
  credit_debit_indicator?: 'CRDT' | 'DBIT' | string | null;
  status?: string | null;
  booking_date?: string | null;
  value_date?: string | null;
  transaction_date?: string | null;
  creditor?: { name?: string | null } | null;
  debtor?: { name?: string | null } | null;
  remittance_information?: string[] | null;
  bank_transaction_code?: { description?: string | null } | null;
}

export interface EbAccountResult {
  account: EbAccountResource;
  balances: EbBalance[];
  transactions: EbTransaction[];
  error: string | null;
}

/** Tolker «123.45», «-5», «1234.5» (punktum som desimalskille) til minste enhet. */
export function parseDecimal(value: string, currency: string): Minor | null {
  const m = /^\s*([+-])?(\d+)(?:\.(\d+))?\s*$/.exec(String(value ?? ''));
  if (!m) return null;
  const exp = currencyExponent(currency);
  const frac = (m[3] ?? '').padEnd(exp + 1, '0');
  let minor = Number(m[2]) * 10 ** exp + Number(frac.slice(0, exp) || '0');
  if (Number(frac[exp] ?? '0') >= 5) minor += 1; // avrund halv opp
  return m[1] === '-' ? -minor : minor;
}

const BOOKED_TYPES = ['CLBD', 'ITBD', 'OPBD', 'PRCD', 'INFO'];
const AVAILABLE_TYPES = ['ITAV', 'CLAV', 'XPCD', 'OPAV', 'FWAV'];

function pickBalance(balances: EbBalance[], types: string[], currency: string): Minor | null {
  for (const t of types) {
    const b = balances.find((x) => x.balance_type === t && x.balance_amount?.currency === currency);
    if (b) return parseDecimal(b.balance_amount.amount, currency);
  }
  return null;
}

export function accountTypeOf(a: EbAccountResource): AccountType {
  const text = `${a.name ?? ''} ${a.product ?? ''} ${a.details ?? ''}`.toLowerCase();
  if (a.cash_account_type === 'CARD' || /kredittkort|credit card|kreditkort/.test(text)) return 'credit_card';
  if (/\bbsu\b/.test(text)) return 'bsu';
  if (a.cash_account_type === 'SVGS' || /spare|saving|opsparing/.test(text)) return 'savings';
  return 'checking';
}

export function maskIdentifier(a: EbAccountResource): { masked: string; last4: string } {
  const raw = (a.account_id?.iban ?? a.account_id?.other?.identification ?? '').replace(/\s+/g, '');
  const last4 = raw.slice(-4);
  return { masked: last4 ? `•••• ${last4}` : 'Ikke oppgitt', last4 };
}

export function ebAccountId(a: EbAccountResource): string {
  return `eb-${a.identification_hash || a.uid}`;
}

export function mapAccount(
  r: EbAccountResult,
  connection: Pick<Connection, 'id' | 'institutionName'>,
  fetchedAt: string,
  previous?: Account,
): Account {
  const a = r.account;
  const currency = a.currency || r.balances[0]?.balance_amount?.currency || previous?.currency || 'NOK';
  const type = accountTypeOf(a);
  const { masked, last4 } = maskIdentifier(a);
  const booked = r.error ? (previous?.bookedBalance ?? null) : pickBalance(r.balances, BOOKED_TYPES, currency);
  const available = r.error ? (previous?.availableBalance ?? null) : pickBalance(r.balances, AVAILABLE_TYPES, currency);
  const limit = a.credit_limit ? parseDecimal(a.credit_limit.amount, a.credit_limit.currency) : null;
  return {
    id: ebAccountId(a),
    connectionId: connection.id,
    bankName: connection.institutionName,
    name: a.name || a.product || a.details || (type === 'credit_card' ? 'Kredittkort' : 'Konto'),
    type,
    currency,
    maskedNumber: masked,
    bookedBalance: booked,
    availableBalance: available,
    availableIncludesReservations: true,
    balanceUpdatedAt: r.error ? (previous?.balanceUpdatedAt ?? null) : fetchedAt,
    includedInOverview: previous?.includedInOverview ?? true,
    isDemo: false,
    source: 'bank',
    card:
      type === 'credit_card'
        ? {
            issuer: connection.institutionName,
            last4,
            creditLimit: limit ?? previous?.card?.creditLimit ?? null,
            statement: previous?.card?.statement ?? null,
          }
        : undefined,
  };
}

function txDate(t: EbTransaction, fallback: IsoDate): IsoDate {
  const d = t.booking_date ?? t.transaction_date ?? t.value_date;
  return d && /^\d{4}-\d{2}-\d{2}/.test(d) ? d.slice(0, 10) : fallback;
}

export function mapTransactions(r: EbAccountResult, accountId: string, currency: string, today: IsoDate): Transaction[] {
  const seen = new Map<string, number>();
  const out: Transaction[] = [];
  for (const t of r.transactions) {
    const cur = t.transaction_amount?.currency || currency;
    const raw = parseDecimal(t.transaction_amount?.amount ?? '', cur);
    if (raw === null) continue;
    const debit = t.credit_debit_indicator === 'DBIT' || (t.credit_debit_indicator == null && raw < 0);
    const amount = debit ? -Math.abs(raw) : Math.abs(raw);
    const remittance = (t.remittance_information ?? []).filter(Boolean).join(' ').trim();
    const party = debit ? t.creditor?.name : t.debtor?.name;
    const counterparty = (party || remittance || t.bank_transaction_code?.description || 'Ukjent').trim().slice(0, 140);
    const date = txDate(t, today);
    const status = t.status === 'PDNG' ? 'pending' : 'booked';
    // Stabil ID: fra banken hvis den finnes, ellers et fingeravtrykk (med teller for like transaksjoner).
    let ext = t.entry_reference || t.transaction_id || null;
    if (!ext) {
      const base = `fp:${status}:${date}:${amount}:${normalizeCounterparty(counterparty)}`;
      const n = (seen.get(base) ?? 0) + 1;
      seen.set(base, n);
      ext = `${base}:${n}`;
    }
    out.push({
      id: `ebtx-${accountId}-${ext}`,
      accountId,
      externalId: ext,
      bookingDate: date,
      amount,
      currency: cur,
      counterparty,
      description: remittance && remittance !== counterparty ? remittance.slice(0, 280) : '',
      status,
      category: 'annet',
      kind: 'normal',
      linkedTransactionId: null,
      userCategorized: false,
      userKind: false,
      isDemo: false,
      source: 'bank',
    });
  }
  return out;
}
