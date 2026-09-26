import { emptyBusiness, summarizeBusiness, type BusinessSummary } from './business';
import { balanceSummary } from './calculations';
import type { MoneySum } from './money';
import type { AppData, CurrencyCode, Minor } from './types';

export interface NetWorth {
  currency: CurrencyCode;
  /** Saldo på tilkoblede og manuelle bankkontoer som er med i oversikten. */
  bank: MoneySum;
  /** Utestående kredittkortgjeld. */
  cardDebt: MoneySum;
  /** Private investeringer, eiendeler og lån lagt inn manuelt. */
  personal: BusinessSummary;
  /** Bedriften (hele verdien), eller `null` når den ikke er registrert. */
  business: BusinessSummary | null;
  /** Din eierandel i bedriften, 0–100. */
  ownership: number;
  /** Din andel av bedriftens verdi. */
  businessShare: Minor;
  /** Eiendeler i ditt navn: bank + investeringer + andre eiendeler (før gjeld). */
  assets: Minor;
  /** All gjeld i ditt navn: kredittkort + lån. */
  debt: Minor;
  /** Nettoformue i ditt navn, uten bedriften. */
  total: Minor;
  /** Nettoformue inkludert din andel av bedriften. */
  totalWithBusiness: Minor;
  /** `false` når noe mangler saldo eller kurs – totalen er da et minimum. */
  complete: boolean;
}

/**
 * Hva du eier i ditt eget navn. Bedriften holdes som egen linje fordi den er et
 * eget rettssubjekt (for et AS eier du aksjene, ikke pengene i selskapet).
 */
export function netWorth(data: Pick<AppData, 'accounts' | 'transactions' | 'rates' | 'settings' | 'business' | 'personalAssets'>): NetWorth {
  const base = data.settings.baseCurrency;
  const bal = balanceSummary(data);
  const personal = summarizeBusiness(data.personalAssets ?? emptyBusiness('Privat'), base, data.rates);
  const hasBusiness = !!data.business && (data.business.items.length > 0 || data.business.holdings.length > 0);
  const business = hasBusiness ? summarizeBusiness(data.business!, base, data.rates) : null;
  const ownership = data.business?.ownership ?? 100;
  const businessShare = business ? Math.round((business.total * ownership) / 100) : 0;
  const assets = bal.booked.amount + personal.cash + personal.shares + personal.otherAssets;
  const debt = bal.cardDebt.amount + personal.debt;
  const total = assets - debt;
  return {
    currency: base,
    bank: bal.booked,
    cardDebt: bal.cardDebt,
    personal,
    business,
    ownership,
    businessShare,
    assets,
    debt,
    total,
    totalWithBusiness: total + businessShare,
    complete: bal.booked.complete && bal.cardDebt.complete && personal.missing.length === 0,
  };
}
