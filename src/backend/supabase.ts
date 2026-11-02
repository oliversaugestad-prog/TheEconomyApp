import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { currentAppUrl, SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from '../config';

let client: SupabaseClient | null = null;

export function supabase(): SupabaseClient {
  if (!client) {
    client = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: {
        // PKCE: innloggingslenken kommer tilbake med ?code=, som ikke kolliderer med hash-rutingen.
        flowType: 'pkce',
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
  }
  return client;
}

export async function sendLoginLink(email: string): Promise<void> {
  const { error } = await supabase().auth.signInWithOtp({
    email,
    options: { emailRedirectTo: currentAppUrl(), shouldCreateUser: true },
  });
  if (error) throw new Error(loginErrorText(error.message));
}

/** Markør i lenken fra «Glemt passord», slik at appen åpner passordfeltet etter innlogging. */
export const PASSWORD_RESET_FLAG = 'passord=ny';

export async function signInWithPassword(email: string, password: string): Promise<void> {
  const { error } = await supabase().auth.signInWithPassword({ email, password });
  if (error) {
    if (/invalid login credentials/i.test(error.message)) {
      throw new Error('Feil e-post eller passord. Har du ikke satt passord ennå, logg inn med lenke først og sett det under Innstillinger.');
    }
    if (/email not confirmed/i.test(error.message)) throw new Error('E-postadressen er ikke bekreftet ennå. Logg inn med lenke først.');
    throw new Error(loginErrorText(error.message));
  }
}

export async function sendPasswordReset(email: string): Promise<void> {
  const url = currentAppUrl();
  const { error } = await supabase().auth.resetPasswordForEmail(email, {
    redirectTo: `${url}${url.includes('?') ? '&' : '?'}${PASSWORD_RESET_FLAG}`,
  });
  if (error) throw new Error(loginErrorText(error.message));
}

export async function updatePassword(password: string): Promise<void> {
  const { error } = await supabase().auth.updateUser({ password });
  if (!error) return;
  if (/same.*password|different from the old/i.test(error.message)) throw new Error('Det nye passordet må være forskjellig fra det gamle.');
  if (/weak|short|at least/i.test(error.message)) throw new Error('Passordet er for svakt. Bruk minst 8 tegn, gjerne en lengre setning.');
  if (/reauthenticat|nonce/i.test(error.message)) {
    throw new Error('Supabase krever ny bekreftelse for å bytte passord. Logg ut, logg inn med lenke og prøv igjen.');
  }
  throw new Error(`Kunne ikke lagre passordet: ${error.message}`);
}

function loginErrorText(msg: string): string {
  if (/rate limit|too many/i.test(msg)) return 'For mange forsøk. Vent litt og prøv igjen.';
  if (/invalid/i.test(msg)) return 'E-postadressen ser ikke gyldig ut.';
  return `Innloggingen feilet: ${msg}`;
}

export async function signOut(): Promise<void> {
  await supabase().auth.signOut();
}

export class BankApiError extends Error {
  constructor(
    message: string,
    public code: string,
  ) {
    super(message);
  }
}

/** Kaller serverfunksjonen for banktilkobling. Feil kommer som lesbar norsk tekst. */
export async function callBank<T>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase().functions.invoke('bank', { body: { action, ...payload } });
  if (error) {
    let message = 'Kunne ikke nå serveren. Sjekk nettforbindelsen.';
    let code = 'network';
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === 'function') {
      try {
        const body = await ctx.json();
        if (body?.error) message = body.error;
        if (body?.code) code = body.code;
      } catch {
        /* behold standardtekst */
      }
    }
    throw new BankApiError(message, code);
  }
  return data as T;
}

/* ---------------------------- serverens svar ---------------------------- */

export interface BankSessionInfo {
  id: string;
  aspspName: string;
  aspspCountry: string;
  validUntil: string | null;
  status: 'active' | 'expired' | 'revoked';
  lastSyncAt: string | null;
  lastError: string | null;
  accountCount: number;
}

export interface BankStatus {
  allowed: boolean;
  keyConfigured: boolean;
  appId: string | null;
  redirectUrl: string;
  sessions: BankSessionInfo[];
}

export interface AspspInfo {
  name: string;
  country: string;
  logo: string | null;
  maxConsentSeconds: number | null;
}
