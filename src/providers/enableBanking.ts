import { addDays } from '../domain/dates';
import type { Connection } from '../domain/types';
import { BankApiError, callBank, type BankSessionInfo } from '../backend/supabase';
import { mapAccount, mapTransactions, type EbAccountResult } from './ebMapping';
import type { BankDataProvider, SyncContext, SyncOutcome } from './types';

/**
 * Ekte bankdata via Enable Banking (PSD2). All kontakt med Enable Banking går
 * gjennom Saldos serverfunksjon, som holder nøkkelen og samtykkene.
 */

export const EB_PROVIDER_ID = 'enablebanking';

export function connectionIdFor(sessionId: string): string {
  return `eb-${sessionId}`;
}

export function sessionIdOf(connection: Pick<Connection, 'id'>): string {
  return connection.id.replace(/^eb-/, '');
}

/** Lager eller oppdaterer en tilkobling ut fra serverens sesjonsinformasjon. */
export function connectionFromSession(s: BankSessionInfo, previous?: Connection): Connection {
  const expired = s.status === 'expired' || (s.validUntil ? new Date(s.validUntil).getTime() < Date.now() : false);
  return {
    id: connectionIdFor(s.id),
    providerId: EB_PROVIDER_ID,
    institutionName: s.aspspName,
    status: expired ? 'reauth_required' : s.lastError ? 'error' : 'ok',
    lastSuccessfulSync: s.lastSyncAt ?? previous?.lastSuccessfulSync ?? null,
    lastAttempt: previous?.lastAttempt ?? null,
    error: expired ? 'Samtykket har utløpt. Koble til banken på nytt.' : s.lastError,
    consentExpiresAt: s.validUntil,
    isDemo: false,
    source: 'bank',
  };
}

interface SyncResponse {
  ok: boolean;
  reason?: 'reauth' | 'temporary';
  message?: string;
  fetchedAt?: string;
  session: BankSessionInfo;
  accounts?: EbAccountResult[];
}

export const enableBankingProvider: BankDataProvider = {
  id: EB_PROVIDER_ID,
  name: 'Banktilkobling (Enable Banking)',
  isDemo: false,
  availability: () => ({ available: true }),
  async sync(connection: Connection, ctx: SyncContext): Promise<SyncOutcome> {
    const nowIso = ctx.now.toISOString();
    const today = nowIso.slice(0, 10);
    // Hent på nytt fra litt før forrige vellykkede henting, så sene bokføringer kommer med.
    const dateFrom = connection.lastSuccessfulSync ? addDays(connection.lastSuccessfulSync.slice(0, 10), -14) : undefined;
    let res: SyncResponse;
    try {
      res = await callBank<SyncResponse>('sync', { sessionId: sessionIdOf(connection), dateFrom });
    } catch (e) {
      const message = e instanceof BankApiError ? e.message : 'Kunne ikke hente data fra banken.';
      return { ok: false, reason: 'temporary', message, connection: { ...connection, status: 'error', lastAttempt: nowIso, error: message } };
    }
    const updated = { ...connectionFromSession(res.session, connection), lastAttempt: nowIso };
    if (!res.ok) {
      return {
        ok: false,
        reason: res.reason ?? 'temporary',
        message: `${connection.institutionName}: ${res.message ?? 'oppdatering feilet'}`,
        connection: { ...updated, status: res.reason === 'reauth' ? 'reauth_required' : 'error', error: res.message ?? updated.error },
      };
    }
    const fetchedAt = res.fetchedAt ?? nowIso;
    const accounts = (res.accounts ?? []).map((r) => {
      const prev = ctx.accounts.find((a) => a.id === `eb-${r.account.identification_hash || r.account.uid}`);
      return { result: r, account: mapAccount(r, updated, fetchedAt, prev) };
    });
    const transactions = accounts.flatMap(({ result, account }) =>
      result.error ? [] : mapTransactions(result, account.id, account.currency, today),
    );
    return {
      ok: true,
      connection: { ...updated, status: 'ok', lastSuccessfulSync: fetchedAt, error: updated.error },
      accounts: accounts.map((a) => a.account),
      transactions,
      // Reservasjoner fjernes bare for kontoer som faktisk ble hentet.
      pendingComplete: accounts.every((a) => !a.result.error),
    };
  },
};
