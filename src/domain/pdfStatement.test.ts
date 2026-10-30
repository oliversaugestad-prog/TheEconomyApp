import { guessMapping, parseCsv, previewImport } from './csv';
import { parseStatementLines, statementToCsv } from './pdfStatement';

describe('PDF-faktura fra kredittkort', () => {
  const amex = [
    'American Express',
    'Kontoutskrift 25.10.2026',
    'Forrige saldo 21 523,00',
    'Ny saldo 3 742,33',
    'Totalt å betale 3 742,33',
    'Forfallsdato 15.11.2026',
    '12.10.26 BETALING MOTTATT - TAKK 21 779,84 CR',
    '13.10.26 REMA 1000 OSLO 289,40',
    '14.10.26 FLYSAS STOCKHOLM 1 288,00',
    '20.10.26 FLY.IO SAN FRANCISCO USD 10,00 11,1260 111,26',
    'Side 1 av 2',
  ];

  it('finner kjøp, innbetalinger, beløp å betale og forfall', () => {
    const st = parseStatementLines(amex, '2026-10-30');
    expect(st.rows.map((r) => [r.date, r.description, r.amount])).toEqual([
      ['2026-10-12', 'BETALING MOTTATT - TAKK', -2_177_984],
      ['2026-10-13', 'REMA 1000 OSLO', 28_940],
      ['2026-10-14', 'FLYSAS STOCKHOLM', 128_800],
      ['2026-10-20', 'FLY.IO SAN FRANCISCO', 11_126],
    ]);
    expect(st.total).toBe(374_233);
    expect(st.dueDate).toBe('2026-11-15');
  });

  it('forstår datoer uten år og månedsnavn, og hopper over oppsummeringslinjer', () => {
    const sb1 = ['Faktura 05.01.2027', '28.12 KIWI BODØ 145,90', '02.01 Ruter 44,00', '3. jan. Spotify 119,00', 'Sum kjøp 308,90', 'Saldo 308,90'];
    const st = parseStatementLines(sb1, '2027-01-10');
    expect(st.rows.map((r) => [r.date, r.description, r.amount])).toEqual([
      ['2026-12-28', 'KIWI BODØ', 14_590],
      ['2027-01-02', 'Ruter', 4_400],
      ['2027-01-03', 'Spotify', 11_900],
    ]);
  });

  it('gir CSV som importen kan forhåndsvise, med fortegn som kan snus for kortet', () => {
    const csv = statementToCsv(parseStatementLines(amex, '2026-10-30'));
    const { rows } = parseCsv(csv);
    const mapping = guessMapping(rows);
    const preview = previewImport(rows, { ...mapping, invert: true }, 'amex', 'NOK', []);
    expect(preview.every((r) => !r.error)).toBe(true);
    expect(preview.map((r) => r.amount)).toEqual([2_177_984, -28_940, -128_800, -11_126]);
  });
});
