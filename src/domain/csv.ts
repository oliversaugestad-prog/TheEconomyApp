import { normalizeCounterparty } from './categories';
import { parseAmount } from './money';
import type { CurrencyCode, IsoDate, Minor, Transaction } from './types';

/** Tolker CSV-tekst. Oppdager skilletegn (; , tab) og håndterer anførselstegn. */
export function parseCsv(text: string): { delimiter: string; rows: string[][] } {
  const clean = text.replace(/^﻿/, '');
  const firstLine = clean.split(/\r?\n/, 1)[0] ?? '';
  const candidates = [';', ',', '\t'];
  const delimiter = candidates
    .map((d) => ({ d, n: splitLine(firstLine, d).length }))
    .sort((a, b) => b.n - a.n)[0].d;

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i];
    if (inQuotes) {
      if (c === '"') {
        if (clean[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === delimiter) {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && clean[i + 1] === '\n') i++;
      row.push(field);
      if (row.some((x) => x.trim() !== '')) rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  row.push(field);
  if (row.some((x) => x.trim() !== '')) rows.push(row);
  return { delimiter, rows: rows.map((r) => r.map((x) => x.trim())) };
}

function splitLine(line: string, d: string): string[] {
  return line.split(d);
}

/**
 * Tolker «24.09.2026», «24/09/2026», «2026-09-24» og «24.09.26».
 * Med `order = 'mdy'` tolkes «09/24/2026» som amerikansk (måned først), slik noen utstedere eksporterer.
 */
export function parseDate(input: string, order: 'dmy' | 'mdy' = 'dmy'): IsoDate | null {
  const s = input.trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  let y: number, mo: number, d: number;
  if (m) {
    y = +m[1];
    mo = +m[2];
    d = +m[3];
  } else {
    m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/.exec(s);
    if (!m) return null;
    d = order === 'mdy' ? +m[2] : +m[1];
    mo = order === 'mdy' ? +m[1] : +m[2];
    y = +m[3];
    if (y < 100) y += 2000;
  }
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCMonth() !== mo - 1) return null;
  return date.toISOString().slice(0, 10);
}

export interface CsvMapping {
  hasHeader: boolean;
  date: number | null;
  /** Én kolonne med fortegn … */
  amount: number | null;
  /** … eller separate kolonner for ut/inn. */
  outAmount: number | null;
  inAmount: number | null;
  counterparty: number | null;
  description: number | null;
  /** Datoformat: dag først (norsk) eller måned først (amerikansk). */
  dateOrder?: 'dmy' | 'mdy';
  /** Snu fortegn: kjøp står som positive beløp (vanlig for kredittkort, f.eks. Amex). */
  invert?: boolean;
}

export type CsvColumn = 'date' | 'amount' | 'outAmount' | 'inAmount' | 'counterparty' | 'description';

const HEADER_HINTS: Record<CsvColumn, RegExp> = {
  date: /(dato|date|bokf)/i,
  amount: /^(beløp|belop|amount|sum)$/i,
  outAmount: /(ut|uttak|debet|belastet)/i,
  inAmount: /(inn|innskudd|kredit)/i,
  counterparty: /(mottaker|betalingsmottaker|motpart|navn|counterparty|payee|butikk)/i,
  description: /(beskrivelse|tekst|forklaring|description|melding)/i,
};

/** Foreslår kolonnemapping ut fra overskriftene. */
export function guessMapping(rows: string[][]): CsvMapping {
  const header = rows[0] ?? [];
  const hasHeader = header.length > 0 && header.every((h) => parseAmount(h) === null && parseDate(h) === null);
  const mapping: CsvMapping = {
    hasHeader,
    date: null,
    amount: null,
    outAmount: null,
    inAmount: null,
    counterparty: null,
    description: null,
  };
  if (hasHeader) {
    const used = new Set<number>();
    for (const key of ['date', 'amount', 'counterparty', 'description', 'outAmount', 'inAmount'] as const) {
      const idx = header.findIndex((h, i) => !used.has(i) && HEADER_HINTS[key].test(h));
      if (idx >= 0) {
        mapping[key] = idx;
        used.add(idx);
      }
    }
    if (mapping.amount !== null) {
      mapping.outAmount = null;
      mapping.inAmount = null;
    }
  } else {
    const sample = rows[0] ?? [];
    mapping.date = sample.findIndex((c) => parseDate(c) !== null);
    mapping.amount = sample.findIndex((c, i) => i !== mapping.date && parseAmount(c) !== null);
    mapping.description = sample.findIndex((c, i) => i !== mapping.date && i !== mapping.amount && c.length > 0);
    for (const k of ['date', 'amount', 'description'] as const) if (mapping[k] === -1) mapping[k] = null;
  }
  if (mapping.date !== null) mapping.dateOrder = guessDateOrder(rows.slice(hasHeader ? 1 : 0).map((r) => r[mapping.date!] ?? ''));
  return mapping;
}

/** Måned først dersom datoene bare gir mening slik (f.eks. «09/24/2026»). */
export function guessDateOrder(values: string[]): 'dmy' | 'mdy' {
  const okDmy = values.filter((v) => parseDate(v, 'dmy')).length;
  const okMdy = values.filter((v) => parseDate(v, 'mdy')).length;
  return okMdy > okDmy ? 'mdy' : 'dmy';
}

/** Andel positive beløp – brukes til å foreslå å snu fortegn for kredittkort. */
export function positiveShare(rows: CsvRowResult[]): number {
  const amounts = rows.filter((r) => r.amount !== null && r.amount !== 0);
  return amounts.length ? amounts.filter((r) => r.amount! > 0).length / amounts.length : 0;
}

export interface CsvRowResult {
  line: number;
  date: IsoDate | null;
  amount: Minor | null;
  counterparty: string;
  description: string;
  error: string | null;
  fingerprint: string | null;
  duplicate: boolean;
}

export function fingerprint(accountId: string, date: IsoDate, amount: Minor, text: string): string {
  return `${accountId}|${date}|${amount}|${normalizeCounterparty(text)}`;
}

/**
 * Lager forhåndsvisning med feil og duplikatmarkering.
 *
 * Duplikatkontroll: hver rad får et fingeravtrykk (konto, dato, beløp, tekst).
 * Hvis samme fingeravtrykk finnes N ganger fra før, regnes de N første like
 * radene i filen som duplikater. Slik kan to helt like kjøp samme dag
 * importeres, mens gjentatt import av samme fil ikke gir duplikater.
 */
export function previewImport(
  rows: string[][],
  mapping: CsvMapping,
  accountId: string,
  currency: CurrencyCode,
  existing: Transaction[],
): CsvRowResult[] {
  const existingCounts = new Map<string, number>();
  for (const t of existing) {
    if (t.accountId !== accountId) continue;
    const fp = t.importFingerprint ?? fingerprint(accountId, t.bookingDate, t.amount, t.counterparty || t.description);
    existingCounts.set(fp, (existingCounts.get(fp) ?? 0) + 1);
  }
  const seen = new Map<string, number>();
  const data = mapping.hasHeader ? rows.slice(1) : rows;
  const offset = mapping.hasHeader ? 2 : 1;

  return data.map((r, i) => {
    const get = (idx: number | null) => (idx === null ? '' : (r[idx] ?? ''));
    const date = mapping.date === null ? null : parseDate(get(mapping.date), mapping.dateOrder);
    let amount: Minor | null = null;
    if (mapping.amount !== null) {
      amount = parseAmount(get(mapping.amount), currency);
    } else if (mapping.outAmount !== null || mapping.inAmount !== null) {
      const out = get(mapping.outAmount) ? parseAmount(get(mapping.outAmount), currency) : 0;
      const inn = get(mapping.inAmount) ? parseAmount(get(mapping.inAmount), currency) : 0;
      amount = out === null || inn === null ? null : (inn ?? 0) - Math.abs(out ?? 0);
    }
    if (mapping.invert && amount !== null && amount !== 0) amount = -amount;
    const counterparty = get(mapping.counterparty);
    const description = get(mapping.description);
    let error: string | null = null;
    if (mapping.date === null) error = 'Velg datokolonne';
    else if (!date) error = `Ugyldig dato «${get(mapping.date)}»`;
    else if (mapping.amount === null && mapping.outAmount === null && mapping.inAmount === null) error = 'Velg beløpskolonne';
    else if (amount === null) error = 'Ugyldig beløp';
    else if (!counterparty && !description) error = 'Mangler tekst/mottaker';

    let fp: string | null = null;
    let duplicate = false;
    if (!error && date && amount !== null) {
      fp = fingerprint(accountId, date, amount, counterparty || description);
      const n = (seen.get(fp) ?? 0) + 1;
      seen.set(fp, n);
      duplicate = n <= (existingCounts.get(fp) ?? 0);
    }
    return { line: i + offset, date, amount, counterparty, description, error, fingerprint: fp, duplicate };
  });
}
