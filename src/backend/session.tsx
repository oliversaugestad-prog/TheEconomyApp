import { createContext, useContext, type ReactNode } from 'react';

/** Hvordan appen kjører: lokalt i nettleseren (demo) eller innlogget med egne data på serveren. */
export interface BackendSession {
  mode: 'local' | 'remote';
  email: string | null;
  signOut: () => Promise<void>;
}

const LOCAL: BackendSession = { mode: 'local', email: null, signOut: async () => {} };

const Ctx = createContext<BackendSession>(LOCAL);

export function BackendProvider({ value, children }: { value: BackendSession; children: ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useBackend(): BackendSession {
  return useContext(Ctx);
}
