import { demoProvider } from './demo';
import { enableBankingProvider } from './enableBanking';
import type { BankDataProvider } from './types';

export const providers: Record<string, BankDataProvider> = {
  [demoProvider.id]: demoProvider,
  [enableBankingProvider.id]: enableBankingProvider,
};

export function getProvider(id: string): BankDataProvider | undefined {
  return providers[id];
}
