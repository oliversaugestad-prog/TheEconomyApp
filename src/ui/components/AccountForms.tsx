import { useState, type FormEvent } from 'react';
import { parseAmount, formatMoney } from '../../domain/money';
import type { Account, AccountType } from '../../domain/types';
import { useStore } from '../../state/StoreContext';
import { Dialog } from './Dialog';
import { Notice } from './common';

export const ACCOUNT_TYPE_LABEL: Record<AccountType, string> = {
  checking: 'Brukskonto',
  savings: 'Sparekonto',
  bsu: 'BSU',
  credit_card: 'Kredittkort',
};

const CURRENCIES = ['NOK', 'EUR', 'SEK', 'DKK', 'USD', 'GBP'];

function toInput(v: number | null, currency: string) {
  if (v === null) return '';
  return formatMoney(v, currency).replace(/[^\d,\-−\s]/g, '').replace(/−/g, '-').trim();
}

/** Legg til en manuell konto eller et kort. Ber aldri om komplette kontonummer eller kortdetaljer. */
export function AddAccountDialog({ open, onClose, onCreated, initialType = 'checking' }: { open: boolean; onClose: () => void; onCreated?: (a: Account) => void; initialType?: AccountType }) {
  const store = useStore();
  const [bankName, setBank] = useState('');
  const [name, setName] = useState('');
  const [type, setType] = useState<AccountType>(initialType);
  const [currency, setCurrency] = useState('NOK');
  const [booked, setBooked] = useState('');
  const [available, setAvailable] = useState('');
  const [last4, setLast4] = useState('');
  const [limit, setLimit] = useState('');
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setBank('');
    setName('');
    setType(initialType);
    setCurrency('NOK');
    setBooked('');
    setAvailable('');
    setLast4('');
    setLimit('');
    setError(null);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!bankName.trim() || !name.trim()) return setError('Fyll inn bank og kontonavn.');
    if (last4 && !/^\d{4}$/.test(last4)) return setError('Oppgi nøyaktig fire siffer – ikke hele nummeret.');
    let bookedMinor = booked.trim() ? parseAmount(booked, currency) : null;
    const availMinor = available.trim() ? parseAmount(available, currency) : null;
    const limitMinor = limit.trim() ? parseAmount(limit, currency) : null;
    if ((booked.trim() && bookedMinor === null) || (available.trim() && availMinor === null) || (limit.trim() && limitMinor === null)) {
      return setError('Et av beløpene er ugyldig. Bruk f.eks. 12 345,67.');
    }
    // For kort oppgis gjeld som positivt tall; saldo lagres negativt.
    if (type === 'credit_card' && bookedMinor !== null) bookedMinor = -Math.abs(bookedMinor);
    const acc = store.addManualAccount({
      bankName: bankName.trim(),
      name: name.trim(),
      type,
      currency,
      bookedBalance: bookedMinor,
      availableBalance: type === 'credit_card' ? null : availMinor,
      last4,
      creditLimit: type === 'credit_card' ? limitMinor : null,
    });
    reset();
    onCreated?.(acc);
    onClose();
  };

  return (
    <Dialog open={open} onClose={onClose} title="Legg til konto manuelt">
      <form className="stack" onSubmit={submit} noValidate>
        <p className="small muted">
          For banker som ikke kan kobles til. Du oppdaterer saldoen selv, og kan importere transaksjoner fra CSV. Oppgi aldri passord, fullt kontonummer eller kortnummer.
        </p>
        <div className="form-grid two">
          <label className="field">
            <span>Bank / utsteder</span>
            <input className="input" value={bankName} onChange={(e) => setBank(e.target.value)} placeholder={type === 'credit_card' ? 'F.eks. American Express' : 'F.eks. Lokalbanken'} autoComplete="off" required />
          </label>
          <label className="field">
            <span>Kontonavn</span>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder={type === 'credit_card' ? 'F.eks. Amex Gold' : 'F.eks. Brukskonto'} autoComplete="off" required />
          </label>
          <label className="field">
            <span>Type</span>
            <select className="select" value={type} onChange={(e) => setType(e.target.value as AccountType)}>
              {(Object.keys(ACCOUNT_TYPE_LABEL) as AccountType[]).map((t) => (
                <option key={t} value={t}>
                  {ACCOUNT_TYPE_LABEL[t]}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Valuta</span>
            <select className="select" value={currency} onChange={(e) => setCurrency(e.target.value)}>
              {CURRENCIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>{type === 'credit_card' ? 'Utestående gjeld' : 'Bokført saldo'}</span>
            <input className="input" inputMode="decimal" value={booked} onChange={(e) => setBooked(e.target.value)} placeholder="Tomt = ukjent" />
          </label>
          {type === 'credit_card' ? (
            <label className="field">
              <span>Kredittgrense</span>
              <input className="input" inputMode="decimal" value={limit} onChange={(e) => setLimit(e.target.value)} placeholder="Valgfritt" />
            </label>
          ) : (
            <label className="field">
              <span>Tilgjengelig saldo</span>
              <input className="input" inputMode="decimal" value={available} onChange={(e) => setAvailable(e.target.value)} placeholder="Valgfritt" />
            </label>
          )}
          <label className="field">
            <span>Siste fire siffer (valgfritt)</span>
            <input className="input" inputMode="numeric" maxLength={4} value={last4} onChange={(e) => setLast4(e.target.value.replace(/\D/g, ''))} placeholder="1234" />
          </label>
        </div>
        <p className="hint">Tomme saldofelt lagres som ukjent – ikke som 0 kr – og totalsummer merkes som ufullstendige.</p>
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
        <Notice tone="warn">Manuelle data lagres kun i denne nettleseren og er ikke kryptert. Ikke bruk en delt datamaskin.</Notice>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn ghost" onClick={onClose}>
            Avbryt
          </button>
          <button type="submit" className="btn primary">
            Legg til
          </button>
        </div>
      </form>
    </Dialog>
  );
}

/** Oppdater saldo på en manuell konto. */
export function EditBalanceDialog({ account, onClose }: { account: Account | null; onClose: () => void }) {
  const store = useStore();
  const isCard = account?.type === 'credit_card';
  const [booked, setBooked] = useState(() =>
    account ? toInput(isCard && account.bookedBalance !== null ? -account.bookedBalance : account.bookedBalance, account.currency) : '',
  );
  const [available, setAvailable] = useState(() => (account ? toInput(account.availableBalance, account.currency) : ''));
  const [error, setError] = useState<string | null>(null);
  if (!account) return null;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    let b = booked.trim() ? parseAmount(booked, account.currency) : null;
    const a = available.trim() ? parseAmount(available, account.currency) : null;
    if ((booked.trim() && b === null) || (available.trim() && a === null)) return setError('Ugyldig beløp.');
    if (isCard && b !== null) b = -Math.abs(b);
    store.updateBalance(account.id, b, isCard ? account.availableBalance : a);
    onClose();
  };
  return (
    <Dialog open onClose={onClose} title={`Oppdater saldo – ${account.name}`}>
      <form className="stack" onSubmit={submit} noValidate>
        <div className="form-grid two">
          <label className="field">
            <span>{isCard ? 'Utestående gjeld' : 'Bokført saldo'} ({account.currency})</span>
            <input className="input" inputMode="decimal" value={booked} onChange={(e) => setBooked(e.target.value)} placeholder="Tomt = ukjent" />
          </label>
          {!isCard && (
            <label className="field">
              <span>Tilgjengelig ({account.currency})</span>
              <input className="input" inputMode="decimal" value={available} onChange={(e) => setAvailable(e.target.value)} placeholder="Tomt = ikke oppgitt" />
            </label>
          )}
        </div>
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn ghost" onClick={onClose}>
            Avbryt
          </button>
          <button type="submit" className="btn primary">
            Lagre
          </button>
        </div>
      </form>
    </Dialog>
  );
}
