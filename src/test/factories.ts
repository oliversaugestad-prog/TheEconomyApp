import type { Account, Transaction } from '../domain/types';

let n = 0;

export function account(p: Partial<Account> = {}): Account {
  n += 1;
  return {
    id: p.id ?? `acc-${n}`,
    connectionId: 'conn',
    bankName: 'Testbank',
    name: `Konto ${n}`,
    type: 'checking',
    currency: 'NOK',
    maskedNumber: '•••• 0000',
    bookedBalance: 0,
    availableBalance: 0,
    availableIncludesReservations: true,
    balanceUpdatedAt: null,
    includedInOverview: true,
    isDemo: false,
    source: 'manual',
    ...p,
  };
}

export function tx(p: Partial<Transaction> & Pick<Transaction, 'accountId' | 'amount'>): Transaction {
  n += 1;
  return {
    id: `tx-${n}`,
    externalId: null,
    bookingDate: '2026-09-10',
    currency: 'NOK',
    counterparty: 'Butikk',
    description: '',
    status: 'booked',
    category: 'annet',
    kind: 'normal',
    linkedTransactionId: null,
    userCategorized: false,
    userKind: false,
    isDemo: false,
    source: 'manual',
    ...p,
  };
}
