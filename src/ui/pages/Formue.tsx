import { Briefcase, Building2, ChevronRight, CreditCard, Landmark, PiggyBank, Plus, RefreshCw, Wallet } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { emptyBusiness } from '../../domain/business';
import { bookedOrAvailable, cardDebt, isBankAccount, isCard } from '../../domain/calculations';
import { formatTimestamp } from '../../domain/dates';
import { netWorth } from '../../domain/netWorth';
import type { BusinessItem, Holding } from '../../domain/types';
import { useData, useStore } from '../../state/StoreContext';
import { AddAccountDialog } from '../components/AccountForms';
import { Amount } from '../components/Amount';
import { Dialog } from '../components/Dialog';
import { Initials, Notice, Segmented } from '../components/common';
import { IncompleteMark } from '../components/SumBreakdown';
import { Page } from '../Layout';
import { HoldingDialog, HoldingRow, ItemDialog, useLiveQuotes } from './Business';

const PERSONAL_LABEL: Record<BusinessItem['kind'], string> = {
  cash: 'Andre konti og kontanter',
  asset: 'Bolig, bil og andre eiendeler',
  debt: 'Lån',
};

const PERSONAL_EMPTY: Record<BusinessItem['kind'], string> = {
  cash: 'Konti som ikke er koblet til, f.eks. kontanter i Nordnet eller Coinbase.',
  asset: 'F.eks. bolig (antatt markedsverdi), hytte eller bil.',
  debt: 'F.eks. boliglån, billån eller studielån i Lånekassen.',
};

export function FormuePage() {
  const data = useData();
  const store = useStore();
  const base = data.settings.baseCurrency;
  const tz = data.settings.timeZone;
  const personal = data.personalAssets ?? emptyBusiness('Privat');
  const nw = useMemo(() => netWorth(data), [data]);
  const personalSymbols = useMemo(() => personal.holdings.map((h) => h.symbol).filter(Boolean) as string[], [personal.holdings]);
  const businessSymbols = useMemo(() => (data.business?.holdings ?? []).map((h) => h.symbol).filter(Boolean) as string[], [data.business?.holdings]);
  const live = useLiveQuotes(personalSymbols, 'personal');
  const liveBiz = useLiveQuotes(businessSymbols, 'business');
  const [withBusiness, setWithBusiness] = useState<'with' | 'without'>('with');
  const [editingHolding, setEditingHolding] = useState<Holding | 'new' | null>(null);
  const [editingItem, setEditingItem] = useState<BusinessItem | BusinessItem['kind'] | null>(null);
  const [editingOwnership, setEditingOwnership] = useState(false);
  const [addingAccount, setAddingAccount] = useState(false);
  const [params, setParams] = useSearchParams();

  // Snarvei fra Kontoer: /formue?ny=aksje åpner «Legg til aksje, fond eller krypto».
  useEffect(() => {
    if (params.get('ny') === 'aksje') {
      setEditingHolding('new');
      setParams({}, { replace: true });
    }
  }, [params, setParams]);

  const includeBiz = !!nw.business && withBusiness === 'with';
  const total = includeBiz ? nw.totalWithBusiness : nw.total;
  const accounts = data.accounts.filter((a) => a.includedInOverview);
  const bankAccounts = accounts.filter(isBankAccount);
  const cards = accounts.filter(isCard);
  const itemsOf = (kind: BusinessItem['kind']) => personal.items.filter((i) => i.kind === kind);
  const missing = [
    ...nw.bank.missing.map((m) => `${m.label} (ukjent saldo)`),
    ...nw.bank.unconvertible.map((m) => `${m.label} (mangler valutakurs)`),
    ...nw.cardDebt.missing.map((m) => `${m.label} (ukjent gjeld)`),
    ...nw.personal.missing,
  ];

  const parts = [
    { key: 'bank', label: 'Bank', value: nw.bank.amount, color: 'var(--accent)' },
    { key: 'inv', label: 'Investeringer', value: nw.personal.shares + nw.personal.cash, color: 'var(--positive)' },
    { key: 'other', label: 'Andre eiendeler', value: nw.personal.otherAssets, color: 'var(--warning)' },
    ...(includeBiz ? [{ key: 'biz', label: 'Bedrift (din andel)', value: nw.businessShare, color: '#b28cff' }] : []),
  ].filter((p) => p.value > 0);
  const partsSum = parts.reduce((s, p) => s + p.value, 0);

  return (
    <Page title="Formue">
      <section className="hero" aria-labelledby="nw-total">
        <p className="label" id="nw-total">
          <PiggyBank size={16} aria-hidden="true" /> Nettoformue i ditt navn <IncompleteMark complete={nw.complete} />
        </p>
        <p className="big">
          <Amount value={total} currency={base} />
        </p>
        <div className="hero-meta">
          <span>
            Eiendeler <Amount value={nw.assets + (includeBiz && nw.businessShare > 0 ? nw.businessShare : 0)} currency={base} />
          </span>
          <span>
            Gjeld <Amount value={nw.debt + (includeBiz && nw.businessShare < 0 ? -nw.businessShare : 0)} currency={base} />
          </span>
          {nw.personal.valuations.some((v) => v.dayChange !== null) && (
            <span>
              Investeringer i dag <Amount value={nw.personal.dayChange} currency={base} signed />
            </span>
          )}
        </div>
        {nw.business && (
          <div className="hero-actions">
            <Segmented
              label="Bedriften i totalen"
              value={withBusiness}
              onChange={setWithBusiness}
              options={[
                { value: 'with', label: 'Med bedriften' },
                { value: 'without', label: 'Uten bedriften' },
              ]}
            />
          </div>
        )}
      </section>

      {missing.length > 0 && (
        <Notice tone="warn" title="Totalen er et minimum">
          Ikke med: {missing.join(', ')}.
        </Notice>
      )}
      {live.error && <Notice tone="warn">{live.error}</Notice>}

      {partsSum > 0 && (
        <section className="card" aria-labelledby="comp-h">
          <div className="card-head">
            <h2 id="comp-h">Hva formuen består av</h2>
          </div>
          <div className="stacked" role="img" aria-label={parts.map((p) => `${p.label} ${Math.round((p.value / partsSum) * 100)} prosent`).join(', ')}>
            {parts.map((p) => (
              <span key={p.key} style={{ width: `${(p.value / partsSum) * 100}%`, background: p.color }} />
            ))}
          </div>
          <ul className="comp-list">
            {parts.map((p) => (
              <li key={p.key}>
                <span className="sw" style={{ background: p.color }} aria-hidden="true" />
                <span className="comp-label">{p.label}</span>
                <span className="comp-pct subtle">{Math.round((p.value / partsSum) * 100)} %</span>
                <Amount value={p.value} currency={base} />
              </li>
            ))}
            {nw.debt > 0 && (
              <li>
                <span className="sw" style={{ background: 'var(--danger)' }} aria-hidden="true" />
                <span className="comp-label">Gjeld</span>
                <span className="comp-pct subtle" />
                <span>
                  − <Amount value={nw.debt} currency={base} />
                </span>
              </li>
            )}
          </ul>
        </section>
      )}

      <div className="grid cols-2">
        <section className="card flush" aria-labelledby="nw-bank">
          <div className="card-head" style={{ padding: '18px 18px 0' }}>
            <h2 id="nw-bank">Bankkontoer</h2>
            <button type="button" className="btn small" onClick={() => setAddingAccount(true)} aria-label="Legg til konto, f.eks. BSU eller sparekonto">
              <Plus size={16} aria-hidden="true" /> Konto
            </button>
          </div>
          {bankAccounts.length ? (
            <ul className="list" style={{ marginTop: 8 }}>
              {bankAccounts.map((a) => (
                <li key={a.id}>
                  <Link to={`/kontoer/${a.id}`} className="list-item">
                    <Initials name={a.bankName} />
                    <span className="li-main">
                      <span className="li-title" style={{ display: 'block' }}>
                        {a.name}
                      </span>
                      <span className="li-sub" style={{ display: 'block' }}>
                        {a.bankName}
                        {a.bookedBalance === null && a.availableBalance !== null ? ' · tilgjengelig saldo' : ''}
                      </span>
                    </span>
                    <span className="li-end">
                      <Amount value={bookedOrAvailable(a)} currency={a.currency} />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="small muted" style={{ padding: '10px 18px 18px' }}>
              Ingen kontoer ennå. <Link to="/kontoer">Koble til bank</Link>
            </p>
          )}
          <p className="xsmall subtle" style={{ padding: '10px 18px 16px' }}>
            Hentes automatisk fra bankene du har koblet til. BSU- og sparekontoer i andre banker legger du til med «Konto». <Link to="/kontoer">Alle kontoer</Link>
          </p>
        </section>

        <section className="card flush" aria-labelledby="nw-inv">
          <div className="card-head" style={{ padding: '18px 18px 0' }}>
            <h2 id="nw-inv">Aksjer, fond og krypto</h2>
            <div className="row" style={{ gap: 6 }}>
              {personalSymbols.length > 0 && live.available && (
                <button type="button" className="icon-btn" aria-label="Oppdater kurser" onClick={() => live.refresh()} disabled={live.loading}>
                  <RefreshCw size={16} className={live.loading ? 'spin' : ''} aria-hidden="true" />
                </button>
              )}
              <button type="button" className="btn small" onClick={() => setEditingHolding('new')}>
                <Plus size={16} aria-hidden="true" /> Legg til
              </button>
            </div>
          </div>
          {nw.personal.valuations.length ? (
            <ul className="list" style={{ marginTop: 8 }}>
              {nw.personal.valuations.map((v) => (
                <li key={v.holding.id}>
                  <HoldingRow v={v} onOpen={() => setEditingHolding(v.holding)} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="small muted" style={{ padding: '10px 18px 0' }}>
              Legg inn beholdningen din fra Nordnet, DNB, Coinbase eller andre. Søk opp aksjen, fondet (f.eks. «KLP AksjeGlobal») eller kryptovalutaen (f.eks. «Bitcoin»), og oppgi antall andeler – verdien følger markedskursen.
            </p>
          )}
          <p className="xsmall subtle" style={{ padding: '10px 18px 16px' }}>
            {live.lastFetch
              ? `Kurser fra Yahoo Finance, hentet ${formatTimestamp(live.lastFetch, tz).split(', ')[1] ?? ''}. Kan være forsinket.`
              : 'Kurser fra Yahoo Finance, oppdateres hvert minutt mens siden er åpen. Kan være forsinket.'}
          </p>
        </section>
      </div>

      <div className="grid cols-3">
        {(['cash', 'asset', 'debt'] as const).map((kind) => (
          <section key={kind} className="card flush" aria-labelledby={`nw-${kind}`}>
            <div className="card-head" style={{ padding: '18px 18px 0' }}>
              <h2 id={`nw-${kind}`}>{PERSONAL_LABEL[kind]}</h2>
              <button type="button" className="btn small" onClick={() => setEditingItem(kind)} aria-label={`Legg til ${PERSONAL_LABEL[kind].toLowerCase()}`}>
                <Plus size={16} aria-hidden="true" />
              </button>
            </div>
            <ul className="list" style={{ marginTop: 8 }}>
              {itemsOf(kind).map((i) => (
                <li key={i.id}>
                  <button type="button" className="list-item" onClick={() => setEditingItem(i)}>
                    <span className="avatar" aria-hidden="true">
                      {kind === 'cash' ? <Landmark size={18} /> : kind === 'asset' ? <Building2 size={18} /> : <Wallet size={18} />}
                    </span>
                    <span className="li-main">
                      <span className="li-title" style={{ display: 'block' }}>
                        {i.name}
                      </span>
                      <span className="li-sub" style={{ display: 'block' }}>
                        {[i.institution, `oppdatert ${formatTimestamp(i.updatedAt, tz).split(',')[0]}`].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                    <span className="li-end">
                      <Amount value={i.amount} currency={i.currency} />
                    </span>
                  </button>
                </li>
              ))}
              {kind === 'debt' &&
                cards.map((c) => (
                  <li key={c.id}>
                    <Link to={`/kort/${c.id}`} className="list-item">
                      <span className="avatar" aria-hidden="true">
                        <CreditCard size={18} />
                      </span>
                      <span className="li-main">
                        <span className="li-title" style={{ display: 'block' }}>
                          {c.name}
                        </span>
                        <span className="li-sub" style={{ display: 'block' }}>
                          Kredittkort · hentes automatisk
                        </span>
                      </span>
                      <span className="li-end">
                        <Amount value={cardDebt(c)} currency={c.currency} />
                      </span>
                    </Link>
                  </li>
                ))}
            </ul>
            {!itemsOf(kind).length && !(kind === 'debt' && cards.length) && (
              <p className="small muted" style={{ padding: '0 18px 18px' }}>
                {PERSONAL_EMPTY[kind]}
              </p>
            )}
          </section>
        ))}
      </div>

      <section className="card flush" aria-labelledby="nw-biz">
        <div className="card-head" style={{ padding: '18px 18px 0' }}>
          <h2 id="nw-biz">Bedrift</h2>
          {nw.business && (
            <button type="button" className="btn small" onClick={() => setEditingOwnership(true)}>
              Eierandel {nw.ownership.toLocaleString('nb-NO')} %
            </button>
          )}
        </div>
        {nw.business ? (
          <ul className="list" style={{ marginTop: 8 }}>
            <li>
              <Link to="/bedrift" className="list-item">
                <span className="avatar" aria-hidden="true">
                  <Briefcase size={18} />
                </span>
                <span className="li-main">
                  <span className="li-title" style={{ display: 'block' }}>
                    {data.business!.name}
                  </span>
                  <span className="li-sub" style={{ display: 'block' }}>
                    Hele bedriften <Amount value={nw.business.total} currency={base} />
                    {liveBiz.loading ? ' · henter kurser …' : ''}
                  </span>
                </span>
                <span className="li-end" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                  <Amount value={nw.businessShare} currency={base} />
                  <span className="xsmall subtle">din andel</span>
                </span>
                <ChevronRight size={18} aria-hidden="true" className="subtle" />
              </Link>
            </li>
          </ul>
        ) : (
          <p className="small muted" style={{ padding: '10px 18px 18px' }}>
            <Link to="/bedrift">Legg inn bedriften</Link> for å se din andel av verdien her.
          </p>
        )}
        <p className="xsmall subtle" style={{ padding: '10px 18px 16px' }}>
          Bedriften er et eget rettssubjekt. For et AS eier du aksjene, ikke pengene i selskapet – derfor vises den som egen linje, og du kan se formuen med og uten. Verdien er bokført/antatt verdi, ikke skattemessig formuesverdi.
        </p>
      </section>

      <p className="xsmall subtle">
        Formuen er et øyeblikksbilde basert på siste bankoppdatering, markedskurser og verdiene du selv har lagt inn. Den er ikke skattemessig formue (der gjelder bl.a. verdsettelsesrabatter på bolig og aksjer).
      </p>

      {editingHolding && (
        <HoldingDialog
          key={editingHolding === 'new' ? 'new' : editingHolding.id}
          scope="personal"
          holding={editingHolding === 'new' ? null : editingHolding}
          onClose={() => setEditingHolding(null)}
          onSaved={() => {
            setEditingHolding(null);
            void live.refresh();
          }}
        />
      )}
      {editingItem && (
        <ItemDialog
          key={typeof editingItem === 'string' ? editingItem : editingItem.id}
          scope="personal"
          item={typeof editingItem === 'string' ? null : editingItem}
          kind={typeof editingItem === 'string' ? editingItem : editingItem.kind}
          onClose={() => setEditingItem(null)}
        />
      )}
      <AddAccountDialog open={addingAccount} initialType="bsu" onClose={() => setAddingAccount(false)} />
      {editingOwnership && (
        <OwnershipDialog
          value={nw.ownership}
          onClose={() => setEditingOwnership(false)}
          onSave={(p) => {
            store.setBusinessOwnership(p);
            setEditingOwnership(false);
          }}
        />
      )}
    </Page>
  );
}

function OwnershipDialog({ value, onClose, onSave }: { value: number; onClose: () => void; onSave: (p: number) => void }) {
  const [text, setText] = useState(String(value).replace('.', ','));
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog open onClose={onClose} title="Din eierandel i bedriften">
      <form
        className="stack"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          const n = Number(text.replace(/[\s %]/g, '').replace(',', '.'));
          if (!text.trim() || !Number.isFinite(n) || n < 0 || n > 100) return setError('Oppgi en prosent mellom 0 og 100.');
          onSave(n);
        }}
      >
        <label className="field">
          <span>Eierandel (%)</span>
          <input id="ownership" className="input" inputMode="decimal" value={text} onChange={(e) => setText(e.target.value)} />
          <span className="hint">Eier du selskapet alene (eller det er et ENK), er andelen 100 %.</span>
        </label>
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
