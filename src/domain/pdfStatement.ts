import { parseAmount } from './money';
import type { IsoDate, Minor } from './types';

/**
 * Tolker teksten fra en kredittkortfaktura (PDF) til transaksjonsrader.
 *
 * PDF-er har ingen fast struktur, så dette er et beste forsøk: en linje regnes som en
 * transaksjon når den starter med en dato og slutter med et beløp med to desimaler.
 * Oppsummeringslinjer (saldo, totalt, å betale …) hoppes over. Resultatet vises alltid
 * i forhåndsvisningen før noe lagres.
 */

export interface PdfStatementRow {
  date: IsoDate;
  description: string;
  /** Beløp med fortegn slik fakturaen viser det (kjøp er ofte positive på kortfakturaer). */
  amount: Minor;
}

export interface PdfStatement {
  rows: PdfStatementRow[];
  /** «Å betale» / «Ny saldo» fra fakturaen, hvis funnet (positivt beløp). */
  total: Minor | null;
  /** Forfallsdato, hvis funnet. */
  dueDate: IsoDate | null;
  /** Antall linjer i dokumentet (for feilmeldinger). */
  lineCount: number;
}

const MONTHS: Record<string, number> = {
  jan: 1, januar: 1, january: 1,
  feb: 2, februar: 2, february: 2,
  mar: 3, mars: 3, march: 3,
  apr: 4, april: 4,
  mai: 5, may: 5,
  jun: 6, juni: 6, june: 6,
  jul: 7, juli: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  okt: 10, oct: 10, oktober: 10, october: 10,
  nov: 11, november: 11,
  des: 12, dec: 12, desember: 12, december: 12,
};

/** Dato først på linjen: 13.09.2026, 13.09.26, 13/09, 13.09, 13 sep 2026, 13. sep. */
const LEADING_DATE = /^\s*(\d{1,2})[./-](\d{1,2})(?:[./-](\d{2,4}))?\.?\s+|^\s*(\d{1,2})\.?\s+([a-zæøå]{3,9})\.?(?:\s+(\d{4}))?\s+/i;

/** Beløp sist på linjen, med to desimaler: 1 234,50 · 1.234,50 · 1,234.50 · -89,00 · 89,00- · 89,00 CR · 89,00 kr */
const TRAILING_AMOUNT = /(?:^|\s)(-?\s?(?:\d{1,3}(?:[ .  ,]\d{3})+|\d+)[.,]\d{2})\s*(-|cr|kr\.?|nok)?\s*$/i;

/** Valutabeløp og kurs mellom teksten og NOK-beløpet («USD 20,00 10,5000»). */
const TRAILING_FX = /(\s+(?:[A-Z]{3}\s+)?-?\d[\d  .]*[.,]\d{2,})+$/;

/** Linjer som oppsummerer i stedet for å være kjøp. */
const SUMMARY = /(saldo|totalt|total\b|sum\b|å betale|a betale|minste|minimum|kredittgrense|disponibel|tilgjengelig|forrige faktura|innestående|balance|statement|faktura\s*nr|kontonummer|kortnummer)/i;

function toYear(y: string | undefined, fallback: number): number {
  if (!y) return fallback;
  const n = Number(y);
  return n < 100 ? 2000 + n : n;
}

function iso(y: number, m: number, d: number): IsoDate | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCMonth() !== m - 1) return null;
  return date.toISOString().slice(0, 10);
}

/** Første fullstendige dato i dokumentet – brukes til å finne år for datoer uten årstall. */
function statementDate(lines: string[]): { year: number; month: number } | null {
  for (const l of lines) {
    const m = /(\d{1,2})[./-](\d{1,2})[./-](\d{4})/.exec(l);
    if (m && Number(m[2]) >= 1 && Number(m[2]) <= 12) return { year: Number(m[3]), month: Number(m[2]) };
  }
  return null;
}

function amountOf(raw: string, suffix: string | undefined): Minor | null {
  let text = raw.replace(/\s/g, '');
  const negative = text.startsWith('-') || suffix === '-' || /^cr$/i.test(suffix ?? '');
  text = text.replace(/^-/, '');
  const v = parseAmount(text, 'NOK');
  if (v === null) return null;
  return negative ? -Math.abs(v) : Math.abs(v);
}

function findLabeled(lines: string[], label: RegExp, pick: (rest: string) => string | null): string | null {
  for (let i = 0; i < lines.length; i++) {
    if (!label.test(lines[i])) continue;
    const rest = lines[i].replace(label, ' ');
    const v = pick(rest) ?? (lines[i + 1] ? pick(lines[i + 1]) : null);
    if (v) return v;
  }
  return null;
}

export function parseStatementLines(lines: string[], today: IsoDate): PdfStatement {
  const ref = statementDate(lines) ?? { year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) };
  const rows: PdfStatementRow[] = [];

  for (const raw of lines) {
    const line = raw.replace(/\s+/g, ' ').trim();
    const dm = LEADING_DATE.exec(line);
    if (!dm) continue;
    const rest = line.slice(dm[0].length);
    const am = TRAILING_AMOUNT.exec(rest);
    if (!am) continue;
    let description = rest.slice(0, am.index).trim();
    // Fjern en eventuell ekstra dato (bokføringsdato) først i teksten.
    description = description.replace(/^(\d{1,2}[./-]\d{1,2}(?:[./-]\d{2,4})?)\s+/, '').replace(TRAILING_FX, '').trim();
    if (!description || SUMMARY.test(description) || !/[a-zæøå]/i.test(description)) continue;

    let month: number;
    let day: number;
    let year: number;
    if (dm[1]) {
      day = Number(dm[1]);
      month = Number(dm[2]);
      year = toYear(dm[3], ref.year);
    } else {
      day = Number(dm[4]);
      const mn = MONTHS[dm[5].toLowerCase()];
      if (!mn) continue;
      month = mn;
      year = toYear(dm[6], ref.year);
    }
    // Uten årstall: en faktura fra januar kan ha kjøp fra desember året før.
    if (!dm[3] && !dm[6] && month > ref.month) year -= 1;
    const date = iso(year, month, day);
    const amount = amountOf(am[1], am[2]?.toLowerCase());
    if (!date || amount === null || amount === 0) continue;
    rows.push({ date, description: description.slice(0, 140), amount });
  }

  const totalText = findLabeled(lines, /(totalt å betale|beløp å betale|å betale|a betale|fakturabeløp|ny saldo|new balance|amount due)/i, (rest) => {
    const m = /(\d{1,3}(?:[ .  ,]\d{3})*[.,]\d{2})/.exec(rest);
    return m ? m[1] : null;
  });
  const total = totalText ? parseAmount(totalText.replace(/\s/g, ''), 'NOK') : null;

  const dueText = findLabeled(lines, /(forfallsdato|forfall|betalingsfrist|betales innen|due date|payment due)/i, (rest) => {
    const m = /(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/.exec(rest);
    return m ? `${m[1]}.${m[2]}.${m[3]}` : null;
  });
  let dueDate: IsoDate | null = null;
  if (dueText) {
    const [d, m, y] = dueText.split('.');
    dueDate = iso(toYear(y, ref.year), Number(m), Number(d));
  }

  return { rows, total: total && total > 0 ? Math.abs(total) : null, dueDate, lineCount: lines.length };
}

/** Lager CSV-tekst (semikolon) som importsiden kan forhåndsvise som vanlig. */
export function statementToCsv(st: PdfStatement): string {
  const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const fmt = (v: Minor) => `${v < 0 ? '-' : ''}${Math.floor(Math.abs(v) / 100)},${String(Math.abs(v) % 100).padStart(2, '0')}`;
  return ['Dato;Beskrivelse;Beløp', ...st.rows.map((r) => `${r.date};${esc(r.description)};${fmt(r.amount)}`)].join('\n');
}
