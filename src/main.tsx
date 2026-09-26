import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { SaldoStore } from './state/store';
import { localStorageRepository } from './storage/repository';
import { App } from './ui/App';
import './ui/styles.css';

const store = new SaldoStore(localStorageRepository());

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App store={store} />
  </StrictMode>,
);
