/**
 * Offentlig konfigurasjon for Saldo-backenden (Supabase).
 *
 * Den publiserbare nøkkelen er laget for å ligge i nettleseren. Tilgangen styres av
 * innlogging og radnivåsikkerhet i databasen. Hemmeligheter (Enable Banking-nøkkel,
 * service-nøkkel) ligger bare på serveren.
 */
export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL ?? 'https://yxkzcnduisekbugqvgwk.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? 'sb_publishable_2oEEwL-uvpUkPeH_jVpnCw_9iTYBKnW';

/** Hovedadressen appen publiseres på. */
export const APP_URL = import.meta.env.VITE_APP_URL ?? 'https://oliversaugestad-prog.github.io/TheEconomyApp/';

/** Adresser innloggingslenker kan sendes tilbake til. */
const KNOWN_ORIGINS = ['https://savest.no', 'https://www.savest.no', 'https://oliversaugestad-prog.github.io', 'http://localhost:5173', 'http://localhost:4173'];

/** Adressen brukeren faktisk har åpnet appen på, så innloggingslenken kommer tilbake dit. */
export function currentAppUrl(): string {
  if (typeof window === 'undefined' || !KNOWN_ORIGINS.includes(window.location.origin)) return APP_URL;
  return `${window.location.origin}${window.location.pathname}`;
}

/** Adressen Enable Banking skal sende brukeren tilbake til etter BankID. */
export const BANK_CALLBACK_URL = `${SUPABASE_URL}/functions/v1/bank`;

export const backendConfigured = Boolean(SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY);
