import { Landmark, Loader2, Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useBackend } from '../../backend/session';
import { BankApiError, callBank, type AspspInfo } from '../../backend/supabase';
import { useBankStatus } from '../BankBridge';
import { Dialog } from './Dialog';
import { Notice } from './common';

const COUNTRIES = [
  { code: 'NO', label: 'Norge' },
  { code: 'DK', label: 'Danmark' },
  { code: 'SE', label: 'Sverige' },
  { code: 'FI', label: 'Finland' },
  { code: 'LT', label: 'Litauen (bl.a. Revolut)' },
];

/** Starter bankens egen innlogging (BankID) for en valgt bank. */
export async function startBankLogin(aspsp: Pick<AspspInfo, 'name' | 'country' | 'maxConsentSeconds'>): Promise<void> {
  const { url } = await callBank<{ url: string }>('start-auth', {
    name: aspsp.name,
    country: aspsp.country,
    maxConsentSeconds: aspsp.maxConsentSeconds,
    returnUrl: `${window.location.origin}${window.location.pathname}`,
  });
  window.location.assign(url);
}

export function ConnectBankDialog({ open, onClose, initialCountry = 'NO' }: { open: boolean; onClose: () => void; initialCountry?: string }) {
  const backend = useBackend();
  const { status, loading: statusLoading } = useBankStatus();
  const [country, setCountry] = useState(initialCountry);
  const [aspsps, setAspsps] = useState<AspspInfo[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [starting, setStarting] = useState<string | null>(null);
  const ready = backend.mode === 'remote' && status?.allowed && status.keyConfigured;

  useEffect(() => {
    if (!open || !ready) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setAspsps(null);
    callBank<{ aspsps: AspspInfo[] }>('aspsps', { country })
      .then((r) => !cancelled && setAspsps(r.aspsps.sort((a, b) => a.name.localeCompare(b.name, 'nb'))))
      .catch((e) => !cancelled && setError(e instanceof BankApiError ? e.message : 'Kunne ikke hente listen over banker.'))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [open, ready, country]);

  const filtered = useMemo(
    () => (aspsps ?? []).filter((a) => a.name.toLowerCase().includes(query.trim().toLowerCase())),
    [aspsps, query],
  );

  const choose = async (a: AspspInfo) => {
    setStarting(a.name);
    setError(null);
    try {
      await startBankLogin(a);
    } catch (e) {
      setError(e instanceof BankApiError ? e.message : 'Kunne ikke starte innloggingen hos banken.');
      setStarting(null);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} title="Koble til bank">
      <div className="stack">
        {backend.mode !== 'remote' ? (
          <Notice tone="warn" title="Logg inn for å koble til banken din">
            Du bruker demodata uten innlogging. Ekte banktilkobling krever at du logger inn, slik at dataene lagres trygt på serveren og bare du ser dem.
          </Notice>
        ) : statusLoading && !status ? (
          <p className="muted small row">
            <Loader2 size={16} className="spin" aria-hidden="true" /> Sjekker oppsettet …
          </p>
        ) : !status?.allowed ? (
          <Notice tone="warn" title="Ikke tilgang">
            Denne brukeren har ikke tilgang til banktilkobling i Saldo.
          </Notice>
        ) : !status.keyConfigured ? (
          <Notice tone="warn" title="Nøkkelfilen mangler">
            Last opp .pem-filen fra Enable Banking under{' '}
            <Link to="/innstillinger#bank" onClick={onClose}>
              Innstillinger → Banktilkobling
            </Link>{' '}
            først.
          </Notice>
        ) : (
          <>
            <p className="small muted">
              Velg banken din. Du sendes til bankens egen innlogging med BankID og godkjenner lesetilgang til saldo og transaksjoner. Saldo ser aldri passordet ditt og kan ikke betale noe.
            </p>
            <div className="form-grid two">
              <label className="field">
                <span>Land</span>
                <select id="bank-country" className="select" value={country} onChange={(e) => setCountry(e.target.value)}>
                  {COUNTRIES.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Søk</span>
                <span className="search">
                  <Search size={18} aria-hidden="true" />
                  <input id="bank-search" className="input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="F.eks. SpareBank 1" />
                </span>
              </label>
            </div>
            {error && <Notice tone="error">{error}</Notice>}
            {loading ? (
              <p className="muted small row">
                <Loader2 size={16} className="spin" aria-hidden="true" /> Henter banker …
              </p>
            ) : (
              <ul className="list card flush" style={{ maxHeight: 360, overflowY: 'auto' }} aria-label="Banker">
                {filtered.map((a) => (
                  <li key={`${a.country}-${a.name}`}>
                    <button type="button" className="list-item" disabled={!!starting} onClick={() => choose(a)}>
                      {a.logo ? (
                        <img src={a.logo} alt="" width={32} height={32} style={{ borderRadius: 8, background: '#fff', objectFit: 'contain', flex: 'none' }} />
                      ) : (
                        <span className="avatar" aria-hidden="true">
                          <Landmark size={18} />
                        </span>
                      )}
                      <span className="li-main">
                        <span className="li-title" style={{ display: 'block' }}>
                          {a.name}
                        </span>
                      </span>
                      {starting === a.name && <Loader2 size={16} className="spin" aria-label="Åpner banken" />}
                    </button>
                  </li>
                ))}
                {aspsps && filtered.length === 0 && <li className="list-item muted small">Ingen banker passer søket.</li>}
              </ul>
            )}
          </>
        )}
        <p className="xsmall subtle">
          Banker som ikke kan kobles til (f.eks. American Express), kan legges inn manuelt eller importeres fra CSV.{' '}
          <Link to="/kontoer/import" onClick={onClose}>
            Importer CSV
          </Link>
        </p>
      </div>
    </Dialog>
  );
}
