import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useBackend } from '../backend/session';
import { BankApiError, callBank, type BankStatus } from '../backend/supabase';
import { SAVE_ERROR_EVENT } from '../storage/remote';
import { connectionFromSession, EB_PROVIDER_ID } from '../providers/enableBanking';
import { useStore } from '../state/StoreContext';

interface BankContext {
  status: BankStatus | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<BankStatus | null>;
}

const Ctx = createContext<BankContext>({ status: null, loading: false, error: null, refresh: async () => null });

export function useBankStatus() {
  return useContext(Ctx);
}

/**
 * Holder tilkoblingene i Saldo i takt med serveren, og tar imot brukeren når hen
 * kommer tilbake fra bankens innlogging (…#/kontoer?bank=ok).
 */
export function BankBridge({ children }: { children: ReactNode }) {
  const backend = useBackend();
  const store = useStore();
  const location = useLocation();
  const navigate = useNavigate();
  const [status, setStatus] = useState<BankStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const handledReturn = useRef(false);

  const refresh = useCallback(async () => {
    if (backend.mode !== 'remote') return null;
    setLoading(true);
    try {
      const s = await callBank<BankStatus>('status');
      setStatus(s);
      setError(null);
      if (s.allowed) {
        const prev = store.data.connections;
        store.upsertConnections(
          EB_PROVIDER_ID,
          s.sessions.map((sess) => connectionFromSession(sess, prev.find((c) => c.id === `eb-${sess.id}`))),
        );
      }
      return s;
    } catch (e) {
      setError(e instanceof BankApiError ? e.message : 'Kunne ikke hente status for banktilkoblinger.');
      return null;
    } finally {
      setLoading(false);
    }
  }, [backend.mode, store]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Tilbake fra banken.
  useEffect(() => {
    if (backend.mode !== 'remote' || handledReturn.current) return;
    const params = new URLSearchParams(location.search);
    const result = params.get('bank');
    if (!result) return;
    handledReturn.current = true;
    navigate(location.pathname, { replace: true });
    if (result === 'ok') {
      store.notify('ok', `${params.get('navn') ?? 'Banken'} er koblet til. Henter kontoer og transaksjoner …`);
      void (async () => {
        await refresh();
        const fresh = store.data.connections.filter((c) => c.providerId === EB_PROVIDER_ID && !c.lastSuccessfulSync);
        for (const c of fresh) await store.syncConnection(c.id);
      })();
    } else {
      store.notify('error', params.get('melding') ?? 'Tilkoblingen ble ikke fullført.');
    }
  }, [backend.mode, location.pathname, location.search, navigate, refresh, store]);

  // Varsle hvis lagring til serveren feiler.
  useEffect(() => {
    const onErr = () => store.notify('error', 'Endringer kunne ikke lagres på serveren. Sjekk nettforbindelsen.');
    window.addEventListener(SAVE_ERROR_EVENT, onErr);
    return () => window.removeEventListener(SAVE_ERROR_EVENT, onErr);
  }, [store]);

  return <Ctx.Provider value={{ status, loading, error, refresh }}>{children}</Ctx.Provider>;
}
