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
    // «Husk for lignende kjøp» er på som standard
    expect(within(dialog).getByRole('checkbox', { name: /Husk for lignende kjøp/ })).toBeChecked();
    expect(within(dialog).getByLabelText(/Mottakere som starter med/)).toHaveValue('sats');
    await user.selectOptions(within(dialog).getByLabelText('Kategori'), 'helse');
    expect(within(dialog).getByRole('status')).toHaveTextContent(/fremtidige lignende kjøp/);
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

describe('Formue', () => {
  it('legger inn bolig og lån privat, og viser bedriften med eierandel', async () => {
    const { user, store } = setup('/formue');
    const hero = () => text(screen.getByText(/Nettoformue i ditt navn/).closest('section')!);
    const before = store.data.accounts;
    expect(before.length).toBeGreaterThan(0);

    await user.click(screen.getByRole('button', { name: 'Legg til bolig, bil og andre eiendeler' }));
    let dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText('Navn'), 'Leilighet');
    await user.type(within(dialog).getByLabelText('Verdi'), '3 000 000');
    await user.click(within(dialog).getByRole('button', { name: 'Lagre' }));
    const afterAsset = hero();

    await user.click(screen.getByRole('button', { name: 'Legg til lån' }));
    dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText('Navn'), 'Boliglån');
    await user.type(within(dialog).getByLabelText('Utestående'), '2 000 000');
    await user.click(within(dialog).getByRole('button', { name: 'Lagre' }));

    expect(store.data.personalAssets?.items).toHaveLength(2);
    expect(store.data.business).toBeUndefined();
    expect(hero()).not.toBe(afterAsset);
    expect(screen.getByText('Hva formuen består av')).toBeInTheDocument();

    act(() => {
      store.upsertBusinessItem({ id: 'b1', kind: 'cash', name: 'Drift', institution: '', currency: 'NOK', amount: 10_000_000, updatedAt: '' });
    });
    await user.click(screen.getByRole('button', { name: /Eierandel 100/ }));
    dialog = screen.getByRole('dialog');
    await user.clear(within(dialog).getByLabelText(/Eierandel \(%\)/));
    await user.type(within(dialog).getByLabelText(/Eierandel \(%\)/), '50');
    await user.click(within(dialog).getByRole('button', { name: 'Lagre' }));
    expect(store.data.business?.ownership).toBe(50);
    const withBiz = hero();
    await user.click(screen.getByRole('button', { name: 'Uten bedriften' }));
    expect(hero()).not.toBe(withBiz);
  });
});

describe('Kredittkort manuelt', () => {
  it('legger til et Amex-kort fra kortsiden', async () => {
    const { user, store } = setup('/kort');
    await user.click(screen.getByRole('button', { name: 'Legg til kort manuelt' }));
    const dialog = screen.getByRole('dialog', { name: 'Legg til konto manuelt' });
    expect(within(dialog).getByLabelText('Type')).toHaveValue('credit_card');
    await user.type(within(dialog).getByLabelText('Bank / utsteder'), 'American Express');
    await user.type(within(dialog).getByLabelText('Kontonavn'), 'Amex');
    await user.type(within(dialog).getByLabelText('Utestående gjeld'), '4 500');
    await user.click(within(dialog).getByRole('button', { name: 'Legg til' }));
    const card = store.data.accounts.find((a) => a.name === 'Amex')!;
    expect(card).toMatchObject({ type: 'credit_card', bookedBalance: -450000 });
  });
});

describe('Rediger kredittkort', () => {
  it('endrer navn, farge og gjeld, og sletter kortet', async () => {
    const { user, store } = setup('/kort/demo-card-visa');
    await user.click(screen.getByRole('button', { name: 'Rediger' }));
    let dialog = screen.getByRole('dialog', { name: 'Rediger kort' });
    await user.clear(within(dialog).getByLabelText('Navn på kortet'));
    await user.type(within(dialog).getByLabelText('Navn på kortet'), 'Reisekort');
    await user.click(within(dialog).getByRole('radio', { name: 'Korall' }));
    await user.click(within(dialog).getByRole('button', { name: 'Lagre' }));
    expect(store.data.accounts.find((a) => a.id === 'demo-card-visa')).toMatchObject({ name: 'Reisekort', color: 'grad-4' });

    await user.click(screen.getByRole('button', { name: 'Rediger' }));
    dialog = screen.getByRole('dialog', { name: 'Rediger kort' });
    await user.click(within(dialog).getByRole('button', { name: 'Slett kort' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Ja, slett kortet' }));
    expect(store.data.accounts.some((a) => a.id === 'demo-card-visa')).toBe(false);
  });
});

describe('Import fra Amex', () => {
  it('oppretter kort fra importsiden og foreslår å snu fortegn', async () => {
    const { user, store } = setup('/kontoer/import');
    await user.click(screen.getByRole('button', { name: 'Nytt kredittkort' }));
    const dialog = screen.getByRole('dialog', { name: 'Legg til konto manuelt' });
    await user.type(within(dialog).getByLabelText('Bank / utsteder'), 'American Express');
    await user.type(within(dialog).getByLabelText('Kontonavn'), 'Amex');
    await user.click(within(dialog).getByRole('button', { name: 'Legg til' }));
    const card = store.data.accounts.find((a) => a.name === 'Amex')!;
    expect(card.type).toBe('credit_card');
    expect(screen.getByLabelText('Transaksjonene gjelder')).toHaveValue(card.id);

    await user.click(screen.getByText('Eller lim inn innhold'));
    const csv = 'Dato,Beskrivelse,Beløp\n09/24/2026,SPOTIFY,109.00\n09/13/2026,REMA 1000,250.00\n09/02/2026,BETALING MOTTATT,-500.00';
    await user.click(screen.getByLabelText('CSV-innhold'));
    await user.paste(csv);
    expect(screen.getByRole('checkbox', { name: /snu fortegn/ })).toBeChecked();
    await user.click(screen.getByRole('button', { name: 'Importer 3 transaksjoner' }));
    const txs = store.data.transactions.filter((t) => t.accountId === card.id);
    expect(txs.map((t) => t.amount).sort((a, b) => a - b)).toEqual([-25000, -10900, 50000]);
    // Innbetalingen til kortet er nedbetaling av gjeld, ikke inntekt
    expect(txs.find((t) => t.amount === 50000)?.kind).toBe('card_payment');
  });
});

describe('Kategorier i oversikten', () => {
  it('åpner transaksjonene i kategorien når man trykker på den', async () => {
    const { user } = setup('/');
    const card = screen.getByRole('heading', { name: /Utgifter per kategori/ }).closest('section')!;
    const first = within(card).getAllByRole('button')[0];
    const label = first.textContent!.match(/^[A-Za-zÆØÅæøå ]+/)![0].trim();
    await user.click(first);
    expect(screen.getByRole('region', { name: 'Transaksjonsliste' })).toBeInTheDocument();
    expect(screen.getAllByText(label).length).toBeGreaterThan(0);
  });
});

describe('Bedrift – betalt av eier', () => {
  it('flytter et kjøp ut av privat forbruk og viser det under Bedrift', async () => {
    const { user, store } = setup('/transaksjoner');
    await user.type(screen.getByLabelText('Søk i transaksjoner'), 'Foodora');
    const list = screen.getByRole('region', { name: 'Transaksjonsliste' });
    await user.click(within(list).getAllByRole('button')[0]);
    const dialog = screen.getByRole('dialog', { name: 'Transaksjon' });
    await user.click(within(dialog).getByRole('button', { name: /Bedrift – betalt av eier/ }));
    const foodora = store.data.transactions.filter((t) => t.counterparty.toLowerCase().includes('foodora'));
    // «Husk for lignende kjøp» er på: alle Foodora-kjøp markeres
    expect(foodora.every((t) => t.amount >= 0 || t.kind === 'business')).toBe(true);
    expect(store.data.rules.some((r) => r.business)).toBe(true);
  });
});

describe('Abonnement hver N. måned', () => {
  it('lagrer intervall og regner månedlig kostnad', async () => {
    const { user, store } = setup('/abonnementer');
    await user.click(screen.getByRole('button', { name: /Legg til abonnement/ }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText('Navn'), 'Tannlegeforsikring');
    await user.type(within(dialog).getByLabelText(/Pris per trekk/), '400');
    await user.selectOptions(within(dialog).getByLabelText('Intervall'), 'months');
    await user.clear(within(dialog).getByLabelText(/Antall måneder mellom trekk/));
    await user.type(within(dialog).getByLabelText(/Antall måneder mellom trekk/), '4');
    expect(within(dialog).getByText(/100,00 kr per måned/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: /Lagre|Legg til/ }));
    expect(store.data.subscriptions.find((s) => s.name === 'Tannlegeforsikring')).toMatchObject({ interval: 'months', everyMonths: 4, amount: 40_000 });
  });
});

describe('Abonnement som bedrift', () => {
  it('flytter abonnementet og trekkene ut av private summer', async () => {
    const { user, store } = setup('/abonnementer');
    await user.click(screen.getByRole('button', { name: 'Abonnementer' }));
    const netflix = store.data.subscriptions.find((s) => s.matchKey === 'netflix')!;
    const before = store.data.subscriptions.filter((s) => s.status === 'active' && s.kind === 'subscription').length;
    await user.click(screen.getByRole('button', { name: /Netflix/ }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('switch', { name: 'Bedrift – betalt av eier' }));
    await user.click(within(dialog).getByRole('button', { name: 'Lagre' }));
    expect(store.data.subscriptions.find((s) => s.id === netflix.id)?.business).toBe(true);
    // Alle Netflix-trekk er nå bedriftsutgifter
    const charges = store.data.transactions.filter((t) => t.amount < 0 && /netflix/i.test(t.counterparty));
    expect(charges.length).toBeGreaterThan(0);
    expect(charges.every((t) => t.kind === 'business')).toBe(true);
    expect(screen.getByText(/Bedriftens abonnementer/)).toBeInTheDocument();
    expect(before).toBeGreaterThan(0);
  });
});

describe('Bedrift som egen post i oversikten', () => {
  it('viser «Abonnementer – Bedrift» separat og holder det utenfor prosentene', async () => {
    const { user, store } = setup('/');
    const card = () => screen.getByRole('heading', { name: /Utgifter per kategori/ }).closest('section')!;
    act(() => {
      const netflix = store.data.subscriptions.find((s) => s.matchKey === 'netflix')!;
      store.upsertSubscription({ ...netflix, business: true });
    });
    expect(within(card()).getByText(/Betalt for bedriften/)).toBeInTheDocument();
    const bizRow = within(card()).getByRole('button', { name: /Abonnementer – Bedrift/ });
    expect(bizRow.textContent).not.toMatch(/%/);
    await user.click(bizRow);
    expect(screen.getByRole('region', { name: 'Transaksjonsliste' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Bedrift', pressed: true })).toBeInTheDocument();
  });
});

describe('Bedriftsabonnementer nederst', () => {
  it('lister private abonnementer først og bedriftens under egen overskrift', async () => {
    const { store } = setup('/abonnementer');
    act(() => {
      const netflix = store.data.subscriptions.find((s) => s.matchKey === 'netflix')!;
      store.upsertSubscription({ ...netflix, business: true });
    });
    const items = screen.getAllByRole('listitem');
    const last = items[items.length - 1];
    expect(last.textContent).toMatch(/Netflix/);
    expect(screen.getByText('Bedrift – betalt av eier', { selector: '.list-divider' })).toBeInTheDocument();
  });
});
