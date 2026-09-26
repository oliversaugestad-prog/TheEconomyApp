import type { Account, Connection, ExchangeRate, Subscription, Transaction } from '../domain/types';

/**
 * Grensesnitt for datatilbydere. Brukergrensesnittet og beregningslogikken er
 * uavhengige av hvor dataene kommer fra; en ekte bankintegrasjon implementerer
 * det samme grensesnittet som demotilbyderen.
 *
 * NB: En ekte tilbyder skal kjøre via en serverkomponent. Hemmeligheter og
 * tilgangstokener skal aldri ligge i nettleseren.
 */

export interface ProviderAvailability {
  available: boolean;
  /** Forklaring når tilbyderen ikke kan brukes (vises i grensesnittet). */
  reason?: string;
  /** Hva som kreves for å aktivere den. */
  requirements?: string[];
}

export interface InitialData {
  connections: Connection[];
  accounts: Account[];
  transactions: Transaction[];
  subscriptions: Subscription[];
  rates: ExchangeRate[];
}

export type SyncOutcome =
  | {
      ok: true;
      connection: Connection;
      accounts: Account[];
      transactions: Transaction[];
      /** Kilden leverte komplett liste over reservasjoner for disse kontoene. */
      pendingComplete: boolean;
    }
  | {
      ok: false;
      connection: Connection;
      /** 'reauth' = samtykket må fornyes; 'temporary' = prøv igjen senere. */
      reason: 'reauth' | 'temporary';
      message: string;
    };

export interface SyncContext {
  now: Date;
  accounts: Account[];
  transactions: Transaction[];
}

export interface BankDataProvider {
  id: string;
  name: string;
  isDemo: boolean;
  availability(): ProviderAvailability;
  sync(connection: Connection, ctx: SyncContext): Promise<SyncOutcome>;
}
