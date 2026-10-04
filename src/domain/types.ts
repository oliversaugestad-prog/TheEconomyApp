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
  /** Valgt kortfarge (id fra CARD_COLORS). */
  color?: string;
  /** Brukeren har gitt kontoen eget navn – beholdes ved oppdatering fra banken. */
  nameEdited?: boolean;
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
/** `business`: bedriftens utgift betalt privat av eier – holdes utenfor privat økonomi. */
export type TransactionKind = 'normal' | 'internal_transfer' | 'card_payment' | 'refund' | 'business';

export type CategoryId =
  | 'bolig'
  | 'lan'
  | 'medlemskap'
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
  /** Kortets bransjekode (MCC) når banken oppgir den. */
  mcc?: string | null;
  /** Hendelse/tur transaksjonen er koblet til (valgt av brukeren). */
  eventId?: string | null;
}

/** `months`: hver N. måned (N i `everyMonths`), f.eks. hver 4. måned. */
export type BillingInterval = 'weekly' | 'monthly' | 'quarterly' | 'yearly' | 'months';

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
  /** Antall måneder mellom trekk når `interval` er `months`. */
  everyMonths?: number;
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
  /** Bedriftens abonnement betalt privat av eier – holdes utenfor private summer. */
  business?: boolean;
  isDemo: boolean;
}

export interface CategoryRule {
  id: string;
  /** Normalisert mottaker som regelen gjelder. */
  matchKey: string;
  category: CategoryId;
  /** Lignende kjøp markeres også som bedriftsutgift betalt av eier. */
  business?: boolean;
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

/* ------------------------------ Bedrift ------------------------------ */

/** Manuelt registrert post: bankinnskudd/kontanter, annen eiendel eller gjeld. */
export interface BusinessItem {
  id: string;
  kind: 'cash' | 'asset' | 'debt';
  name: string;
  /** F.eks. bank eller långiver. */
  institution: string;
  currency: CurrencyCode;
  /** Beløp i minste enhet. For gjeld: utestående som positivt tall. */
  amount: Minor;
  updatedAt: IsoTimestamp;
}

/** Aksjepost. Børsnoterte følger markedskurs; unoterte har manuell kurs. */
export interface Holding {
  id: string;
  /** Ticker hos kursleverandøren (f.eks. «EQNR.OL»). `null` for unoterte. */
  symbol: string | null;
  name: string;
  exchange: string;
  /** Valuta kursen oppgis i. */
  currency: CurrencyCode;
  /** Antall aksjer/andeler (kan være desimaltall for fond). */
  quantity: number;
  /** Gjennomsnittlig kjøpskurs per aksje i `currency`, hvis kjent. */
  costPerShare: number | null;
  /** Manuell kurs per aksje (brukes for unoterte, eller når markedskurs mangler). */
  manualPrice: number | null;
  updatedAt: IsoTimestamp;
}

export interface Quote {
  symbol: string;
  price: number;
  previousClose: number | null;
  currency: CurrencyCode;
  /** Tidspunkt for siste handel/kurs. */
  time: IsoTimestamp | null;
  fetchedAt: IsoTimestamp;
  source: string;
}

export interface BusinessData {
  name: string;
  /** Din eierandel i prosent (kun bedrift). Standard 100 %. */
  ownership?: number;
  items: BusinessItem[];
  holdings: Holding[];
  quotes: Record<string, Quote>;
}

export interface AppData {
  version: 1;
  /** Bankkontoer/kort brukeren har slettet – legges ikke til igjen ved oppdatering. */
  removedAccountIds?: string[];
  connections: Connection[];
  accounts: Account[];
  transactions: Transaction[];
  subscriptions: Subscription[];
  dismissedSuggestions: string[];
  rules: CategoryRule[];
  rates: ExchangeRate[];
  settings: Settings;
  /** Manuell bedriftsside (valgfri). */
  business?: BusinessData;
  /** Private investeringer, eiendeler og lån som ikke kommer fra banktilkobling. */
  personalAssets?: BusinessData;
  /** Hendelser og turer med eget budsjett (f.eks. «Marokko-tur»). */
  events?: SpendEvent[];
}

/**
 * Post på en hendelse som ikke kommer fra banken:
 * - faktisk utgift uten kort (kontanter, noe en venn la ut), eller
 * - anslag (`estimate`): hva du tror noe vil koste, før det er betalt.
 */
export interface EventItem {
  id: string;
  name: string;
  /** Positivt beløp = utgift. */
  amount: Minor;
  currency: CurrencyCode;
  date: IsoDate | null;
  /** Anslått/antatt pris – ikke betalt ennå. */
  estimate?: boolean;
  /** Anslaget er betalt (det faktiske kjøpet er koblet) og telles ikke lenger. */
  done?: boolean;
}

/** En hendelse, tur eller ting som kjøp kan kobles til, med valgfritt budsjett. */
export interface SpendEvent {
  id: string;
  name: string;
  emoji: string;
  /** Budsjett i `currency`. `null` = uten budsjett. */
  budget: Minor | null;
  currency: CurrencyCode;
  startDate: IsoDate | null;
  endDate: IsoDate | null;
  note: string;
  items: EventItem[];
  archived: boolean;
  createdAt: IsoTimestamp;
}
