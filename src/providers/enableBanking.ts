import type { BankDataProvider } from './types';

/**
 * Plassholder for en ekte bankintegrasjon via en PSD2-kontoinformasjonstilbyder
 * (AISP), f.eks. Enable Banking. Implementasjonen er bevisst ikke aktivert:
 *
 * - Hemmeligheter (privat nøkkel / API-nøkkel) og tilgangstokener må ligge i en
 *   serverkomponent – aldri i nettleseren.
 * - Tilbyderen krever registrert applikasjon og avtale for produksjonstilgang.
 * - Brukeren autentiserer seg hos sin egen bank (BankID) via tilbyderens
 *   godkjente omdirigeringsflyt. Saldo ber aldri om bankpassord.
 *
 * Se docs/BANKINTEGRASJON.md for hva som kreves.
 */
export const enableBankingProvider: BankDataProvider = {
  id: 'enablebanking',
  name: 'Ekte banktilkobling (PSD2)',
  isDemo: false,
  availability: () => ({
    available: false,
    reason: 'Ekte banktilkobling er ikke satt opp i denne versjonen.',
    requirements: [
      'En serverkomponent som holder API-nøkler og tilgangstokener utenfor nettleseren.',
      'Registrert applikasjon og avtale med en lisensiert kontoinformasjonstilbyder (AISP), f.eks. Enable Banking.',
      'Innlogging og tilgangskontroll slik at hver bruker bare ser egne data.',
      'Kryptert lagring av økonomidata på serveren.',
    ],
  }),
  async sync(connection) {
    return {
      ok: false,
      connection: { ...connection, status: 'error', error: 'Ekte banktilkobling er ikke konfigurert.' },
      reason: 'temporary',
      message: 'Ekte banktilkobling er ikke konfigurert.',
    };
  },
};
