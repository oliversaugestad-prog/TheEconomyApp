import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { backendConfigured } from './config';
import { BackendProvider, type BackendSession } from './backend/session';
import { signOut, supabase } from './backend/supabase';
import { SaldoStore } from './state/store';
import { localStorageRepository } from './storage/repository';
import { loadRemote, remoteRepository } from './storage/remote';
import { App } from './ui/App';
import { LoginPage } from './ui/pages/Login';
import './ui/styles.css';

const DEMO_FLAG = 'saldo:demo';

type Boot =
  | { kind: 'loading' }
  | { kind: 'login'; error?: string | null }
  | { kind: 'app'; store: SaldoStore; session: BackendSession };

function localApp(): Boot {
  return {
    kind: 'app',
    store: new SaldoStore(localStorageRepository()),
    session: {
      mode: 'local',
      email: null,
      signOut: async () => {
        try {
          sessionStorage.removeItem(DEMO_FLAG);
        } catch {
          /* ignorer */
        }
        location.reload();
      },
    },
  };
}

function Root() {
  const [boot, setBoot] = useState<Boot>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!backendConfigured) return setBoot(localApp());
      try {
        // Ved retur fra innloggingslenken byttes ?code= mot en sesjon her.
        const { data } = await supabase().auth.getSession();
        const session = data.session;
        if (/[?&]code=/.test(location.search)) history.replaceState(null, '', location.pathname + location.hash);
        if (session) {
          const remote = await loadRemote(session.user.id);
          const store = new SaldoStore(remoteRepository(session.user.id, remote), undefined, false);
          if (!cancelled) {
            setBoot({
              kind: 'app',
              store,
              session: {
                mode: 'remote',
                email: session.user.email ?? null,
                signOut: async () => {
                  await signOut();
                  location.reload();
                },
              },
            });
          }
          return;
        }
        let demo = false;
        try {
          demo = sessionStorage.getItem(DEMO_FLAG) === '1';
        } catch {
          /* ignorer */
        }
        if (!cancelled) setBoot(demo ? localApp() : { kind: 'login' });
      } catch (e) {
        if (!cancelled) setBoot({ kind: 'login', error: e instanceof Error ? e.message : 'Kunne ikke kontakte serveren.' });
      }
    })();
    const { data: sub } = backendConfigured
      ? supabase().auth.onAuthStateChange((event) => {
          if (event === 'SIGNED_OUT') location.reload();
        })
      : { data: null };
    return () => {
      cancelled = true;
      sub?.subscription.unsubscribe();
    };
  }, []);

  if (boot.kind === 'loading') {
    return (
      <div className="boot" role="status">
        Laster Saldo …
      </div>
    );
  }
  if (boot.kind === 'login') {
    return (
      <LoginPage
        error={boot.error}
        onDemo={() => {
          try {
            sessionStorage.setItem(DEMO_FLAG, '1');
          } catch {
            /* ignorer */
          }
          setBoot(localApp());
        }}
      />
    );
  }
  return (
    <BackendProvider value={boot.session}>
      <App store={boot.store} />
    </BackendProvider>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
