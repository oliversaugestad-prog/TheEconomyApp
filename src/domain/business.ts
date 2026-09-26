import { convert, currencyExponent } from './money';
import type { BusinessData, CurrencyCode, ExchangeRate, Holding, Minor, Quote } from './types';

/**
 * Beregninger for bedriftssiden. Aksjeverdier regnes fra kurs × antall og
 * avrundes til minste valutaenhet. Ulike valutaer omregnes med oppgitt kurs.
 */

export function emptyBusiness(): BusinessData {
  return { name: 'Bedrift', items: [], holdings: [], quotes: {} };
}

/** Noen børser oppgir kurs i hundredeler (f.eks. GBp = pence). */
export function normalizeQuoteCurrency(currency: string, price: number): { currency: CurrencyCode; price: number } {
  if (currency === 'GBp' || currency === 'GBX') return { currency: 'GBP', price: price / 100 };
  if (currency === 'ZAc') return { currency: 'ZAR', price: price / 100 };
  if (currency === 'ILA') return { currency: 'ILS', price: price / 100 };
  return { currency: currency.toUpperCase(), price };
}

export interface HoldingValuation {
  holding: Holding;
  /** Kurs brukt i beregningen (per aksje, i `currency`). `null` = ukjent. */
  price: number | null;
  priceSource: 'market' | 'manual' | 'none';
  quote: Quote | null;
  currency: CurrencyCode;
  /** Markedsverdi i aksjens valuta (minste enhet). */
  value: Minor | null;
  /** Endring i dag i aksjens valuta (minste enhet). */
  dayChange: Minor | null;
  dayChangePct: number | null;
  /** Urealisert gevinst/tap i aksjens valuta (minste enhet). */
  gain: Minor | null;
  gainPct: number | null;
}

const toMinor = (amount: number, currency: CurrencyCode) => Math.round(amount * 10 ** currencyExponent(currency));

export function valueHolding(h: Holding, quotes: Record<string, Quote>): HoldingValuation {
  const quote = h.symbol ? (quotes[h.symbol] ?? null) : null;
  const price = quote ? quote.price : h.manualPrice;
  const currency = quote ? quote.currency : h.currency;
  const priceSource = quote ? 'market' : h.manualPrice !== null ? 'manual' : 'none';
  if (price === null || price === undefined) {
    return { holding: h, price: null, priceSource, quote, currency, value: null, dayChange: null, dayChangePct: null, gain: null, gainPct: null };
  }
  const value = toMinor(h.quantity * price, currency);
  const prev = quote?.previousClose ?? null;
  const dayChange = prev !== null ? toMinor(h.quantity * (price - prev), currency) : null;
  const dayChangePct = prev ? (price - prev) / prev : null;
  const gain = h.costPerShare !== null ? toMinor(h.quantity * (price - h.costPerShare), currency) : null;
  const gainPct = h.costPerShare ? (price - h.costPerShare) / h.costPerShare : null;
  return { holding: h, price, priceSource, quote, currency, value, dayChange, dayChangePct, gain, gainPct };
}

export interface BusinessSummary {
  currency: CurrencyCode;
  cash: Minor;
  shares: Minor;
  otherAssets: Minor;
  debt: Minor;
  /** Eiendeler minus gjeld. */
  total: Minor;
  dayChange: Minor;
  gain: Minor;
  /** Poster som ikke kunne tas med (ukjent kurs eller valutakurs). */
  missing: string[];
  valuations: HoldingValuation[];
  /** Eldste kurstidspunkt blant markedskursene. */
  oldestQuote: string | null;
}

export function summarizeBusiness(b: BusinessData, base: CurrencyCode, rates: ExchangeRate[]): BusinessSummary {
  const s: BusinessSummary = { currency: base, cash: 0, shares: 0, otherAssets: 0, debt: 0, total: 0, dayChange: 0, gain: 0, missing: [], valuations: [], oldestQuote: null };
  const inBase = (amount: Minor, currency: CurrencyCode, label: string): Minor | null => {
    const c = convert(amount, currency, base, rates);
    if (!c) {
      s.missing.push(`${label} (mangler kurs for ${currency})`);
      return null;
    }
    return c.amount;
  };
  for (const item of b.items) {
    const v = inBase(item.amount, item.currency, item.name);
    if (v === null) continue;
    if (item.kind === 'cash') s.cash += v;
    else if (item.kind === 'asset') s.otherAssets += v;
    else s.debt += v;
  }
  for (const h of b.holdings) {
    const val = valueHolding(h, b.quotes);
    s.valuations.push(val);
    if (val.value === null) {
      s.missing.push(`${h.name} (mangler kurs)`);
      continue;
    }
    const v = inBase(val.value, val.currency, h.name);
    if (v === null) continue;
    s.shares += v;
    if (val.dayChange !== null) s.dayChange += inBase(val.dayChange, val.currency, h.name) ?? 0;
    if (val.gain !== null) s.gain += inBase(val.gain, val.currency, h.name) ?? 0;
    const t = val.quote?.time;
    if (t && (!s.oldestQuote || t < s.oldestQuote)) s.oldestQuote = t;
  }
  s.total = s.cash + s.shares + s.otherAssets - s.debt;
  return s;
}
