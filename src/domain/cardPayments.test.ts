import { emptyData } from '../storage/repository';
import { account, tx } from '../test/factories';
import { applyBankCardPayments, isManualCard } from './cardPayments';
import { classifyTransactions } from './reconcile';

function setup(balanceDate: string) {
  const amex = account({
    id: 'amex',
    type: 'credit_card',
    connectionId: 'man',
    bankName: 'American Express',
    name: 'Amex EB SAS',
    source: 'manual',
    bookedBalance: -2_152_300,
    balanceUpdatedAt: `${balanceDate}T10:00:00Z`,
    card: { issuer: 'American Express', last4: '3004', creditLimit: null, statement: null },
  });
  const bank = account({ id: 'sb1', connectionId: 'eb', bankName: 'SpareBank 1 SMN', source: 'bank' });
  const data = {
    ...emptyData(),
    connections: [
      { id: 'man', providerId: 'manual', institutionName: 'American Express', status: 'ok', lastSuccessfulSync: null, lastAttempt: null, error: null, isDemo: false } as never,
      { id: 'eb', providerId: 'enablebanking', institutionName: 'SpareBank 1 SMN', status: 'ok', lastSuccessfulSync: null, lastAttempt: null, error: null, isDemo: false } as never,
    ],
    accounts: [amex, bank],
  };
  return data;
}

describe('innbetaling på manuelt kort', () => {
  it('trekker bankbetalingen til American Express fra kortets gjeld, én gang', () => {
    const data = setup('2026-09-27');
    const pay = tx({ id: 'p1', accountId: 'sb1', amount: -1_000_000, counterparty: 'American Express', bookingDate: '2026-10-12', source: 'bank' });
    const classified = { ...data, transactions: classifyTransactions([pay], data.accounts, []) };
    expect(classified.transactions[0].kind).toBe('card_payment');
    expect(isManualCard(data.accounts[0], data)).toBe(true);
    const once = applyBankCardPayments(classified);
    expect(once.accounts[0].bookedBalance).toBe(-1_152_300);
    // Kjøres på nytt (f.eks. ved neste oppdatering) uten å trekke fra igjen
    expect(applyBankCardPayments(once).accounts[0].bookedBalance).toBe(-1_152_300);
    expect(once.accounts[0].card?.payments).toHaveLength(1);
  });

  it('setter gjelden til 0 når innbetalingen er større enn registrert gjeld', () => {
    const data = setup('2026-09-27');
    const pay = tx({ id: 'p2', accountId: 'sb1', amount: -2_177_984, counterparty: 'American Express', bookingDate: '2026-10-12', source: 'bank' });
    const r = applyBankCardPayments({ ...data, transactions: classifyTransactions([pay], data.accounts, []) });
    expect(r.accounts[0].bookedBalance).toBe(0);
    expect(r.accounts[0].card?.payments?.[0]).toMatchObject({ amount: 2_177_984, applied: 2_152_300 });
  });

  it('ignorerer betalinger fra før gjelden sist ble satt', () => {
    const data = setup('2026-10-13');
    const pay = tx({ id: 'p3', accountId: 'sb1', amount: -1_000_000, counterparty: 'American Express', bookingDate: '2026-10-12', source: 'bank' });
    const r = applyBankCardPayments({ ...data, transactions: classifyTransactions([pay], data.accounts, []) });
    expect(r.accounts[0].bookedBalance).toBe(-2_152_300);
  });
});
