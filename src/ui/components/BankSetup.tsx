import { CheckCircle2, Copy, KeyRound, Loader2, LogOut, Upload } from 'lucide-react';
import { useRef, useState, type ChangeEvent } from 'react';
import { useBackend } from '../../backend/session';
import { BankApiError, callBank } from '../../backend/supabase';
import { BANK_CALLBACK_URL } from '../../config';
import { useBankStatus } from '../BankBridge';
import { Notice } from './common';

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/** Innlogget bruker og oppsett av ekte banktilkobling (Enable Banking). */
export function BankSetup() {
  const backend = useBackend();
  const { status, loading, error, refresh } = useBankStatus();
  const [appId, setAppId] = useState('');
  const [pem, setPem] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  if (backend.mode !== 'remote') {
    return (
      <section className="card stack" id="bank" aria-labelledby="bank-h">
        <h2 id="bank-h">Banktilkobling</h2>
        <Notice>Du bruker demodata uten innlogging. Logg ut av demoen og logg inn med e-post for å koble til dine egne banker.</Notice>
        <div>
          <button type="button" className="btn" onClick={() => backend.signOut()}>
            <LogOut size={16} aria-hidden="true" /> Avslutt demo og logg inn
          </button>
        </div>
      </section>
    );
  }

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    setResult(null);
    if (!f) return;
    if (f.size > 10_000) {
      setResult({ tone: 'error', text: 'Filen er for stor til å være en nøkkelfil.' });
      return;
    }
    const text = await f.text();
    if (!/PRIVATE KEY/.test(text)) {
      setResult({ tone: 'error', text: 'Dette ser ikke ut som .pem-filen fra Enable Banking.' });
      return;
    }
    setPem(text);
    setFileName(f.name);
    // Filnavnet er applikasjonens ID (f.eks. aaaaaaaa-bbbb-….pem).
    const fromName = f.name.match(UUID)?.[0];
    if (fromName && !appId) setAppId(fromName);
  };

  const save = async () => {
    if (!pem) return;
    setSaving(true);
    setResult(null);
    try {
      const r = await callBank<{ applicationName: string | null }>('set-key', { pem, appId: appId.trim() });
      setResult({ tone: 'ok', text: r.applicationName ? `Nøkkelen er godkjent for «${r.applicationName}» og lagret kryptert.` : 'Nøkkelen er lagret kryptert.' });
      setPem(null);
      setFileName(null);
      if (fileRef.current) fileRef.current.value = '';
      await refresh();
    } catch (e) {
      setResult({ tone: 'error', text: e instanceof BankApiError ? e.message : 'Kunne ikke lagre nøkkelen.' });
    } finally {
      setSaving(false);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(BANK_CALLBACK_URL);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* brukeren kan markere teksten selv */
    }
  };

  return (
    <section className="card stack" id="bank" aria-labelledby="bank-h">
      <div className="spread wrap">
        <h2 id="bank-h">Banktilkobling</h2>
        <button type="button" className="btn ghost small" onClick={() => backend.signOut()}>
          <LogOut size={16} aria-hidden="true" /> Logg ut
        </button>
      </div>
      <p className="small muted">
        Innlogget som <strong style={{ color: 'var(--text)' }}>{backend.email}</strong>. Dataene dine lagres på Saldos server i EU, og bare du har tilgang.
      </p>

      {loading && !status && (
        <p className="muted small row">
          <Loader2 size={16} className="spin" aria-hidden="true" /> Sjekker oppsettet …
        </p>
      )}
      {error && <Notice tone="error">{error}</Notice>}
      {status && !status.allowed && <Notice tone="warn">Denne brukeren har ikke tilgang til banktilkobling.</Notice>}

      {status?.allowed && (
        <>
          <ol className="stack-sm small" style={{ margin: 0, paddingLeft: 18 }}>
            <li>
              <span className="row wrap" style={{ gap: 6 }}>
                Nøkkelfil fra Enable Banking:
                {status.keyConfigured ? (
                  <span className="badge ok">
                    <CheckCircle2 size={12} aria-hidden="true" /> Lastet opp
                  </span>
                ) : (
                  <span className="badge warn">Mangler</span>
                )}
              </span>
            </li>
            <li>
              <span>Tillatt «redirect URL» i Enable Banking-applikasjonen må være:</span>
              <span className="row wrap" style={{ gap: 6, marginTop: 4 }}>
                <code className="code-chip">{BANK_CALLBACK_URL}</code>
                <button type="button" className="btn ghost small" onClick={copy}>
                  <Copy size={14} aria-hidden="true" /> {copied ? 'Kopiert' : 'Kopier'}
                </button>
              </span>
            </li>
            <li>Koble til bankene under Kontoer → «Koble til bank».</li>
          </ol>

          <div className="stack-sm">
            <h3 className="row" style={{ gap: 8 }}>
              <KeyRound size={16} aria-hidden="true" /> {status.keyConfigured ? 'Bytt nøkkelfil' : 'Last opp nøkkelfil'}
            </h3>
            <p className="xsmall subtle">
              Velg .pem-filen som ble lastet ned da du registrerte applikasjonen. Den sendes kryptert til serveren og lagres i et kryptert hvelv. Den vises aldri igjen i appen.
            </p>
            <div className="row wrap">
              <label className="btn">
                <Upload size={16} aria-hidden="true" /> Velg .pem-fil
                <input ref={fileRef} type="file" accept=".pem,application/x-pem-file,text/plain" className="sr-only" onChange={onFile} />
              </label>
              {fileName && <span className="small muted">{fileName}</span>}
            </div>
            {pem && (
              <label className="field">
                <span>Applikasjons-ID</span>
                <input id="eb-app-id" className="input" value={appId} onChange={(e) => setAppId(e.target.value)} placeholder="aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" />
                <span className="hint">Hentet fra filnavnet. Du finner den også i Enable Banking under «API applications».</span>
              </label>
            )}
            {result && <Notice tone={result.tone === 'ok' ? 'info' : 'error'}>{result.text}</Notice>}
            {pem && (
              <div>
                <button type="button" className="btn primary" disabled={saving || !UUID.test(appId)} onClick={save}>
                  {saving ? 'Tester og lagrer …' : 'Lagre nøkkel'}
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}
