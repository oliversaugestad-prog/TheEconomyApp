import type { CurrencyCode, ExchangeRate, Minor } from './types';

/** Antall desimaler (minste enhet) per valuta. */
const EXPONENT: Record<string, number> = { JPY: 0, ISK: 0, KRW: 0 };

export function currencyExponent(currency: CurrencyCode): number {
  return EXPONENT[currency] ?? 2;
}

const formatters = new Map<string, Intl.NumberFormat>();

function formatter(currency: CurrencyCode, signDisplay: 'auto' | 'exceptZero' | 'never'): Intl.NumberFormat {
  const key = `${currency}|${signDisplay}`;
  let f = formatters.get(key);
  if (!f) {
    const digits = currencyExponent(currency);
    f = new Intl.NumberFormat('nb-NO', {
      style: 'currency',
      currency,
      currencyDisplay: currency === 'NOK' ? 'symbol' : 'code',
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
      signDisplay,
    });
    formatters.set(key, f);
  }
  return f;
}

export interface FormatOptions {
  /** Vis alltid fortegn (+/−) for ikke-null beløp. */
  signed?: boolean;
  /** Utelat fortegn helt (for tall som forklares med tekst, f.eks. «Gjeld»). */
  absolute?: boolean;
}

/** Formaterer f.eks. 2485050 øre som «24 850,50 kr». */
export function formatMoney(amount: Minor, currency: CurrencyCode = 'NOK', opts: FormatOptions = {}): string {
  const value = amount / 10 ** currencyExponent(currency);
  const sign = opts.absolute ? 'never' : opts.signed ? 'exceptZero' : 'auto';
  return formatter(currency, sign).format(value);
}

/**
 * Tolker et beløp skrevet i norsk eller internasjonalt format til minste enhet.
 * Godtar «1 234,50», «-1234.50», «1.234,50», «kr 99», «−45,00», «(45,00)».
 * Bruker strengbehandling, ikke flyttall, slik at ingen øre går tapt.
 */
export function parseAmount(input: string, currency: CurrencyCode = 'NOK'): Minor | null {
  if (input == null) return null;
  let s = String(input).trim();
  if (!s) return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  s = s.replace(/[−–]/g, '-'); // typografisk minus
  s = s.replace(/(kr|nok|eur|sek|usd|€|\$)/gi, '');
  s = s.replace(/[\s  ']/g, '');
  if (s.startsWith('-')) {
    negative = !negative;
    s = s.slice(1);
  } else if (s.startsWith('+')) {
    s = s.slice(1);
  }
  if (s.endsWith('-')) {
    negative = !negative;
    s = s.slice(0, -1);
  }
  if (!/^[\d.,]+$/.test(s)) return null;

  let intPart = s;
  let fracPart = '';
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma >= 0 && lastDot >= 0) {
    // Begge skilletegn: det siste er desimalskille.
    const idx = Math.max(lastComma, lastDot);
    intPart = s.slice(0, idx);
    fracPart = s.slice(idx + 1);
  } else if (lastComma >= 0 || lastDot >= 0) {
    const sep = lastComma >= 0 ? ',' : '.';
    const parts = s.split(sep);
    const after = parts[parts.length - 1];
    // Flere like skilletegn, eller nøyaktig tre sifre etter, tolkes som tusenskille.
    if (parts.length === 2 && (after.length !== 3 || /^0?$/.test(parts[0]))) {
      intPart = parts[0];
      fracPart = after;
    }
  }
  intPart = intPart.replace(/[.,]/g, '');
  if (!/^\d*$/.test(intPart) || !/^\d*$/.test(fracPart)) return null;
  const exp = currencyExponent(currency);
  if (fracPart.length > exp) {
    // Flere desimaler enn valutaen støtter: avrund halv opp.
    const keep = fracPart.slice(0, exp);
    const next = Number(fracPart[exp]);
    let minor = Number((intPart || '0') + keep.padEnd(exp, '0'));
    if (next >= 5) minor += 1;
    return negative ? -minor : minor;
  }
  const minor = Number((intPart || '0') + fracPart.padEnd(exp, '0'));
  if (!Number.isSafeInteger(minor)) return null;
  return negative && minor !== 0 ? -minor : minor;
}

export interface ConversionInfo {
  currency: CurrencyCode;
  rate: number;
  asOf: string;
  source: string;
}

/** Omregner beløp til basisvaluta. Returnerer `null` dersom kurs mangler. */
export function convert(
  amount: Minor,
  from: CurrencyCode,
  to: CurrencyCode,
  rates: ExchangeRate[],
): { amount: Minor; rate: ExchangeRate | null } | null {
  if (from === to) return { amount, rate: null };
  const r = rates.find((x) => x.currency === from && x.base === to);
  if (!r) return null;
  const factor = 10 ** (currencyExponent(to) - currencyExponent(from));
  return { amount: Math.round(amount * r.rate * factor), rate: r };
}

export interface SumItem {
  id: string;
  label: string;
  amount: Minor | null;
  currency: CurrencyCode;
}

export interface MoneySum {
  /** Summen av alle kjente beløp, i basisvaluta. */
  amount: Minor;
  currency: CurrencyCode;
  /** `false` dersom minst ett beløp mangler (ukjent) eller mangler valutakurs. */
  complete: boolean;
  /** Poster som ikke kunne tas med fordi beløpet er ukjent. */
  missing: SumItem[];
  /** Poster i fremmed valuta uten kurs. */
  unconvertible: SumItem[];
  /** Valutakurser som ble brukt til omregning. */
  conversions: ConversionInfo[];
  /** Antall poster som inngår. */
  count: number;
}

/**
 * Summerer beløp på tvers av kontoer. Ukjente beløp behandles som ukjente
 * (ikke null) og gjør summen ufullstendig. Ulike valutaer summeres aldri
 * direkte – de omregnes med oppgitt kurs, og kursen rapporteres.
 */
export function sumMoney(items: SumItem[], base: CurrencyCode, rates: ExchangeRate[]): MoneySum {
  const result: MoneySum = {
    amount: 0,
    currency: base,
    complete: true,
    missing: [],
    unconvertible: [],
    conversions: [],
    count: 0,
  };
  for (const item of items) {
    if (item.amount === null || item.amount === undefined) {
      result.missing.push(item);
      result.complete = false;
      continue;
    }
    const converted = convert(item.amount, item.currency, base, rates);
    if (!converted) {
      result.unconvertible.push(item);
      result.complete = false;
      continue;
    }
    if (converted.rate && !result.conversions.some((c) => c.currency === item.currency)) {
      result.conversions.push({
        currency: item.currency,
        rate: converted.rate.rate,
        asOf: converted.rate.asOf,
        source: converted.rate.source,
      });
    }
    result.amount += converted.amount;
    result.count += 1;
  }
  return result;
}
