/**
 * Offentlig konfigurasjon for Saldo-backenden (Supabase).
 *
 * Den publiserbare nøkkelen er laget for å ligge i nettleseren. Tilgangen styres av
 * innlogging og radnivåsikkerhet i databasen. Hemmeligheter (Enable Banking-nøkkel,
 * service-nøkkel) ligger bare på serveren.
 */
export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL ?? 'https://yxkzcnduisekbugqvgwk.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? 'sb_publishable_2oEEwL-uvpUkPeH_jVpnCw_9iTYBKnW';

/** Adressen appen publiseres på (brukes for innloggingslenker på e-post). */
export const APP_URL = import.meta.env.VITE_APP_URL ?? 'https://oliversaugestad-prog.github.io/TheEconomyApp/';

/** Adressen Enable Banking skal sende brukeren tilbake til etter BankID. */
export const BANK_CALLBACK_URL = `${SUPABASE_URL}/functions/v1/bank`;

export const backendConfigured = Boolean(SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY);
