import { Component, type ReactNode } from 'react';
import { STORAGE_KEY } from '../storage/repository';

/** Viser en feilmelding i stedet for en blank side når appen krasjer. */
export function StartupError({ error }: { error: unknown }) {
  const message = error instanceof Error ? error.message : String(error);
  const reset = () => {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignorer */
    }
    window.location.reload();
  };
  return (
    <main role="alert" style={{ padding: '32px 16px', maxWidth: '36rem', margin: '0 auto', lineHeight: 1.5 }}>
      <h1 style={{ fontSize: 20 }}>Saldo kunne ikke vises</h1>
      <p>Noe gikk galt under oppstart. Ofte skyldes det lagrede data fra en eldre versjon.</p>
      <pre style={{ whiteSpace: 'pre-wrap', color: 'var(--danger)' }}>{message}</pre>
      <button type="button" className="btn primary" onClick={reset}>
        Nullstill lagrede data og last på nytt
      </button>
    </main>
  );
}

export class ErrorBoundary extends Component<{ children: ReactNode }, { error: unknown }> {
  state = { error: null as unknown };

  static getDerivedStateFromError(error: unknown) {
    return { error };
  }

  render() {
    return this.state.error ? <StartupError error={this.state.error} /> : this.props.children;
  }
}
