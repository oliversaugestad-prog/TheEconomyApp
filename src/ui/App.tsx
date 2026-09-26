import { useEffect } from 'react';
import { HashRouter, Link, Route, Routes, useLocation } from 'react-router-dom';
import type { SaldoStore } from '../state/store';
import { StoreProvider } from '../state/StoreContext';
import { Empty } from './components/common';
import { AppShell, Page } from './Layout';
import { BankBridge } from './BankBridge';
import { AccountDetailPage } from './pages/AccountDetail';
import { BusinessPage } from './pages/Business';
import { AccountsPage } from './pages/Accounts';
import { CardDetailPage, CardsPage } from './pages/Cards';
import { ImportPage } from './pages/Import';
import { OverviewPage } from './pages/Overview';
import { SettingsPage } from './pages/Settings';
import { SubscriptionsPage } from './pages/Subscriptions';
import { TransactionsPage } from './pages/Transactions';

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo?.(0, 0);
  }, [pathname]);
  return null;
}

export function AppRoutes() {
  return (
    <AppShell>
      <ScrollToTop />
      <Routes>
        <Route path="/" element={<OverviewPage />} />
        <Route path="/kontoer" element={<AccountsPage />} />
        <Route path="/kontoer/import" element={<ImportPage />} />
        <Route path="/kontoer/:id" element={<AccountDetailPage />} />
        <Route path="/transaksjoner" element={<TransactionsPage />} />
        <Route path="/abonnementer" element={<SubscriptionsPage />} />
        <Route path="/kort" element={<CardsPage />} />
        <Route path="/kort/:id" element={<CardDetailPage />} />
        <Route path="/bedrift" element={<BusinessPage />} />
        <Route path="/innstillinger" element={<SettingsPage />} />
        <Route
          path="*"
          element={
            <Page title="Fant ikke siden" plain>
              <div className="card">
                <Empty icon="?" title="Siden finnes ikke" action={<Link to="/" className="btn">Til oversikten</Link>} />
              </div>
            </Page>
          }
        />
      </Routes>
    </AppShell>
  );
}

export function App({ store }: { store: SaldoStore }) {
  return (
    <StoreProvider store={store}>
      <HashRouter>
        <BankBridge>
          <AppRoutes />
        </BankBridge>
      </HashRouter>
    </StoreProvider>
  );
}
