import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { APP_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from '../config';

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
    options: { emailRedirectTo: APP_URL, shouldCreateUser: true },
  });
  if (error) throw new Error(loginErrorText(error.message));
}

function loginErrorText(msg: string): string {
  if (/rate limit/i.test(msg)) return 'For mange forsøk. Vent litt før du ber om en ny lenke.';
  if (/invalid/i.test(msg)) return 'E-postadressen ser ikke gyldig ut.';
  return `Kunne ikke sende innloggingslenke: ${msg}`;
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
