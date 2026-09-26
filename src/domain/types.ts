/**
 * Domenemodell for Saldo.
 *
 * Alle pengebeløp lagres som heltall i minste valutaenhet (øre/cent) for å
 * unngå avrundingsfeil. Datoer uten klokkeslett (bokføringsdato) lagres som
 * `YYYY-MM-DD`; tidspunkter lagres som ISO 8601 i UTC og vises i brukerens
 * tidssone.
 */

export type CurrencyCode = string; // ISO 4217, f.eks. "NOK"

/** Beløp i minste valutaenhet (heltall). */
export type Minor = number;

export type IsoDate = string; // YYYY-MM-DD
export type IsoTimestamp = string; // 2026-09-26T08:15:00.000Z

export type DataSource = 'demo' | 'manual' | 'csv' | 'bank';

export type ConnectionStatus = 'ok' | 'syncing' | 'error' | 'reauth_required' | 'disconnected';

export interface Connection {
  id: string;
  /** Hvilken datatilbyder tilkoblingen tilhører (demo, manual, csv, enablebanking …). */
  providerId: string;
  institutionName: string;
  status: ConnectionStatus;
  lastSuccessfulSync: IsoTimestamp | null;
  lastAttempt: IsoTimestamp | null;
  /** Brukervennlig feilmelding fra siste forsøk. */
  error: string | null;
  /** Når samtykket hos banken utløper, dersom kjent. */
  consentExpiresAt: IsoTimestamp | null;
  isDemo: boolean;
  source: DataSource;
}

export type AccountType = 'checking' | 'savings' | 'bsu' | 'credit_card';

export interface CardStatement {
  /** Fakturabeløp som positivt tall (hva som skal betales). */
  amount: Minor | null;
  minimumPayment: Minor | null;
  dueDate: IsoDate | null;
  /** Hvem som oppga fakturaopplysningene. */
  source: 'provider' | 'manual';
  updatedAt: IsoTimestamp;
}

export interface CardDetails {
  issuer: string;
  /** Kun de fire siste sifrene lagres – aldri komplett kortnummer. */
  last4: string;
  creditLimit: Minor | null;
  statement: CardStatement | null;
}

export interface Account {
  id: string;
  connectionId: string;
  bankName: string;
  name: string;
  type: AccountType;
  currency: CurrencyCode;
  /** Maskert kontonummer, f.eks. "•••• 12 34567". Kun de siste sifrene lagres. */
  maskedNumber: string;
  /**
   * Bokført saldo. `null` betyr ukjent – aldri null kroner.
   * For kredittkort er saldo negativ når man skylder penger.
   */
  bookedBalance: Minor | null;
  /** Tilgjengelig saldo slik datakilden oppgir den. `null` = ikke oppgitt. */
  availableBalance: Minor | null;
  /**
   * Om tilgjengelig saldo fra kilden allerede tar hensyn til reservasjoner.
   * Når dette er `true` skal reservasjoner ikke trekkes fra på nytt.
   */
  availableIncludesReservations: boolean;
  balanceUpdatedAt: IsoTimestamp | null;
  includedInOverview: boolean;
  card?: CardDetails;
  isDemo: boolean;
  source: DataSource;
}

export type TransactionStatus = 'booked' | 'pending';

/**
 * Hvordan en transaksjon skal behandles i inntekts- og utgiftsberegninger.
 * - `normal`: vanlig inntekt eller utgift
 * - `internal_transfer`: overføring mellom egne kontoer – teller ikke
 * - `card_payment`: betaling av kredittkortregning – teller ikke (kjøpene er
 *   allerede registrert på kortet)
 * - `refund`: refusjon – reduserer utgiftene i kategorien
 */
export type TransactionKind = 'normal' | 'internal_transfer' | 'card_payment' | 'refund';

export type CategoryId =
  | 'bolig'
  | 'dagligvarer'
  | 'transport'
  | 'shopping'
  | 'helse'
  | 'underholdning'
  | 'abonnementer'
  | 'restaurant'
  | 'lonn'
  | 'annen_inntekt'
  | 'annet';

export interface Transaction {
  id: string;
  accountId: string;
  /** ID fra datakilden. Brukes til duplikatkontroll ved synkronisering. */
  externalId: string | null;
  /** For bokførte transaksjoner: ID til reservasjonen den erstatter, hvis kjent. */
  replacesPendingExternalId?: string | null;
  bookingDate: IsoDate;
  amount: Minor;
  currency: CurrencyCode;
  counterparty: string;
  description: string;
  status: TransactionStatus;
  category: CategoryId;
  kind: TransactionKind;
  /** ID til motposten ved intern overføring/kortbetaling. */
  linkedTransactionId: string | null;
  /** Brukeren har selv satt kategori/type – automatikk skal ikke overstyre. */
  userCategorized: boolean;
  userKind: boolean;
  isDemo: boolean;
  source: DataSource;
  /** Fingeravtrykk for CSV-import (duplikatkontroll). */
  importFingerprint?: string;
}

export type BillingInterval = 'weekly' | 'monthly' | 'quarterly' | 'yearly';

export interface PricePoint {
  date: IsoDate;
  amount: Minor;
}

export interface Subscription {
  id: string;
  name: string;
  /** Pris per trekk (positivt tall). */
  amount: Minor;
  currency: CurrencyCode;
  interval: BillingInterval;
  accountId: string | null;
  /** Første kjente trekkdato; brukes til å estimere neste trekk. */
  anchorDate: IsoDate;
  /** `subscription` = abonnement, `fixed` = annen fast betaling (husleie, lån …). */
  kind: 'subscription' | 'fixed';
  status: 'active' | 'ended';
  endedAt: IsoDate | null;
  source: 'detected' | 'manual';
  /** Normalisert mottakernavn som knytter abonnementet til transaksjoner. */
  matchKey: string | null;
  category: CategoryId;
  isDemo: boolean;
}

export interface CategoryRule {
  id: string;
  /** Normalisert mottaker som regelen gjelder. */
  matchKey: string;
  category: CategoryId;
  createdAt: IsoTimestamp;
}

export interface ExchangeRate {
  /** Antall NOK (eller basisvaluta) per 1 enhet av `currency`. */
  currency: CurrencyCode;
  base: CurrencyCode;
  rate: number;
  asOf: IsoTimestamp;
  source: string;
}

export type Accent = 'blue' | 'coral';

export interface NotificationSettings {
  upcomingPayments: boolean;
  reauthNeeded: boolean;
  priceChanges: boolean;
  largeTransactions: boolean;
}

export interface Settings {
  accent: Accent;
  baseCurrency: CurrencyCode;
  timeZone: string;
  hideAmounts: boolean;
  notifications: NotificationSettings;
  /** Navn du står oppført med i banken – brukes til å gjenkjenne overføringer til deg selv. */
  ownNames?: string[];
}

export interface AppData {
  version: 1;
  connections: Connection[];
  accounts: Account[];
  transactions: Transaction[];
  subscriptions: Subscription[];
  dismissedSuggestions: string[];
  rules: CategoryRule[];
  rates: ExchangeRate[];
  settings: Settings;
}
