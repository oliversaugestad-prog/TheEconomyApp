import { vi } from 'vitest';

const calls: { action: string; payload: unknown }[] = [];
vi.mock('../backend/supabase', () => ({
  BankApiError: class extends Error {},
  callBank: vi.fn(async (action: string, payload: unknown) => {
    calls.push({ action, payload });
    if (action === 'sync') {
      return {
        ok: true,
        fetchedAt: '2026-09-26T17:00:00Z',
        session: { id: 's1', aspspName: 'SpareBank 1 SMN', aspspCountry: 'NO', validUntil: '2027-03-25T00:00:00Z', status: 'active', lastSyncAt: '2026-09-26T17:00:00Z', lastError: null, accountCount: 1 },
        accounts: [
          {
            account: { uid: 'u1', identification_hash: 'h1', name: 'Brukskonto', currency: 'NOK', cash_account_type: 'CACC' },
            balances: [{ balance_type: 'CLBD', balance_amount: { currency: 'NOK', amount: '100.00' } }],
            transactions: [{ transaction_amount: { currency: 'NOK', amount: '10.00' }, credit_debit_indicator: 'DBIT', status: 'BOOK', booking_date: '2026-09-25', creditor: { name: 'Vipps*Storytel' } }],
            error: null,
          },
        ],
      };
    }
    return {};
  }),
}));

import { SaldoStore } from '../state/store';
import { memoryRepository } from '../storage/repository';
import { connectionFromSession } from './enableBanking';

describe('synkronisering av ekte tilkobling', () => {
  it('sender forespørsel til serveren og lagrer kontoer og transaksjoner', async () => {
    const store = new SaldoStore(memoryRepository(), () => new Date('2026-09-26T17:00:00Z'), false);
    store.upsertConnections('enablebanking', [
      connectionFromSession({ id: 's1', aspspName: 'SpareBank 1 SMN', aspspCountry: 'NO', validUntil: '2027-03-25T00:00:00Z', status: 'active', lastSyncAt: '2026-09-26T16:20:43.953+00:00', lastError: null, accountCount: 1 }),
    ]);
    await store.syncAll();
    expect(calls.map((c) => c.action)).toEqual(['sync']);
    expect(store.data.accounts.map((a) => a.id)).toEqual(['eb-h1']);
    expect(store.data.transactions[0].counterparty).toBe('Storytel');
    expect(store.data.connections[0].lastSuccessfulSync).toBe('2026-09-26T17:00:00Z');
  });
});
