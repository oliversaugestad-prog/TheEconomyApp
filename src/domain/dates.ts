import type { IsoDate, IsoTimestamp } from './types';

/**
 * Datohjelpere. Bokføringsdatoer er rene kalenderdatoer (`YYYY-MM-DD`) og
 * regnes med i UTC for å unngå sommertidsfeil. Tidspunkter vises i brukerens
 * tidssone.
 */

export const DEFAULT_TIME_ZONE = 'Europe/Oslo';

export function parseIsoDate(d: IsoDate): Date {
  const [y, m, day] = d.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, day));
}

export function toIsoDate(d: Date): IsoDate {
  return d.toISOString().slice(0, 10);
}

/** Dagens dato i gitt tidssone. */
export function todayIn(timeZone: string, now: Date = new Date()): IsoDate {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function addDays(d: IsoDate, days: number): IsoDate {
  const date = parseIsoDate(d);
  date.setUTCDate(date.getUTCDate() + days);
  return toIsoDate(date);
}

/** Legger til måneder og beholder dag-i-måneden der det er mulig (31. → siste dag). */
export function addMonths(d: IsoDate, months: number, preferredDay?: number): IsoDate {
  const date = parseIsoDate(d);
  const day = preferredDay ?? date.getUTCDate();
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return toIsoDate(target);
}

export function daysBetween(a: IsoDate, b: IsoDate): number {
  return Math.round((parseIsoDate(b).getTime() - parseIsoDate(a).getTime()) / 86_400_000);
}

export type MonthKey = string; // YYYY-MM

export function monthKey(d: IsoDate): MonthKey {
  return d.slice(0, 7);
}

export function monthStart(key: MonthKey): IsoDate {
  return `${key}-01`;
}

export function monthEnd(key: MonthKey): IsoDate {
  return addDays(addMonths(monthStart(key), 1), -1);
}

export function shiftMonth(key: MonthKey, delta: number): MonthKey {
  return monthKey(addMonths(monthStart(key), delta));
}

/** Liste med månedsnøkler, eldste først, som slutter i `last`. */
export function lastMonths(last: MonthKey, count: number): MonthKey[] {
  return Array.from({ length: count }, (_, i) => shiftMonth(last, i - count + 1));
}

const dateFmt = new Map<string, Intl.DateTimeFormat>();
function fmt(key: string, opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  let f = dateFmt.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat('nb-NO', opts);
    dateFmt.set(key, f);
  }
  return f;
}

/** «26. sep. 2026» – kalenderdato (ingen tidssoneomregning). */
export function formatDate(d: IsoDate, style: 'short' | 'medium' | 'long' = 'medium'): string {
  const opts: Intl.DateTimeFormatOptions =
    style === 'short'
      ? { day: 'numeric', month: 'short', timeZone: 'UTC' }
      : style === 'long'
        ? { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }
        : { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' };
  return fmt(`d|${style}`, opts).format(parseIsoDate(d));
}

/** «september 2026» */
export function formatMonth(key: MonthKey, short = false): string {
  const opts: Intl.DateTimeFormatOptions = short
    ? { month: 'short', timeZone: 'UTC' }
    : { month: 'long', year: 'numeric', timeZone: 'UTC' };
  return fmt(`m|${short}`, opts).format(parseIsoDate(monthStart(key))).replace('.', '');
}

/** Tidspunkt vist i brukerens tidssone, f.eks. «26. sep. 2026, 09:41». */
export function formatTimestamp(ts: IsoTimestamp, timeZone: string): string {
  return fmt(`t|${timeZone}`, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone,
  }).format(new Date(ts));
}

/** «for 5 min siden», «i går» osv. */
export function formatRelative(ts: IsoTimestamp, now: Date = new Date()): string {
  const diffMin = Math.round((now.getTime() - new Date(ts).getTime()) / 60_000);
  if (diffMin < 1) return 'akkurat nå';
  if (diffMin < 60) return `for ${diffMin} min siden`;
  const diffH = Math.round(diffMin / 60);
  if (diffH < 24) return `for ${diffH} t siden`;
  const diffD = Math.round(diffH / 24);
  if (diffD === 1) return 'i går';
  return `for ${diffD} dager siden`;
}

export function relativeDay(d: IsoDate, today: IsoDate): string {
  const n = daysBetween(today, d);
  if (n === 0) return 'i dag';
  if (n === 1) return 'i morgen';
  if (n === -1) return 'i går';
  if (n > 1 && n < 7) return `om ${n} dager`;
  return formatDate(d, 'short');
}
