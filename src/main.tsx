import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { SaldoStore } from './state/store';
import { localStorageRepository } from './storage/repository';
import { App } from './ui/App';
import { ErrorBoundary, StartupError } from './ui/StartupError';
import './ui/styles.css';

const root = createRoot(document.getElementById('root')!);

try {
  const store = new SaldoStore(localStorageRepository());
  root.render(
    <StrictMode>
      <ErrorBoundary>
        <App store={store} />
      </ErrorBoundary>
    </StrictMode>,
  );
} catch (error) {
  root.render(<StartupError error={error} />);
}
