import { guessMapping, parseCsv, parseDate, positiveShare, previewImport } from './csv';
import { tx } from '../test/factories';

const sample = `Dato;Beskrivelse;Beløp inn;Beløp ut
24.09.2026;"KIWI 123 Oslo";;312,40
24.09.2026;"KIWI 123 Oslo";;312,40
25.09.2026;Lønn Nordvik;48 500,00;
31.02.2026;Feil dato;;10,00`;

describe('CSV-import', () => {
  it('tolker skilletegn, anførselstegn og overskrifter', () => {
    const { delimiter, rows } = parseCsv(sample);
    expect(delimiter).toBe(';');
    expect(rows[1]).toEqual(['24.09.2026', 'KIWI 123 Oslo', '', '312,40']);
    const m = guessMapping(rows);
    expect(m).toMatchObject({ hasHeader: true, date: 0, description: 1, inAmount: 2, outAmount: 3, amount: null });
  });

  it('håndterer anførselstegn med komma og linjeskift', () => {
    const { rows } = parseCsv('a,b\n"x, y","linje\nto"\n');
    expect(rows[1]).toEqual(['x, y', 'linje\nto']);
  });

  it('tolker datoformater', () => {
    expect(parseDate('24.09.2026')).toBe('2026-09-24');
    expect(parseDate('2026-09-24')).toBe('2026-09-24');
    expect(parseDate('24/09/26')).toBe('2026-09-24');
    expect(parseDate('31.02.2026')).toBeNull();
  });

  it('forhåndsviser med feil og duplikatkontroll', () => {
    const { rows } = parseCsv(sample);
    const m = guessMapping(rows);
    const preview = previewImport(rows, m, 'acc', 'NOK', []);
    expect(preview.map((r) => r.amount)).toEqual([-31240, -31240, 4850000, -1000]);
    // To like kjøp samme dag i samme fil er ikke duplikater av hverandre
    expect(preview.filter((r) => r.duplicate)).toHaveLength(0);
    expect(preview[3].error).toMatch(/Ugyldig dato/);
  });

  it('gjentatt import av samme fil gir bare duplikater', () => {
    const { rows } = parseCsv(sample);
    const m = guessMapping(rows);
    const first = previewImport(rows, m, 'acc', 'NOK', []);
    const imported = first
      .filter((r) => !r.error)
      .map((r) => tx({ accountId: 'acc', amount: r.amount!, bookingDate: r.date!, counterparty: r.description, importFingerprint: r.fingerprint! }));
    const second = previewImport(rows, m, 'acc', 'NOK', imported);
    expect(second.filter((r) => !r.error).every((r) => r.duplicate)).toBe(true);
  });

  it('oppdager overlapp med eksisterende transaksjoner fra banken', () => {
    const existing = [tx({ accountId: 'acc', amount: -31240, bookingDate: '2026-09-24', counterparty: 'KIWI 123 Oslo' })];
    const { rows } = parseCsv(sample);
    const preview = previewImport(rows, guessMapping(rows), 'acc', 'NOK', existing);
    // Én finnes fra før → første rad er duplikat, andre like rad er ny
    expect(preview.slice(0, 2).map((r) => r.duplicate)).toEqual([true, false]);
  });
});

describe('Amex-eksport', () => {
  const amex = `Dato,Beskrivelse,Kortmedlem,Konto #,Beløp,Utvidede detaljer
09/24/2026,"SPOTIFY P471779FF7 STOCKHOLM",OLIVER,-71005,109.00,"Spotify"
09/13/2026,"REMA 1000 OSLO",OLIVER,-71005,"1,234.50",""
09/02/2026,"BETALING MOTTATT - TAKK",OLIVER,-71005,-2500.00,""`;

  it('gjenkjenner amerikansk datoformat og beløpskolonnen', () => {
    const { rows } = parseCsv(amex);
    const m = guessMapping(rows);
    expect(m).toMatchObject({ hasHeader: true, date: 0, description: 1, amount: 4, dateOrder: 'mdy' });
  });

  it('snur fortegn slik at kjøp blir utgifter og innbetalingen blir positiv', () => {
    const { rows } = parseCsv(amex);
    const m = guessMapping(rows);
    const raw = previewImport(rows, m, 'amex', 'NOK', []);
    expect(positiveShare(raw)).toBeGreaterThan(0.5);
    const rows2 = previewImport(rows, { ...m, invert: true }, 'amex', 'NOK', []);
    expect(rows2.map((r) => [r.date, r.amount])).toEqual([
      ['2026-09-24', -10900],
      ['2026-09-13', -123450],
      ['2026-09-02', 250000],
    ]);
    expect(rows2.every((r) => !r.error)).toBe(true);
  });
});
