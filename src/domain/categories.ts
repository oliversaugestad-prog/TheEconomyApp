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
  [/(lønn|lonn|løn|lønoverførsel|lønnsoverføring|dedicare)/, 'lonn'],
  [/\b(rema|kiwi|coop|coop365|extra|meny|spar|joker|bunnpris|oda|lidl|netto|føtex|fotex|foetex|bilka|ica|irma|fakta|aldi|7 eleven|7-eleven|narvesen|matkroken|dagligvare|dagligvarer|superbrugsen|lovbjerg|løvbjerg)\b/, 'dagligvarer'],
  [/\b(ruter|ruterappen|vy|atb|skyss|kolumbus|entur|flytoget|flybussen|rejsekort|dsb|circle k|uno x|esso|shell|bolt|uber|ryde|voi|tier|lime|easypark|apcoa|parkering|parking|sas|norwegian|widerøe|wideroe|fylkeskomm)\b/, 'transport'],
  [/(netflix|spotify|hbo|viaplay|disney|icloud|storytel|audible|youtube|tidal|aftenposten|adobe|puregym|eesy|anthropic|openai|plan fee|domene)|\b(max|apple(?! pay)|google(?! pay))\b/, 'abonnementer'],
  [/\b(husleie|eiendom|fjordkraft|tibber|elvia|strøm|borettslag|fellesutgifter)\b/, 'bolig'],
  [/\b(apotek|apotek 1|vitus|legevakt|lege|tannlege|boots|matas)\b/, 'helse'],
  [/(ticketmaster|nordisk film|billettservice|checkin|kino)|\b(steam|playstation|boulders|klatring|svømmehall|symjebasseng|museum|fotballfesten)\b/, 'underholdning'],
  [/\b(zalando|elkjøp|power|xxl|h m|hm|clas ohlson|ikea|komplett|jernia|normal|jysk|bog ide|sport|skofabrikk|packyard)\b/, 'shopping'],
  [/(restaurant|espresso house|joe the juice|joe  the juice|taphouse|burger king|mcdonald|foodora|wolt|just eat|starbucks|proud mary|take and eat|hmshost|oelbar|ølbar|tacos)|\b(restaurante|cafe|kafe|kafé|café|bakeri|bageri|bar|pub|bistro|pizza|sushi|burger|kebab|coffee|kaffe|peppes|kro|kroen|food|bk)\b/, 'restaurant'],
  [/\b(sats|evo|elixia|telenor|telia|ice)\b/, 'abonnementer'],
];

/**
 * Kategori ut fra betalingskortets bransjekode (MCC), når banken oppgir den.
 * Brukes bare når søkeordene ikke gir treff.
 */
export function categoryFromMcc(mcc: string | null | undefined): CategoryId | null {
  const n = Number(mcc);
  if (!mcc || !Number.isInteger(n)) return null;
  if ([5411, 5422, 5441, 5451, 5462, 5499].includes(n)) return 'dagligvarer';
  if (n >= 5811 && n <= 5814) return 'restaurant';
  if ((n >= 3000 && n <= 3299) || [4111, 4112, 4121, 4131, 4411, 4511, 4582, 4784, 4789, 5172, 5541, 5542, 7512, 7523].includes(n)) return 'transport';
  if ([5122, 5912, 5975, 5976, 8011, 8021, 8031, 8041, 8042, 8043, 8049, 8050, 8062, 8071, 8099].includes(n)) return 'helse';
  if ([4814, 4899, 5815, 5816, 5817, 5818, 5968].includes(n)) return 'abonnementer';
  if ([7832, 7841, 7911, 7922, 7929, 7932, 7933, 7941, 7991, 7992, 7993, 7994, 7996, 7997, 7998, 7999].includes(n)) return 'underholdning';
  if ([4900, 6513].includes(n)) return 'bolig';
  if (n >= 5200 && n <= 5999) return 'shopping';
  return null;
}

export function guessCategory(counterparty: string, description: string, amount: number, mcc?: string | null): CategoryId {
  // Både normalisert navn (uten kortnummer o.l.) og full tekst (f.eks. «TM *TICKETMASTER»).
  const text = `${normalizeCounterparty(counterparty)} ${cleanCounterparty(counterparty).toLowerCase()} ${description.toLowerCase().replace(/\d{3,}/g, ' ')}`;
  for (const [re, cat] of KEYWORDS) {
    if (re.test(text)) {
      if (cat === 'lonn' && amount < 0) continue;
      return cat;
    }
  }
  if (amount < 0) {
    const fromMcc = categoryFromMcc(mcc);
    if (fromMcc) return fromMcc;
  }
  return amount > 0 ? 'annen_inntekt' : 'annet';
}
