import type { CategoryId } from './types';

export interface CategoryInfo {
  id: CategoryId;
  label: string;
  /** Farge for diagrammer (validert kategorisk palett for mørk bakgrunn). */
  color: string;
  type: 'expense' | 'income';
}

/**
 * Rekkefølgen her er fast og styrer fargene – en kategori beholder alltid samme
 * farge uansett filter. Paletten er validert for fargeblindhet mot mørk flate.
 */
export const CATEGORIES: CategoryInfo[] = [
  { id: 'bolig', label: 'Bolig', color: '#3987e5', type: 'expense' },
  { id: 'dagligvarer', label: 'Dagligvarer', color: '#d95926', type: 'expense' },
  { id: 'transport', label: 'Transport', color: '#199e70', type: 'expense' },
  { id: 'shopping', label: 'Shopping', color: '#c98500', type: 'expense' },
  { id: 'helse', label: 'Helse', color: '#d55181', type: 'expense' },
  { id: 'underholdning', label: 'Underholdning', color: '#008300', type: 'expense' },
  { id: 'abonnementer', label: 'Abonnementer', color: '#9085e9', type: 'expense' },
  { id: 'restaurant', label: 'Mat ute', color: '#e66767', type: 'expense' },
  { id: 'annet', label: 'Annet', color: '#6b7280', type: 'expense' },
  { id: 'lonn', label: 'Lønn', color: '#3987e5', type: 'income' },
  { id: 'annen_inntekt', label: 'Annen inntekt', color: '#199e70', type: 'income' },
];

export const CATEGORY_BY_ID: Record<CategoryId, CategoryInfo> = Object.fromEntries(
  CATEGORIES.map((c) => [c.id, c]),
) as Record<CategoryId, CategoryInfo>;

export function categoryLabel(id: CategoryId): string {
  return CATEGORY_BY_ID[id]?.label ?? 'Annet';
}

/** Normaliserer mottakernavn til en nøkkel for regler og abonnementsgjenkjenning. */
/** Betalingsformidlere som står foran det egentlige navnet, f.eks. «Vipps*Storytel». */
const PROCESSOR_PREFIX = /^\s*(vipps|mobilepay|paypal|sumup|sq|iz|zettle|klarna|stripe|google pay|apple pay)\s*[*:]+\s*/i;
/** Bankenes egne tekster foran mottakeren (bl.a. danske banker). */
const BANK_TEXT_PREFIX = /^\s*(udbetaling|varekøb|varekjøp|dankort-køb|visa-køb|kortkjøp|nota)\s+/i;

/** Fjerner bankens og betalingsformidlerens prefiks, men beholder mottakeren. */
export function cleanCounterparty(name: string): string {
  return name.replace(BANK_TEXT_PREFIX, '').replace(PROCESSOR_PREFIX, '').replace(/\s+/g, ' ').trim();
}

/** Normaliserer mottakernavn til en nøkkel for regler og abonnementsgjenkjenning. */
export function normalizeCounterparty(name: string): string {
  return cleanCounterparty(name)
    .toLowerCase()
    .replace(/\*.*$/, '') // «NETFLIX.COM*1234» → «netflix.com»
    .replace(/\b(as|asa|ab|aps|a s|ltd|inc|no|com|dk|www)\b/g, ' ')
    .replace(/\d{3,}/g, ' ')
    .replace(/[^a-zæøå0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Enkle søkeord for automatisk kategorisering. Brukerens regler går foran. */
const KEYWORDS: Array<[RegExp, CategoryId]> = [
  [/\b(rema|kiwi|coop|extra|meny|spar|joker|bunnpris|oda|lidl|netto|føtex|fotex|bilka|ica|irma|fakta|aldi|7 eleven|7-eleven|narvesen|matkroken)\b/, 'dagligvarer'],
  [/\b(ruter|ruterappen|vy|atb|skyss|kolumbus|entur|flytoget|flybussen|rejsekort|dsb|circle k|uno x|esso|shell|bolt|uber|ryde|voi|tier|lime|easypark|sas|norwegian|fylkeskomm)\b/, 'transport'],
  [/\b(netflix|spotify|hbo|max|viaplay|disney|icloud|apple|google|storytel|audible|youtube|tidal|aftenposten|adobe|puregym|eesy|anthropic|openai|plan fee)\b/, 'abonnementer'],
  [/\b(husleie|eiendom|fjordkraft|tibber|elvia|strøm|borettslag|fellesutgifter)\b/, 'bolig'],
  [/\b(apotek|apotek 1|vitus|legevakt|lege|tannlege|boots|matas)\b/, 'helse'],
  [/\b(kino|nordisk film|ticketmaster|billettservice|steam|playstation)\b/, 'underholdning'],
  [/\b(zalando|elkjøp|power|xxl|h m|hm|clas ohlson|ikea|komplett|jernia|normal)\b/, 'shopping'],
  [/\b(restaurant|restaurante|cafe|kafe|kafé|café|bakeri|bageri|bar|pub|bistro|pizza|sushi|burger|kebab|espresso house|coffee|kaffe|peppes|mcdonald|burger king|foodora|wolt|just eat|starbucks|proud mary)\b/, 'restaurant'],
  [/\b(sats|evo|elixia|telenor|telia|ice)\b/, 'abonnementer'],
  [/\b(lønn|lonn|løn)\b/, 'lonn'],
];

export function guessCategory(counterparty: string, description: string, amount: number): CategoryId {
  const text = `${normalizeCounterparty(counterparty)} ${description.toLowerCase()}`;
  for (const [re, cat] of KEYWORDS) {
    if (re.test(text)) {
      if (cat === 'lonn' && amount < 0) continue;
      return cat;
    }
  }
  return amount > 0 ? 'annen_inntekt' : 'annet';
}
