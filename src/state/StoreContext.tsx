import { createContext, useContext, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import type { SaldoStore, StoreSnapshot } from './store';

const Ctx = createContext<SaldoStore | null>(null);

export function StoreProvider({ store, children }: { store: SaldoStore; children: ReactNode }) {
  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}

export function useStore(): SaldoStore {
  const s = useContext(Ctx);
  if (!s) throw new Error('StoreProvider mangler');
  return s;
}

export function useSnapshot(): StoreSnapshot {
  const store = useStore();
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

export function useData() {
  return useSnapshot().data;
}

/** Dagens dato i brukerens tidssone. */
export function useToday() {
  const store = useStore();
  const tz = useData().settings.timeZone;
  return useMemo(() => store.today(), [store, tz]);
}
