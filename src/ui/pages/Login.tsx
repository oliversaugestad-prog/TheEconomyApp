import { FlaskConical, Mail, ShieldCheck } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { sendLoginLink, sendPasswordReset, signInWithPassword } from '../../backend/supabase';
import { Segmented } from '../components/common';

type Mode = 'password' | 'link' | 'reset';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Innlogging med passord eller engangslenke på e-post. Passord håndteres av Supabase, aldri av Saldo selv. */
export function LoginPage({ onDemo, error }: { onDemo: () => void; error?: string | null }) {
  const [mode, setMode] = useState<Mode>('password');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [message, setMessage] = useState<string | null>(error ?? null);

  useEffect(() => {
    document.title = 'Logg inn · Saldo';
  }, []);

  const switchMode = (m: Mode) => {
    setMode(m);
    setStatus('idle');
    setMessage(null);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const addr = email.trim();
    if (!EMAIL_RE.test(addr)) {
      setMessage('Skriv inn en gyldig e-postadresse.');
      return;
    }
    if (mode === 'password' && !password) {
      setMessage('Skriv inn passordet ditt.');
      return;
    }
    setStatus('sending');
    setMessage(null);
    try {
      if (mode === 'password') {
        await signInWithPassword(addr, password);
        location.reload();
        return;
      }
      if (mode === 'link') await sendLoginLink(addr);
      else await sendPasswordReset(addr);
      setStatus('sent');
    } catch (err) {
      setStatus('idle');
      setMessage(err instanceof Error ? err.message : 'Noe gikk galt.');
    }
  };

  const intro =
    mode === 'password'
      ? 'Logg inn med e-post og passord.'
      : mode === 'link'
        ? 'Du får en innloggingslenke på e-post. Åpne den på denne enheten og i denne nettleseren.'
        : 'Du får en lenke på e-post. Når du åpner den, kan du velge et nytt passord.';

  const submitText =
    status === 'sending'
      ? mode === 'password'
        ? 'Logger inn …'
        : 'Sender …'
      : mode === 'password'
        ? 'Logg inn'
        : mode === 'link'
          ? 'Send innloggingslenke'
          : 'Send lenke for nytt passord';

  return (
    <main className="login" id="innhold">
      <div className="login-card stack">
        <div className="brand" style={{ padding: 0 }}>
          <span className="brand-mark" aria-hidden="true">
            S
          </span>
          Saldo
        </div>
        <div className="stack-sm">
          <h1 style={{ fontSize: '1.5rem' }}>{mode === 'reset' ? 'Glemt passord' : 'Logg inn'}</h1>
          {mode !== 'reset' && (
            <Segmented<Mode>
              label="Innloggingsmåte"
              value={mode}
              onChange={switchMode}
              options={[
                { value: 'password', label: 'Passord' },
                { value: 'link', label: 'Lenke på e-post' },
              ]}
            />
          )}
          <p className="muted small">{intro}</p>
        </div>

        {status === 'sent' ? (
          <div className="notice" role="status">
            <Mail size={18} aria-hidden="true" style={{ color: 'var(--accent)' }} />
            <div className="notice-body">
              <p style={{ fontWeight: 600 }}>Sjekk e-posten din</p>
              <p className="muted small">
                {mode === 'reset'
                  ? `Hvis ${email} har en konto, har vi sendt en lenke for å velge nytt passord.`
                  : `Vi har sendt en lenke til ${email}. Trykk på den for å logge inn.`}{' '}
                Finner du den ikke, se i søppelpost.
              </p>
              <button type="button" className="btn ghost small" style={{ marginTop: 8 }} onClick={() => switchMode('password')}>
                Tilbake til innlogging
              </button>
            </div>
          </div>
        ) : (
          <form className="stack-sm" onSubmit={submit} noValidate>
            <label className="field">
              <span>E-post</span>
              <input
                id="login-email"
                className="input"
                type="email"
                autoComplete={mode === 'password' ? 'username' : 'email'}
                inputMode="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="navn@eksempel.no"
              />
            </label>
            {mode === 'password' && (
              <label className="field">
                <span>Passord</span>
                <input
                  id="login-password"
                  className="input"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </label>
            )}
            {message && (
              <p className="error-text" role="alert">
                {message}
              </p>
            )}
            <button type="submit" className="btn primary block" disabled={status === 'sending'}>
              {submitText}
            </button>
            {mode === 'password' && (
              <button type="button" className="btn ghost small" onClick={() => switchMode('reset')}>
                Glemt passord?
              </button>
            )}
            {mode === 'reset' && (
              <button type="button" className="btn ghost small" onClick={() => switchMode('password')}>
                Tilbake til innlogging
              </button>
            )}
          </form>
        )}

        <hr className="sep" />
        <button type="button" className="btn ghost block" onClick={onDemo}>
          <FlaskConical size={16} aria-hidden="true" /> Utforsk med demodata uten innlogging
        </button>
        <p className="xsmall subtle row" style={{ gap: 6, alignItems: 'flex-start' }}>
          <ShieldCheck size={14} aria-hidden="true" style={{ flex: 'none', marginTop: 2 }} />
          <span>
            Innlogget lagres dataene dine på Saldos server i EU, og bare du har tilgang. Demodata lagres bare i denne nettleseren.
          </span>
        </p>
      </div>
    </main>
  );
}
