import { FlaskConical, Mail, ShieldCheck } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { sendLoginLink } from '../../backend/supabase';

/** Innlogging med engangslenke på e-post. Ingen passord lagres i Saldo. */
export function LoginPage({ onDemo, error }: { onDemo: () => void; error?: string | null }) {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [message, setMessage] = useState<string | null>(error ?? null);

  useEffect(() => {
    document.title = 'Logg inn · Saldo';
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setMessage('Skriv inn en gyldig e-postadresse.');
      return;
    }
    setStatus('sending');
    setMessage(null);
    try {
      await sendLoginLink(email.trim());
      setStatus('sent');
    } catch (err) {
      setStatus('idle');
      setMessage(err instanceof Error ? err.message : 'Noe gikk galt.');
    }
  };

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
          <h1 style={{ fontSize: '1.5rem' }}>Logg inn</h1>
          <p className="muted small">
            Du får en innloggingslenke på e-post. Åpne den på denne enheten og i denne nettleseren.
          </p>
        </div>

        {status === 'sent' ? (
          <div className="notice" role="status">
            <Mail size={18} aria-hidden="true" style={{ color: 'var(--accent)' }} />
            <div className="notice-body">
              <p style={{ fontWeight: 600 }}>Sjekk e-posten din</p>
              <p className="muted small">
                Vi har sendt en lenke til {email}. Trykk på den for å logge inn. Finner du den ikke, se i søppelpost.
              </p>
              <button type="button" className="btn ghost small" style={{ marginTop: 8 }} onClick={() => setStatus('idle')}>
                Bruk en annen adresse
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
                autoComplete="email"
                inputMode="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="navn@eksempel.no"
              />
            </label>
            {message && (
              <p className="error-text" role="alert">
                {message}
              </p>
            )}
            <button type="submit" className="btn primary block" disabled={status === 'sending'}>
              {status === 'sending' ? 'Sender …' : 'Send innloggingslenke'}
            </button>
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
