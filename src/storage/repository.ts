import { DEFAULT_TIME_ZONE } from '../domain/dates';
import type { AppData, Settings } from '../domain/types';

/**
 * Lagring i nettleseren (localStorage).
 *
 * Egnet for syntetiske demodata og for å prøve manuelle kontoer/CSV-import på
 * egen maskin. Dataene er IKKE kryptert og er tilgjengelige for alle som har
 * tilgang til nettleserprofilen. Ekte bankdata skal lagres kryptert på en
 * server med autentisering (se docs/BANKINTEGRASJON.md).
 */

export const STORAGE_KEY = 'saldo:data:v1';

export interface Repository {
  load(): AppData | null;
  save(data: AppData): void;
  clear(): void;
}

export function defaultSettings(): Settings {
  let timeZone = DEFAULT_TIME_ZONE;
  try {
    timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || DEFAULT_TIME_ZONE;
  } catch {
    /* bruk standard */
  }
  return {
    accent: 'blue',
    baseCurrency: 'NOK',
    timeZone,
    hideAmounts: false,
    notifications: { upcomingPayments: true, reauthNeeded: true, priceChanges: true, largeTransactions: false },
  };
}

export function emptyData(): AppData {
  return {
    version: 1,
    connections: [],
    accounts: [],
    transactions: [],
    subscriptions: [],
    dismissedSuggestions: [],
    rules: [],
    rates: [],
    settings: defaultSettings(),
  };
}

function isAppData(x: unknown): x is AppData {
  const d = x as AppData;
  return !!d && d.version === 1 && Array.isArray(d.accounts) && Array.isArray(d.transactions) && !!d.settings;
}

export function localStorageRepository(storage: Storage | null = safeLocalStorage()): Repository {
  return {
    load() {
      if (!storage) return null;
      try {
        const raw = storage.getItem(STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!isAppData(parsed)) return null;
        // Fyll inn nye innstillinger med standardverdier ved oppgradering.
        const def = defaultSettings();
        return {
          ...emptyData(),
          ...parsed,
          settings: { ...def, ...parsed.settings, notifications: { ...def.notifications, ...parsed.settings.notifications } },
        };
      } catch {
        return null;
      }
    },
    save(data) {
      if (!storage) return;
      try {
        storage.setItem(STORAGE_KEY, JSON.stringify(data));
      } catch {
        /* lagring kan være blokkert (privat modus) – appen fungerer videre i minnet */
      }
    },
    clear() {
      try {
        storage?.removeItem(STORAGE_KEY);
      } catch {
        /* ignorer */
      }
    },
  };
}

function safeLocalStorage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function memoryRepository(initial: AppData | null = null): Repository & { data: AppData | null } {
  const repo = {
    data: initial,
    load: () => (repo.data ? structuredClone(repo.data) : null),
    save: (d: AppData) => {
      repo.data = structuredClone(d);
    },
    clear: () => {
      repo.data = null;
    },
  };
  return repo;
}
