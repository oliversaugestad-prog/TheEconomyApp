import { parseNorgesBankRates } from './norgesBank';

// Forkortet utdrag med samme struktur som svaret fra data.norges-bank.no (EXR).
const sample = {
  data: {
    dataSets: [
      {
        series: {
          '0:0:0:0': { attributes: [0, 0, 0, 0], observations: { '0': ['145.01'] } },
          '0:1:0:0': { attributes: [1, 0, 1, 0], observations: { '0': ['12.5981'] } },
          '0:2:0:0': { attributes: [0, 0, 0, 0], observations: { '0': ['96.01'] } },
        },
      },
    ],
    structure: {
      dimensions: {
        series: [
          { id: 'FREQ', values: [{ id: 'B' }] },
          { id: 'BASE_CUR', values: [{ id: 'DKK' }, { id: 'EUR' }, { id: 'SEK' }] },
          { id: 'QUOTE_CUR', values: [{ id: 'NOK' }] },
          { id: 'TENOR', values: [{ id: 'SP' }] },
        ],
        observation: [{ id: 'TIME_PERIOD', values: [{ id: '2026-09-25' }] }],
      },
      attributes: {
        series: [
          { id: 'DECIMALS', values: [{ id: '2' }, { id: '4' }] },
          { id: 'CALCULATED', values: [{ id: 'false' }] },
          { id: 'UNIT_MULT', values: [{ id: '2' }, { id: '0' }] },
          { id: 'COLLECTION', values: [{ id: 'C' }] },
        ],
      },
    },
  },
};

describe('Norges Bank-kurser', () => {
  it('regner om kurser oppgitt per 100 enheter', () => {
    const rates = parseNorgesBankRates(sample);
    const by = Object.fromEntries(rates.map((r) => [r.currency, r]));
    expect(by.DKK.rate).toBeCloseTo(1.4501, 6);
    expect(by.SEK.rate).toBeCloseTo(0.9601, 6);
    expect(by.EUR.rate).toBeCloseTo(12.5981, 6);
    expect(by.EUR).toMatchObject({ base: 'NOK', asOf: '2026-09-25T12:15:00.000Z' });
  });

  it('tåler tomt eller ukjent svar', () => {
    expect(parseNorgesBankRates({})).toEqual([]);
  });
});
