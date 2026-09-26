import type { ExchangeRate } from './types';

/**
 * Tolker valutakurser fra Norges Bank (SDMX-JSON, datasett EXR).
 * Kursene oppgis som NOK per enhet – for noen valutaer per 100 enheter
 * (UNIT_MULT = 2), f.eks. SEK og DKK. Resultatet er alltid NOK per 1 enhet.
 */

interface SdmxValue {
  id: string;
  name?: string;
}

interface SdmxJson {
  data?: {
    dataSets?: { series?: Record<string, { attributes?: number[]; observations?: Record<string, string[]> }> }[];
    structure?: {
      dimensions?: { series?: { id: string; values: SdmxValue[] }[]; observation?: { id: string; values: SdmxValue[] }[] };
      attributes?: { series?: { id: string; values: SdmxValue[] }[] };
    };
  };
}

export const NORGES_BANK_SOURCE = 'Norges Bank (offisiell midtkurs)';

export function parseNorgesBankRates(json: SdmxJson): ExchangeRate[] {
  const structure = json.data?.structure;
  const seriesDims = structure?.dimensions?.series ?? [];
  const obsValues = structure?.dimensions?.observation?.[0]?.values ?? [];
  const attrDefs = structure?.attributes?.series ?? [];
  const baseIdx = seriesDims.findIndex((d) => d.id === 'BASE_CUR');
  const quoteIdx = seriesDims.findIndex((d) => d.id === 'QUOTE_CUR');
  const multIdx = attrDefs.findIndex((a) => a.id === 'UNIT_MULT');
  const series = json.data?.dataSets?.[0]?.series ?? {};
  const out: ExchangeRate[] = [];

  for (const [key, s] of Object.entries(series)) {
    const parts = key.split(':').map(Number);
    const currency = seriesDims[baseIdx]?.values[parts[baseIdx]]?.id;
    const base = seriesDims[quoteIdx]?.values[parts[quoteIdx]]?.id;
    if (!currency || !base) continue;
    const multAttr = multIdx >= 0 ? s.attributes?.[multIdx] : undefined;
    const mult = multAttr !== undefined && multAttr !== null ? Number(attrDefs[multIdx].values[multAttr]?.id ?? 0) : 0;
    // Siste observasjon (høyeste indeks).
    const obsKeys = Object.keys(s.observations ?? {}).map(Number).sort((a, b) => b - a);
    const k = obsKeys[0];
    if (k === undefined) continue;
    const raw = Number(s.observations![String(k)]?.[0]);
    if (!Number.isFinite(raw) || raw <= 0) continue;
    const date = obsValues[k]?.id;
    out.push({
      currency,
      base,
      rate: raw / 10 ** mult,
      asOf: date ? `${date}T12:15:00.000Z` : new Date().toISOString(),
      source: NORGES_BANK_SOURCE,
    });
  }
  return out;
}
