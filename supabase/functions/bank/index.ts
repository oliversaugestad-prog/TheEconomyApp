// Saldo – serverfunksjon for Enable Banking (PSD2 kontoinformasjon).
//
// - POST (med Supabase-innlogging): status, rates, quote-search, quotes, set-key, aspsps, start-auth, sync, disconnect
// - GET  (fra banken etter BankID): tar imot ?code&state, oppretter samtykke og sender
//   brukeren tilbake til Saldo.
//
// Privat nøkkel ligger kryptert i Supabase Vault og forlater aldri serveren. Sesjons-ID-er
// fra Enable Banking lagres bare her. Ingen beløp eller kontodata skrives til loggen.

import { createClient } from 'npm:@supabase/supabase-js@2';

const EB_API = 'https://api.enablebanking.com';
const DEFAULT_APP_URL = 'https://oliversaugestad-prog.github.io/TheEconomyApp/';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CALLBACK_URL = `${SUPABASE_URL}/functions/v1/bank`;
const MAX_CONSENT_SECONDS = 180 * 86_400;
const ALLOWED_ORIGINS = [new URL(DEFAULT_APP_URL).origin, 'http://localhost:5173', 'http://localhost:4173'];

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

/* ------------------------------------------------------------------ */
/* Hjelpere                                                            */
/* ------------------------------------------------------------------ */

class HttpError extends Error {
  constructor(public status: number, message: string, public code = 'error') {
    super(message);
  }
}

class EbError extends Error {
  constructor(public status: number, public body: unknown) {
    super(`Enable Banking svarte ${status}`);
  }
}

function cors(req: Request): Record<string, string> {
  const origin = req.headers.get('origin') ?? '';
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    Vary: 'Origin',
  };
}

function json(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors(req), 'Content-Type': 'application/json' } });
}

function b64url(data: ArrayBuffer | Uint8Array | string): string {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function importKey(pem: string): Promise<CryptoKey> {
  if (/BEGIN RSA PRIVATE KEY/.test(pem)) {
    throw new HttpError(400, 'Nøkkelen er i PKCS#1-format. Bruk .pem-filen Enable Banking lastet ned (PKCS#8).', 'bad_key');
  }
  const body = pem.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, '').replace(/\s+/g, '');
  if (!body) throw new HttpError(400, 'Filen inneholder ingen privat nøkkel.', 'bad_key');
  let der: Uint8Array;
  try {
    der = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  } catch {
    throw new HttpError(400, 'Kunne ikke lese nøkkelfilen.', 'bad_key');
  }
  try {
    return await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  } catch {
    throw new HttpError(400, 'Kunne ikke lese nøkkelfilen som en RSA-nøkkel.', 'bad_key');
  }
}

async function makeJwt(pem: string, appId: string): Promise<string> {
  const key = await importKey(pem);
  const iat = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ typ: 'JWT', alg: 'RS256', kid: appId }));
  const payload = b64url(JSON.stringify({ iss: 'enablebanking.com', aud: 'api.enablebanking.com', iat, exp: iat + 3600 }));
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${header}.${payload}`));
  return `${header}.${payload}.${b64url(sig)}`;
}

let cachedJwt: { token: string; exp: number } | null = null;

async function ebToken(): Promise<string> {
  if (cachedJwt && cachedJwt.exp > Date.now() + 60_000) return cachedJwt.token;
  const { data, error } = await admin.rpc('eb_get_key');
  if (error) throw new HttpError(500, 'Kunne ikke hente nøkkelen fra hvelvet.');
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.pem || !row?.app_id) throw new HttpError(409, 'Nøkkelfilen fra Enable Banking er ikke lastet opp ennå.', 'no_key');
  const token = await makeJwt(row.pem, row.app_id);
  cachedJwt = { token, exp: Date.now() + 3_500_000 };
  return token;
}

interface PsuContext {
  ip?: string;
  userAgent?: string;
}

async function eb<T>(path: string, init: RequestInit = {}, psu?: PsuContext, token?: string): Promise<T> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token ?? (await ebToken())}`,
    'Content-Type': 'application/json',
  };
  // Brukeren er til stede (trykket selv på «Oppdater»): da gjelder ikke bankenes grense for bakgrunnshenting.
  if (psu?.ip) headers['Psu-Ip-Address'] = psu.ip;
  if (psu?.userAgent) headers['Psu-User-Agent'] = psu.userAgent;
  const res = await fetch(`${EB_API}${path}`, { ...init, headers: { ...headers, ...(init.headers as Record<string, string>) } });
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) throw new EbError(res.status, body);
  return body as T;
}

function ebMessage(e: EbError): string {
  const b = e.body as { message?: string; detail?: unknown; error?: string } | null;
  const detail = b?.message ?? b?.error ?? (typeof b?.detail === 'string' ? b.detail : null);
  return detail ? `Enable Banking: ${detail}` : `Enable Banking svarte med feil ${e.status}.`;
}

async function appUrl(): Promise<string> {
  const { data } = await admin.from('app_config').select('value').eq('key', 'app_url').maybeSingle();
  return data?.value ?? DEFAULT_APP_URL;
}

function publicSession(s: Record<string, unknown>) {
  return {
    id: s.id,
    aspspName: s.aspsp_name,
    aspspCountry: s.aspsp_country,
    validUntil: s.valid_until,
    status: s.status,
    lastSyncAt: s.last_sync_at,
    lastError: s.last_error,
    accountCount: Array.isArray(s.accounts) ? s.accounts.length : 0,
  };
}

/* ------------------------------------------------------------------ */
/* Tilbakekall fra banken (GET)                                        */
/* ------------------------------------------------------------------ */

async function handleCallback(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const state = url.searchParams.get('state');
  const code = url.searchParams.get('code');
  const bankError = url.searchParams.get('error');
  const back = await appUrl();
  const redirect = (params: Record<string, string>) =>
    new Response(null, { status: 302, headers: { Location: `${back}#/kontoer?${new URLSearchParams(params)}` } });

  if (!state || !/^[0-9a-f-]{36}$/i.test(state)) return redirect({ bank: 'feil', melding: 'Ugyldig svar fra banken.' });
  const { data: st } = await admin.from('eb_auth_states').select('*').eq('state', state).maybeSingle();
  if (st) await admin.from('eb_auth_states').delete().eq('state', state);
  if (!st || Date.now() - new Date(st.created_at).getTime() > 3_600_000) {
    return redirect({ bank: 'feil', melding: 'Innloggingen tok for lang tid eller er allerede brukt. Prøv igjen.' });
  }
  if (bankError || !code) {
    return redirect({ bank: 'feil', melding: url.searchParams.get('error_description') ?? 'Tilkoblingen ble avbrutt.' });
  }
  try {
    const session = await eb<{
      session_id: string;
      accounts: unknown[];
      access?: { valid_until?: string };
    }>('/sessions', { method: 'POST', body: JSON.stringify({ code }) });
    const accounts = (session.accounts ?? []).map((a) => (typeof a === 'string' ? { uid: a } : a));
    const { error } = await admin.from('eb_sessions').insert({
      user_id: st.user_id,
      session_id: session.session_id,
      aspsp_name: st.aspsp_name,
      aspsp_country: st.aspsp_country,
      valid_until: session.access?.valid_until ?? null,
      accounts,
    });
    if (error) throw new Error('db');
    return redirect({ bank: 'ok', navn: st.aspsp_name });
  } catch (e) {
    const msg = e instanceof EbError ? ebMessage(e) : 'Kunne ikke fullføre tilkoblingen.';
    console.error('callback feilet', e instanceof EbError ? e.status : 'intern');
    return redirect({ bank: 'feil', melding: msg });
  }
}

/* ------------------------------------------------------------------ */
/* Handlinger fra appen (POST)                                         */
/* ------------------------------------------------------------------ */

async function requireUser(req: Request) {
  const auth = req.headers.get('authorization') ?? '';
  const jwt = auth.replace(/^Bearer\s+/i, '');
  if (!jwt) throw new HttpError(401, 'Du må være logget inn.', 'unauthenticated');
  const { data, error } = await admin.auth.getUser(jwt);
  if (error || !data.user) throw new HttpError(401, 'Innloggingen er utløpt. Logg inn på nytt.', 'unauthenticated');
  const email = data.user.email?.toLowerCase() ?? '';
  const { data: allowed } = await admin.from('allowed_users').select('email').eq('email', email).maybeSingle();
  return { user: data.user, allowed: !!allowed };
}

async function handleAction(req: Request): Promise<Response> {
  const { user, allowed } = await requireUser(req);
  const body = await req.json().catch(() => ({}));
  const action = body?.action as string;
  const psu: PsuContext = {
    ip: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim(),
    userAgent: req.headers.get('user-agent') ?? undefined,
  };

  if (action === 'status') {
    const { data: cfg } = await admin.from('app_config').select('value').eq('key', 'eb_app_id').maybeSingle();
    const { data: sessions } = allowed
      ? await admin.from('eb_sessions').select('*').eq('user_id', user.id).neq('status', 'revoked').order('created_at')
      : { data: [] };
    return json(req, {
      allowed,
      keyConfigured: !!cfg?.value,
      appId: cfg?.value ?? null,
      redirectUrl: CALLBACK_URL,
      sessions: (sessions ?? []).map(publicSession),
    });
  }

  if (action === 'rates') {
    // Offisielle valutakurser fra Norges Bank (offentlige data). Tolkes i appen.
    const res = await fetch(
      'https://data.norges-bank.no/api/data/EXR/B.EUR+SEK+DKK+USD+GBP+CHF.NOK.SP?lastNObservations=1&format=sdmx-json&locale=en',
    );
    if (!res.ok) throw new HttpError(502, 'Kunne ikke hente valutakurser fra Norges Bank.');
    return json(req, { sdmx: await res.json() });
  }

  if (!allowed) throw new HttpError(403, 'Denne brukeren har ikke tilgang til banktilkobling.', 'forbidden');

  if (action === 'quote-search') {
    const q = String(body.q ?? '').trim().slice(0, 60);
    if (q.length < 2) return json(req, { results: [] });
    const res = await fetch(
      `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=12&newsCount=0&listsCount=0`,
      { headers: { 'User-Agent': 'Mozilla/5.0 (Saldo)' } },
    );
    if (!res.ok) throw new HttpError(502, 'Kunne ikke søke etter verdipapirer akkurat nå.');
    const data = await res.json();
    const results = (data.quotes ?? [])
      .filter((x: Record<string, unknown>) => x.symbol && ['EQUITY', 'ETF', 'MUTUALFUND', 'INDEX', 'CRYPTOCURRENCY'].includes(String(x.quoteType)))
      .map((x: Record<string, unknown>) => ({
        symbol: x.symbol,
        name: x.longname ?? x.shortname ?? x.symbol,
        exchange: x.exchDisp ?? x.exchange ?? '',
        type: x.typeDisp ?? x.quoteType,
      }));
    return json(req, { results });
  }

  if (action === 'quotes') {
    const symbols = (Array.isArray(body.symbols) ? body.symbols : [])
      .map((s: unknown) => String(s).trim().toUpperCase())
      .filter((s: string) => /^[A-Z0-9.^=\-]{1,20}$/.test(s))
      .slice(0, 40);
    const quotes = await Promise.all(
      symbols.map(async (symbol: string) => {
        try {
          const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1d`, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Saldo)' },
          });
          if (!res.ok) return { symbol, error: `Fant ikke kurs (${res.status})` };
          const meta = (await res.json())?.chart?.result?.[0]?.meta;
          if (!meta || typeof meta.regularMarketPrice !== 'number') return { symbol, error: 'Fant ikke kurs' };
          return {
            symbol,
            name: meta.longName ?? meta.shortName ?? symbol,
            exchange: meta.fullExchangeName ?? meta.exchangeName ?? '',
            currency: meta.currency ?? null,
            price: meta.regularMarketPrice,
            previousClose: meta.chartPreviousClose ?? meta.previousClose ?? null,
            time: meta.regularMarketTime ? new Date(meta.regularMarketTime * 1000).toISOString() : null,
            error: null,
          };
        } catch {
          return { symbol, error: 'Kunne ikke hente kurs' };
        }
      }),
    );
    return json(req, { quotes, fetchedAt: new Date().toISOString(), source: 'Yahoo Finance' });
  }

  if (action === 'set-key') {
    const pem = String(body.pem ?? '');
    const appId = String(body.appId ?? '').trim();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(appId)) {
      throw new HttpError(400, 'Applikasjons-ID-en må være en ID på formen aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.', 'bad_app_id');
    }
    if (pem.length > 10_000 || !/PRIVATE KEY/.test(pem)) throw new HttpError(400, 'Dette ser ikke ut som en .pem-nøkkelfil.', 'bad_key');
    // Test nøkkelen mot Enable Banking før den lagres.
    const token = await makeJwt(pem, appId);
    let application: { name?: string; active?: boolean } | null = null;
    try {
      application = await eb('/application', {}, undefined, token);
    } catch (e) {
      if (e instanceof EbError && (e.status === 401 || e.status === 403)) {
        throw new HttpError(400, 'Enable Banking godtok ikke nøkkelen. Sjekk at filen og applikasjons-ID-en hører sammen.', 'key_rejected');
      }
      // Kan ikke bekrefte (f.eks. endepunktet finnes ikke) – lagre likevel; første henting viser om den virker.
      if (!(e instanceof EbError && e.status === 404)) throw e;
    }
    const { error } = await admin.rpc('eb_set_key', { p_pem: pem, p_app_id: appId });
    if (error) throw new HttpError(500, 'Kunne ikke lagre nøkkelen.');
    cachedJwt = null;
    return json(req, { ok: true, applicationName: application?.name ?? null, active: application?.active ?? null });
  }

  if (action === 'aspsps') {
    const country = String(body.country ?? 'NO').toUpperCase().slice(0, 2);
    const res = await eb<{ aspsps: { name: string; country: string; logo?: string; maximum_consent_validity?: number; psu_types?: string[] }[] }>(
      `/aspsps?country=${encodeURIComponent(country)}&psu_type=personal`,
    );
    return json(req, {
      aspsps: (res.aspsps ?? []).map((a) => ({
        name: a.name,
        country: a.country,
        logo: a.logo ?? null,
        maxConsentSeconds: a.maximum_consent_validity ?? null,
      })),
    });
  }

  if (action === 'start-auth') {
    const name = String(body.name ?? '').slice(0, 200);
    const country = String(body.country ?? '').toUpperCase().slice(0, 2);
    if (!name || !country) throw new HttpError(400, 'Velg en bank.');
    const maxSeconds = Math.min(MAX_CONSENT_SECONDS, Number(body.maxConsentSeconds) || MAX_CONSENT_SECONDS);
    // Én time margin (sommertid og klokkeforskjeller kan ellers gi avvisning).
    const validUntil = new Date(Date.now() + (maxSeconds - 3600) * 1000).toISOString();
    const { data: st, error } = await admin
      .from('eb_auth_states')
      .insert({ user_id: user.id, aspsp_name: name, aspsp_country: country })
      .select('state')
      .single();
    if (error) throw new HttpError(500, 'Kunne ikke starte tilkoblingen.');
    const res = await eb<{ url: string }>('/auth', {
      method: 'POST',
      body: JSON.stringify({
        access: { valid_until: validUntil },
        aspsp: { name, country },
        state: st.state,
        redirect_url: CALLBACK_URL,
        psu_type: 'personal',
      }),
    }, psu);
    return json(req, { url: res.url });
  }

  if (action === 'sync') {
    const id = String(body.sessionId ?? '');
    const { data: s } = await admin.from('eb_sessions').select('*').eq('id', id).eq('user_id', user.id).maybeSingle();
    if (!s) throw new HttpError(404, 'Fant ikke tilkoblingen.', 'not_found');
    if (s.status === 'revoked') throw new HttpError(409, 'Tilkoblingen er koblet fra.', 'revoked');
    if (s.valid_until && new Date(s.valid_until).getTime() < Date.now()) {
      await admin.from('eb_sessions').update({ status: 'expired' }).eq('id', id);
      return json(req, { ok: false, reason: 'reauth', message: 'Samtykket har utløpt. Koble til banken på nytt.', session: publicSession({ ...s, status: 'expired' }) });
    }
    const today = new Date();
    const defaultFrom = new Date(today.getTime() - 90 * 86_400_000);
    const fromParam = typeof body.dateFrom === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.dateFrom) ? body.dateFrom : null;
    const dateFrom = fromParam && fromParam > defaultFrom.toISOString().slice(0, 10) ? fromParam : defaultFrom.toISOString().slice(0, 10);

    const results: unknown[] = [];
    let reauth = false;
    for (const acc of s.accounts as { uid: string }[]) {
      if (!acc?.uid) continue;
      try {
        const balances = await eb<{ balances: unknown[] }>(`/accounts/${encodeURIComponent(acc.uid)}/balances`, {}, psu);
        const transactions: unknown[] = [];
        let continuation: string | undefined;
        for (let page = 0; page < 30; page++) {
          const q = new URLSearchParams({ date_from: dateFrom });
          if (continuation) q.set('continuation_key', continuation);
          const res = await eb<{ transactions: unknown[]; continuation_key?: string }>(
            `/accounts/${encodeURIComponent(acc.uid)}/transactions?${q}`,
            {},
            psu,
          );
          transactions.push(...(res.transactions ?? []));
          continuation = res.continuation_key ?? undefined;
          if (!continuation) break;
        }
        results.push({ account: acc, balances: balances.balances ?? [], transactions, error: null });
      } catch (e) {
        if (e instanceof EbError && (e.status === 401 || e.status === 403)) reauth = true;
        results.push({ account: acc, balances: [], transactions: [], error: e instanceof EbError ? ebMessage(e) : 'Ukjent feil' });
        console.error('sync-feil for konto', e instanceof EbError ? e.status : 'intern');
      }
    }
    const nowIso = new Date().toISOString();
    const failed = results.filter((r) => (r as { error: string | null }).error).length;
    const update = reauth
      ? { status: 'expired', last_error: 'Banken krever ny innlogging.' }
      : failed === results.length && results.length > 0
        ? { last_error: 'Oppdatering feilet.' }
        : { last_sync_at: nowIso, last_error: failed ? `${failed} konto(er) feilet` : null };
    await admin.from('eb_sessions').update(update).eq('id', id);
    const { data: fresh } = await admin.from('eb_sessions').select('*').eq('id', id).single();
    if (reauth) return json(req, { ok: false, reason: 'reauth', message: 'Banken krever at du logger inn på nytt.', session: publicSession(fresh) });
    if (failed === results.length && results.length > 0) {
      return json(req, { ok: false, reason: 'temporary', message: (results[0] as { error: string }).error, session: publicSession(fresh) });
    }
    return json(req, { ok: true, fetchedAt: nowIso, session: publicSession(fresh), accounts: results });
  }

  if (action === 'disconnect') {
    const id = String(body.sessionId ?? '');
    const { data: s } = await admin.from('eb_sessions').select('*').eq('id', id).eq('user_id', user.id).maybeSingle();
    if (!s) throw new HttpError(404, 'Fant ikke tilkoblingen.', 'not_found');
    try {
      await eb(`/sessions/${encodeURIComponent(s.session_id)}`, { method: 'DELETE' });
    } catch {
      /* samtykket kan allerede være utløpt – marker som frakoblet uansett */
    }
    await admin.from('eb_sessions').update({ status: 'revoked', accounts: [] }).eq('id', id);
    return json(req, { ok: true });
  }

  throw new HttpError(400, 'Ukjent handling.');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) });
  try {
    if (req.method === 'GET') return await handleCallback(req);
    if (req.method === 'POST') return await handleAction(req);
    return json(req, { error: 'Metoden støttes ikke.' }, 405);
  } catch (e) {
    if (e instanceof HttpError) return json(req, { error: e.message, code: e.code }, e.status);
    if (e instanceof EbError) {
      console.error('Enable Banking-feil', e.status);
      return json(req, { error: ebMessage(e), code: 'eb_error', status: e.status }, 502);
    }
    console.error('intern feil', e instanceof Error ? e.name : 'ukjent');
    return json(req, { error: 'Noe gikk galt på serveren.' }, 500);
  }
});
