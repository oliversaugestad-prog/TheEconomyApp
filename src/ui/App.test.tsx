import { act, render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { SaldoStore } from '../state/store';
import { StoreProvider } from '../state/StoreContext';
import { memoryRepository } from '../storage/repository';
import { AppRoutes } from './App';

const NOW = new Date('2026-09-26T08:00:00Z');

function setup(path = '/') {
  const repo = memoryRepository();
  const store = new SaldoStore(repo, () => NOW);
  store.updateSettings({ timeZone: 'Europe/Oslo' });
  const user = userEvent.setup();
  const utils = render(
    <StoreProvider store={store}>
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
      </MemoryRouter>
    </StoreProvider>,
  );
  return { store, repo, user, ...utils };
}

const text = (el: HTMLElement) => el.textContent!.replace(/[  ]/g, ' ');

beforeAll(() => {
  window.scrollTo = () => {};
});

describe('Oversikt', () => {
  it('viser demomodus, totalsum og forklaring av beregningen', async () => {
    const { user } = setup('/');
    expect(screen.getAllByText(/Demomodus/).length).toBeGreaterThan(0);
    expect(screen.getByText('Samlet kontosaldo')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Saldo minus kortgjeld/ }));
    const dialog = screen.getByRole('dialog', { name: 'Kontosaldo minus kredittkortgjeld' });
    expect(within(dialog).getByText('Bokført kredittkortgjeld')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('skjuler beløp med ett trykk og husker valget', async () => {
    const { user, repo } = setup('/');
    await user.click(screen.getAllByRole('button', { name: 'Skjul beløp' })[0]);
    expect(screen.getAllByLabelText('Skjult beløp').length).toBeGreaterThan(5);
    expect(repo.data?.settings.hideAmounts).toBe(true);
  });
});

describe('Transaksjoner', () => {
  it('filter oppdaterer både liste og summer', async () => {
    const { user } = setup('/transaksjoner');
    const summary = screen.getByRole('region', { name: 'Sum for utvalget' });
    const before = text(summary);
    await user.click(screen.getByRole('button', { name: 'Inntekter' }));
    const after = text(summary);
    expect(after).not.toBe(before);
    expect(after).toMatch(/Utgifter\s*0,00 kr/);
    await user.type(screen.getByLabelText('Søk i transaksjoner'), 'Nordvik');
    const list = screen.getByRole('region', { name: 'Transaksjonsliste' });
    expect(within(list).getAllByRole('button').every((b) => /Nordvik/.test(b.textContent ?? ''))).toBe(true);
  });

  it('endrer kategori med regel og viser endringen i detaljvisningen', async () => {
    const { user, store } = setup('/transaksjoner');
    await user.type(screen.getByLabelText('Søk i transaksjoner'), 'SATS');
    const list = screen.getByRole('region', { name: 'Transaksjonsliste' });
    await user.click(within(list).getAllByRole('button')[0]);
    const dialog = screen.getByRole('dialog', { name: 'Transaksjon' });
    await user.click(within(dialog).getByRole('checkbox', { name: /Husk for/ }));
    await user.selectOptions(within(dialog).getByLabelText('Kategori'), 'helse');
    expect(within(dialog).getByRole('status')).toHaveTextContent(/Regel/);
    const sats = store.data.transactions.filter((t) => t.counterparty === 'SATS NORGE AS');
    expect(sats.every((t) => t.category === 'helse')).toBe(true);
  });
});

describe('Kontoer', () => {
  it('legger til manuell konto uten saldo og markerer totalsum som ufullstendig', async () => {
    const { user, store } = setup('/kontoer');
    await user.click(screen.getAllByRole('button', { name: /Legg til konto|Manuell konto/ })[0]);
    const dialog = screen.getByRole('dialog', { name: 'Legg til konto manuelt' });
    await user.type(within(dialog).getByLabelText('Bank / utsteder'), 'Lokalbanken');
    await user.type(within(dialog).getByLabelText('Kontonavn'), 'Reisekonto');
    await user.click(within(dialog).getByRole('button', { name: 'Legg til' }));
    expect(await screen.findByText('Lokalbanken')).toBeInTheDocument();
    const acc = store.data.accounts.find((a) => a.name === 'Reisekonto')!;
    expect(acc.bookedBalance).toBeNull();
  });

  it('importerer CSV med forhåndsvisning og duplikatkontroll', async () => {
    const { user, store } = setup('/kontoer/import');
    let acc!: ReturnType<typeof store.addManualAccount>;
    act(() => {
      acc = store.addManualAccount({ bankName: 'Lokalbanken', name: 'Import', type: 'checking', currency: 'NOK', bookedBalance: 0, availableBalance: null, last4: '', creditLimit: null });
    });
    await user.selectOptions(screen.getByLabelText('Transaksjonene gjelder'), acc.id);
    await user.click(screen.getByRole('button', { name: /Bruk eksempelfil/ }));
    expect(screen.getByText('5 nye')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Importer 5 transaksjoner' }));
    expect(await screen.findByText(/5 transaksjoner importert/)).toBeInTheDocument();
    expect(store.data.transactions.filter((t) => t.accountId === acc.id)).toHaveLength(5);
    // Samme fil igjen gir bare duplikater
    await user.click(screen.getByRole('button', { name: /Bruk eksempelfil/ }));
    expect(screen.getByText('5 duplikater')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Importer 0 transaksjoner' })).toBeDisabled();
  });
});

describe('Abonnementer', () => {
  it('bekrefter forslag og markerer abonnement som avsluttet med forklaring', async () => {
    const { user, store } = setup('/abonnementer');
    await user.click(screen.getByRole('button', { name: /Forslag \(/ }));
    const before = store.data.subscriptions.length;
    await user.click(screen.getAllByRole('button', { name: /Bekreft/ })[0]);
    expect(store.data.subscriptions.length).toBe(before + 1);

    await user.click(screen.getByRole('button', { name: 'Abonnementer' }));
    await user.click(screen.getByRole('button', { name: /Netflix/ }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Marker som avsluttet' }));
    expect(within(dialog).getByText(/sies ikke opp hos Netflix/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Ja, marker som avsluttet' }));
    await waitFor(() => expect(store.data.subscriptions.find((s) => s.matchKey === 'netflix')?.status).toBe('ended'));
  });
});

describe('Kredittkort', () => {
  it('viser «Ikke tilgjengelig» for manglende faktura og lar brukeren registrere den', async () => {
    const { user, store } = setup('/kort/demo-card-visa');
    expect(screen.getByText('Ikke tilgjengelig', { selector: 'p' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Registrer manuelt/ }));
    const dialog = screen.getByRole('dialog', { name: 'Fakturaopplysninger' });
    await user.type(within(dialog).getByLabelText(/Fakturabeløp/), '4 027,70');
    await user.click(within(dialog).getByRole('button', { name: 'Lagre' }));
    const st = store.data.accounts.find((a) => a.id === 'demo-card-visa')?.card?.statement;
    expect(st).toMatchObject({ amount: 402770, source: 'manual' });
    expect(screen.getByText(/registrert manuelt av deg/)).toBeInTheDocument();
  });
});

describe('Innstillinger', () => {
  it('bytter aksent og fjerner demodata', async () => {
    const { user, store } = setup('/innstillinger');
    await user.click(screen.getByRole('button', { name: 'Korall' }));
    expect(document.documentElement.dataset.accent).toBe('coral');
    await user.click(screen.getByRole('button', { name: /Fjern demodata/ }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Fjern demodata' }));
    expect(store.hasDemoData()).toBe(false);
    expect(screen.getByText('Egne data', { selector: '.badge' })).toBeInTheDocument();
  });
});

describe('Bedrift', () => {
  it('registrerer bankinnskudd, unotert aksjepost og gjeld, og viser samlet verdi', async () => {
    const { user, store } = setup('/bedrift');
    await user.click(screen.getByRole('button', { name: 'Legg til bank og kontanter' }));
    let dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText('Navn'), 'Driftskonto');
    await user.type(within(dialog).getByLabelText('Saldo'), '100 000');
    await user.click(within(dialog).getByRole('button', { name: 'Lagre' }));

    await user.click(screen.getByRole('button', { name: /Legg til$/ }));
    dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Unotert' }));
    await user.type(within(dialog).getByLabelText('Navn'), 'Eksempel Holding AS');
    await user.type(within(dialog).getByLabelText(/Kurs per aksje/), '125,50');
    await user.type(within(dialog).getByLabelText('Antall'), '100');
    await user.click(within(dialog).getByRole('button', { name: 'Lagre' }));

    await user.click(screen.getByRole('button', { name: 'Legg til gjeld' }));
    dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText('Navn'), 'Banklån');
    await user.type(within(dialog).getByLabelText('Utestående'), '20 000');
    await user.click(within(dialog).getByRole('button', { name: 'Lagre' }));

    expect(store.data.business?.items).toHaveLength(2);
    expect(store.data.business?.holdings[0]).toMatchObject({ symbol: null, quantity: 100, manualPrice: 125.5 });
    const hero = screen.getByText(/Samlet verdi/).closest('section')!;
    // 100 000 + 12 550 − 20 000 = 92 550
    expect(text(hero)).toMatch(/92 550,00 kr/);
    // Holdes utenfor privat totalsum
    expect(store.data.accounts.some((a) => a.name === 'Driftskonto')).toBe(false);
  });
});
