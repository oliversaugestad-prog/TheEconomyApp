import { CreditCard, FileUp, Pencil, Plus, Receipt } from 'lucide-react';
import { useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { availableCredit, cardDebt, reservedAmount, sortByDateDesc } from '../../domain/calculations';
import { formatDate, formatMonth, monthKey } from '../../domain/dates';
import { formatMoney, parseAmount, sumMoney } from '../../domain/money';
import type { Account, CardStatement, Transaction } from '../../domain/types';
import { useData, useStore, useToday } from '../../state/StoreContext';
import { Amount } from '../components/Amount';
import { AddAccountDialog } from '../components/AccountForms';
import { Dialog } from '../components/Dialog';
import { ConnectionBadge, DemoBadge, Empty, LastUpdated, Notice } from '../components/common';
import { IncompleteMark } from '../components/SumBreakdown';
import { TransactionDetail } from '../components/TransactionViews';
import { Page } from '../Layout';
import { GroupedTransactions } from './AccountDetail';

/** Kortfarger brukeren kan velge mellom. */
export const CARD_COLORS: { id: string; label: string }[] = [
  { id: 'grad-0', label: 'Blå' },
  { id: 'grad-1', label: 'Grønn' },
  { id: 'grad-2', label: 'Lilla' },
  { id: 'grad-3', label: 'Grafitt' },
  { id: 'grad-4', label: 'Korall' },
  { id: 'grad-5', label: 'Gull' },
  { id: 'grad-6', label: 'Rosa' },
  { id: 'grad-7', label: 'Sort' },
  { id: 'grad-8', label: 'Sølv' },
];

function gradientFor(card: Pick<Account, 'id' | 'color'>): string {
  if (card.color && CARD_COLORS.some((c) => c.id === card.color)) return card.color;
  let h = 0;
  for (const c of card.id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return `grad-${h % 4}`;
}

/** Kortkjøp i inneværende måned (bokført og reservert), fratrukket refusjoner. */
function monthPurchases(card: Account, transactions: Transaction[], month: string): number {
  return transactions
    .filter((t) => t.accountId === card.id && monthKey(t.bookingDate) === month && (t.kind === 'normal' || t.kind === 'refund'))
    .reduce((s, t) => s - t.amount, 0);
}

export function PayCard({ card, link }: { card: Account; link?: boolean }) {
  const content = (
    <>
      <div className="spread">
        <span className="pc-issuer">{card.card?.issuer ?? card.bankName}</span>
        {card.isDemo && (
          <span className="badge demo" style={{ background: 'rgba(0,0,0,0.35)' }}>
            DEMO
          </span>
        )}
      </div>
      <div>
        <span className="pc-chip" aria-hidden="true" style={{ display: 'block', marginBottom: 10 }} />
        <p className="xsmall" style={{ opacity: 0.85 }}>
          Utestående gjeld
        </p>
        <p className="pc-amount">
          <Amount value={cardDebt(card)} currency={card.currency} />
        </p>
      </div>
      <div className="spread">
        <span style={{ fontWeight: 600 }}>{card.name}</span>
        <span className="pc-number" aria-label={`Kort som slutter på ${card.card?.last4 ?? 'ukjent'}`}>
          •••• {card.card?.last4 ?? '····'}
        </span>
      </div>
    </>
  );
  return link ? (
    <Link to={`/kort/${card.id}`} className={`pay-card ${gradientFor(card)}`} aria-label={`${card.name}, se detaljer`}>
      {content}
    </Link>
  ) : (
    <div className={`pay-card ${gradientFor(card)}`}>{content}</div>
  );
}

export function CardsPage() {
  const data = useData();
  const today = useToday();
  const base = data.settings.baseCurrency;
  const cards = data.accounts.filter((a) => a.type === 'credit_card');
  const included = cards.filter((c) => c.includedInOverview);
  const debt = sumMoney(included.map((c) => ({ id: c.id, label: c.name, amount: cardDebt(c), currency: c.currency })), base, data.rates);
  const reserved = sumMoney(included.map((c) => ({ id: c.id, label: c.name, amount: reservedAmount(c.id, data.transactions), currency: c.currency })), base, data.rates);
  const month = monthKey(today);
  const [adding, setAdding] = useState(false);
  const navigate = useNavigate();

  return (
    <Page
      title="Kredittkort"
      actions={
        <button type="button" className="icon-btn" aria-label="Legg til kort manuelt" onClick={() => setAdding(true)}>
          <Plus size={20} aria-hidden="true" />
        </button>
      }
    >
      <AddAccountDialog open={adding} initialType="credit_card" onClose={() => setAdding(false)} onCreated={(a) => navigate(`/kort/${a.id}`)} />
      <div className="row wrap">
        <button type="button" className="btn small" onClick={() => setAdding(true)}>
          <Plus size={16} aria-hidden="true" /> Legg til kort
        </button>
        <Link to={`/kontoer/import${cards.find((c) => c.source !== 'bank' && !c.isDemo) ? `?konto=${cards.find((c) => c.source !== 'bank' && !c.isDemo)!.id}` : ''}`} className="btn small">
          <FileUp size={16} aria-hidden="true" /> Importer CSV (f.eks. Amex)
        </Link>
      </div>
      {cards.length === 0 ? (
        <div className="card">
          <Empty icon={<CreditCard size={24} />} title="Ingen kredittkort" action={<button type="button" className="btn small" onClick={() => setAdding(true)}>Legg til kort manuelt</button>}>
            Kort du legger til manuelt eller kobler til, vises her.
          </Empty>
        </div>
      ) : (
        <>
          <section className="card">
            <div className="grid cols-3" style={{ gap: 12 }}>
              <div>
                <p className="small muted">
                  Samlet gjeld nå <IncompleteMark complete={debt.complete} />
                </p>
                <p className="num" style={{ fontSize: '1.6rem', fontWeight: 650, letterSpacing: '-0.02em' }}>
                  <Amount value={debt.amount} currency={base} />
                </p>
                <p className="xsmall subtle">Bokført utestående på {included.length} kort</p>
              </div>
              <div>
                <p className="small muted">Reserverte kjøp</p>
                <p className="num" style={{ fontSize: '1.2rem', fontWeight: 600 }}>
                  <Amount value={reserved.amount} currency={base} />
                </p>
                <p className="xsmall subtle">Ikke bokført ennå – kommer i tillegg</p>
              </div>
              <div>
                <p className="small muted">Kredittgrense</p>
                <p className="small" style={{ marginTop: 4 }}>
                  Kredittgrense og tilgjengelig kreditt er lånte penger og regnes aldri med i kontosaldoen din.
                </p>
              </div>
            </div>
          </section>

          <div className="grid cols-2">
            {cards.map((c) => {
              const limit = c.card?.creditLimit ?? null;
              const debtNow = cardDebt(c);
              const avail = availableCredit(c, data.transactions);
              const st = c.card?.statement;
              const conn = data.connections.find((x) => x.id === c.connectionId);
              return (
                <section key={c.id} className="card stack" aria-label={c.name}>
                  <PayCard card={c} link />
                  <div className="row wrap" style={{ gap: 8 }}>
                    {conn && <ConnectionBadge connection={conn} />}
                    {!c.includedInOverview && <span className="badge">Ikke med i oversikten</span>}
                  </div>
                  <dl className="dl">
                    <dt>Gjeld nå (bokført)</dt>
                    <dd>
                      <Amount value={debtNow} currency={c.currency} />
                    </dd>
                    <dt>Kortkjøp i {formatMonth(month).split(' ')[0]}</dt>
                    <dd>
                      <Amount value={monthPurchases(c, data.transactions, month)} currency={c.currency} />
                    </dd>
                    <dt>Siste faktura</dt>
                    <dd>{st?.amount != null ? <Amount value={st.amount} currency={c.currency} /> : <span className="subtle">Ikke tilgjengelig</span>}</dd>
                    <dt>Tilgjengelig kreditt</dt>
                    <dd>
                      <Amount value={avail} currency={c.currency} unknownLabel="Ikke tilgjengelig" />
                    </dd>
                  </dl>
                  {limit !== null && debtNow !== null && (
                    <div className="stack-sm">
                      <div className="progress" role="img" aria-label={`Brukt ${Math.round((Math.max(0, debtNow) / limit) * 100)} prosent av kredittgrensen`}>
                        <span style={{ width: `${Math.min(100, (Math.max(0, debtNow) / limit) * 100)}%` }} />
                      </div>
                      <p className="xsmall subtle">
                        Brukt {Math.round((Math.max(0, debtNow) / limit) * 100)} % av grensen på {formatMoney(limit, c.currency)}
                      </p>
                    </div>
                  )}
                  <Link to={`/kort/${c.id}`} className="btn small">
                    Detaljer og transaksjoner
                  </Link>
                </section>
              );
            })}
          </div>
        </>
      )}
    </Page>
  );
}

export function CardDetailPage() {
  const { id } = useParams();
  const data = useData();
  const store = useStore();
  const today = useToday();
  const card = data.accounts.find((a) => a.id === id && a.type === 'credit_card');
  const [openTx, setOpenTx] = useState<Transaction | null>(null);
  const [editStatement, setEditStatement] = useState(false);
  const [editingCard, setEditingCard] = useState(false);
  const navigate = useNavigate();
  const txs = useMemo(() => (card ? sortByDateDesc(data.transactions.filter((t) => t.accountId === card.id)) : []), [data.transactions, card]);

  if (!card) {
    return (
      <Page title="Kort" back={{ to: '/kort', label: 'Tilbake til kort' }}>
        <div className="card">
          <Empty icon={<CreditCard size={22} />} title="Fant ikke kortet" />
        </div>
      </Page>
    );
  }
  const conn = data.connections.find((c) => c.id === card.connectionId);
  const st = card.card?.statement ?? null;
  const month = monthKey(today);

  return (
    <Page
      title={card.name}
      back={{ to: '/kort', label: 'Tilbake til kort' }}
      actions={
        <button type="button" className="btn small" onClick={() => setEditingCard(true)}>
          <Pencil size={16} aria-hidden="true" /> Rediger
        </button>
      }
    >
      {editingCard && <EditCardDialog card={card} manual={!conn || conn.providerId === 'manual'} onClose={() => setEditingCard(false)} onDeleted={() => navigate('/kort')} />}
      <div className="grid cols-2">
        <div className="stack">
          <PayCard card={card} />
          <div className="row wrap" style={{ gap: 8 }}>
            {conn && <ConnectionBadge connection={conn} />}
            {card.isDemo && <DemoBadge />}
            {card.balanceUpdatedAt && (
              <span className="xsmall subtle">
                <LastUpdated ts={card.balanceUpdatedAt} />
              </span>
            )}
          </div>
          {conn && conn.status !== 'ok' && conn.providerId !== 'manual' && (
            <Notice tone="warn">Tallene er fra siste vellykkede oppdatering og kan være utdaterte. {conn.error}</Notice>
          )}
        </div>
        <section className="card">
          <h2 style={{ marginBottom: 6 }}>Status</h2>
          <dl className="dl">
            <dt>Gjeld nå (bokført)</dt>
            <dd>
              <Amount value={cardDebt(card)} currency={card.currency} />
            </dd>
            <dt>Reserverte kjøp</dt>
            <dd>
              <Amount value={reservedAmount(card.id, data.transactions)} currency={card.currency} />
            </dd>
            <dt>Kortkjøp i {formatMonth(month)}</dt>
            <dd>
              <Amount value={monthPurchases(card, data.transactions, month)} currency={card.currency} />
            </dd>
            <dt>Kredittgrense</dt>
            <dd>
              <Amount value={card.card?.creditLimit ?? null} currency={card.currency} unknownLabel="Ikke tilgjengelig" />
            </dd>
            <dt>Tilgjengelig kreditt</dt>
            <dd>
              <Amount value={availableCredit(card, data.transactions)} currency={card.currency} unknownLabel="Ikke tilgjengelig" />
            </dd>
            <dt>Utsteder</dt>
            <dd>{card.card?.issuer}</dd>
            <dt>Kortnummer</dt>
            <dd>•••• {card.card?.last4 || '····'}</dd>
          </dl>
          <p className="xsmall subtle" style={{ marginTop: 10 }}>
            «Gjeld nå» er alt som er bokført og ikke betalt. «Kortkjøp» er kjøp denne måneden (inkl. reserverte, minus refusjoner). «Faktura» er beløpet på siste faktura fra utsteder.
          </p>
        </section>
      </div>

      <div className="row wrap">
        <Link to={`/kontoer/import?konto=${card.id}`} className="btn small">
          <FileUp size={16} aria-hidden="true" /> Importer transaksjoner (CSV)
        </Link>
      </div>

      <section className="card">
        <div className="card-head">
          <h2>Siste faktura</h2>
          <button type="button" className="btn small" onClick={() => setEditStatement(true)}>
            <Pencil size={16} aria-hidden="true" /> {st ? 'Endre' : 'Registrer manuelt'}
          </button>
        </div>
        {st ? (
          <>
            <dl className="dl">
              <dt>Fakturabeløp</dt>
              <dd>
                <Amount value={st.amount} currency={card.currency} unknownLabel="Ikke tilgjengelig" />
              </dd>
              <dt>Forfallsdato</dt>
              <dd>{st.dueDate ? formatDate(st.dueDate, 'long') : <span className="subtle">Ikke tilgjengelig</span>}</dd>
              <dt>Minstebeløp</dt>
              <dd>
                <Amount value={st.minimumPayment} currency={card.currency} unknownLabel="Ikke tilgjengelig" />
              </dd>
            </dl>
            <p className="xsmall subtle" style={{ marginTop: 10 }}>
              Kilde: {st.source === 'provider' ? 'kortutsteder' : 'registrert manuelt av deg'}. <LastUpdated ts={st.updatedAt} prefix="Oppdatert" />
            </p>
          </>
        ) : (
          <Notice title="Ikke tilgjengelig">
            Kortutstederen oppgir ikke fakturaopplysninger via denne tilkoblingen. Saldo beregner dem ikke selv. Du kan registrere fakturabeløp og forfall manuelt fra fakturaen din.
          </Notice>
        )}
      </section>

      <section className="card flush">
        <div className="card-head" style={{ padding: '18px 18px 4px' }}>
          <h2>Transaksjoner</h2>
          <Link className="link" to={`/transaksjoner?konto=${card.id}`}>
            Filtrer og søk
          </Link>
        </div>
        {txs.length ? (
          <GroupedTransactions transactions={txs} onOpen={setOpenTx} showAccount={false} />
        ) : (
          <Empty icon={<Receipt size={22} />} title="Ingen transaksjoner" />
        )}
      </section>

      {openTx && <TransactionDetail key={openTx.id} tx={openTx} onClose={() => setOpenTx(null)} />}
      {editStatement && (
        <StatementDialog
          card={card}
          onClose={() => setEditStatement(false)}
          onSave={(s) => {
            store.updateCard(card.id, { statement: s });
            setEditStatement(false);
          }}
        />
      )}
    </Page>
  );
}

function StatementDialog({ card, onClose, onSave }: { card: Account; onClose: () => void; onSave: (s: CardStatement | null) => void }) {
  const st = card.card?.statement;
  const fromProvider = st?.source === 'provider';
  const toInput = (v: number | null | undefined) => (v == null ? '' : formatMoney(v, card.currency).replace(/[^\d,]/g, ''));
  const [amount, setAmount] = useState(toInput(st?.amount));
  const [min, setMin] = useState(toInput(st?.minimumPayment));
  const [due, setDue] = useState(st?.dueDate ?? '');
  const [error, setError] = useState<string | null>(null);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const a = amount.trim() ? parseAmount(amount, card.currency) : null;
    const m = min.trim() ? parseAmount(min, card.currency) : null;
    if ((amount.trim() && a === null) || (min.trim() && m === null)) return setError('Ugyldig beløp.');
    onSave({ amount: a === null ? null : Math.abs(a), minimumPayment: m === null ? null : Math.abs(m), dueDate: due || null, source: 'manual', updatedAt: new Date().toISOString() });
  };
  return (
    <Dialog open onClose={onClose} title="Fakturaopplysninger">
      <form className="stack" onSubmit={submit} noValidate>
        {fromProvider && <Notice tone="warn">Opplysningene kommer nå fra kortutstederen. Lagrer du, merkes de som registrert manuelt av deg.</Notice>}
        <div className="form-grid two">
          <label className="field">
            <span>Fakturabeløp ({card.currency})</span>
            <input className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Tomt = ikke tilgjengelig" />
          </label>
          <label className="field">
            <span>Forfallsdato</span>
            <input className="input" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
          </label>
          <label className="field">
            <span>Minstebeløp ({card.currency})</span>
            <input className="input" inputMode="decimal" value={min} onChange={(e) => setMin(e.target.value)} placeholder="Valgfritt" />
          </label>
        </div>
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
        <div className="row wrap" style={{ justifyContent: 'space-between' }}>
          {st && !fromProvider ? (
            <button type="button" className="btn danger small" onClick={() => onSave(null)}>
              Fjern opplysninger
            </button>
          ) : (
            <span />
          )}
          <div className="row">
            <button type="button" className="btn ghost" onClick={onClose}>
              Avbryt
            </button>
            <button type="submit" className="btn primary">
              Lagre
            </button>
          </div>
        </div>
      </form>
    </Dialog>
  );
}

function EditCardDialog({ card, manual, onClose, onDeleted }: { card: Account; manual: boolean; onClose: () => void; onDeleted: () => void }) {
  const store = useStore();
  const [name, setName] = useState(card.name);
  const [issuer, setIssuer] = useState(card.card?.issuer ?? card.bankName);
  const [last4, setLast4] = useState(card.card?.last4 ?? '');
  const [limit, setLimit] = useState(card.card?.creditLimit != null ? formatMoney(card.card.creditLimit, card.currency).replace(/[^\d,\s]/g, '').trim() : '');
  const [debt, setDebt] = useState(card.bookedBalance != null ? formatMoney(-card.bookedBalance, card.currency).replace(/[^\d,\-−\s]/g, '').replace(/−/g, '-').trim() : '');
  const [color, setColor] = useState(gradientFor(card));
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setError('Gi kortet et navn.');
    if (last4 && !/^\d{4}$/.test(last4)) return setError('Oppgi nøyaktig fire siffer – ikke hele kortnummeret.');
    const limitMinor = limit.trim() ? parseAmount(limit, card.currency) : null;
    if (limit.trim() && limitMinor === null) return setError('Ugyldig kredittgrense.');
    const debtMinor = debt.trim() ? parseAmount(debt, card.currency) : null;
    if (manual && debt.trim() && debtMinor === null) return setError('Ugyldig gjeld.');
    store.editCard(card.id, { name, issuer: manual ? issuer : undefined, last4: manual ? last4 : undefined, creditLimit: limitMinor, color });
    if (manual) store.updateBalance(card.id, debtMinor === null ? null : -Math.abs(debtMinor), card.availableBalance);
    onClose();
  };

  if (confirmDelete) {
    return (
      <Dialog open onClose={onClose} title={`Slette ${card.name}?`}>
        <div className="stack">
          <p className="small">
            {manual
              ? 'Kortet og transaksjonene som er importert til det, slettes fra Saldo.'
              : 'Kortet og transaksjonene fjernes fra Saldo og hentes ikke inn igjen ved oppdatering. Banktilkoblingen for de andre kontoene fortsetter som før.'}{' '}
            Selve kortet hos {card.card?.issuer ?? card.bankName} påvirkes ikke.
          </p>
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button type="button" className="btn ghost" onClick={() => setConfirmDelete(false)}>
              Avbryt
            </button>
            <button
              type="button"
              className="btn danger"
              onClick={() => {
                onDeleted();
                store.deleteAccount(card.id);
              }}
            >
              Ja, slett kortet
            </button>
          </div>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog open onClose={onClose} title="Rediger kort">
      <form className="stack" onSubmit={submit} noValidate>
        <div className={`pay-card ${color}`} style={{ minHeight: 0, aspectRatio: 'auto', padding: '16px 18px' }} aria-hidden="true">
          <div className="spread">
            <span className="pc-issuer">{issuer || card.bankName}</span>
            <span className="pc-number">•••• {last4 || '····'}</span>
          </div>
          <span style={{ fontWeight: 600, marginTop: 18, display: 'block' }}>{name || 'Kortnavn'}</span>
        </div>
        <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend style={{ marginBottom: 8 }}>Farge</legend>
          <div className="swatches">
            {CARD_COLORS.map((c) => (
              <label key={c.id} className={`swatch ${c.id}${color === c.id ? ' on' : ''}`} title={c.label}>
                <input type="radio" name="card-color" value={c.id} checked={color === c.id} onChange={() => setColor(c.id)} className="sr-only" />
                <span className="sr-only">{c.label}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <div className="form-grid two">
          <label className="field">
            <span>Navn på kortet</span>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="F.eks. Amex Gold" />
          </label>
          {manual && (
            <label className="field">
              <span>Utsteder</span>
              <input className="input" value={issuer} onChange={(e) => setIssuer(e.target.value)} placeholder="F.eks. American Express" />
            </label>
          )}
          {manual && (
            <label className="field">
              <span>Utestående gjeld ({card.currency})</span>
              <input className="input" inputMode="decimal" value={debt} onChange={(e) => setDebt(e.target.value)} placeholder="Tomt = ukjent" />
            </label>
          )}
          <label className="field">
            <span>Kredittgrense ({card.currency})</span>
            <input className="input" inputMode="decimal" value={limit} onChange={(e) => setLimit(e.target.value)} placeholder="Valgfritt" />
          </label>
          {manual && (
            <label className="field">
              <span>Siste fire siffer</span>
              <input className="input" inputMode="numeric" maxLength={4} value={last4} onChange={(e) => setLast4(e.target.value.replace(/\D/g, ''))} placeholder="1234" />
            </label>
          )}
        </div>
        {!manual && <p className="xsmall subtle">Gjeld og kortnummer hentes fra banken. Navn og farge du velger beholdes når kortet oppdateres.</p>}
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
        <div className="row wrap" style={{ justifyContent: 'space-between' }}>
          <button type="button" className="btn danger small" onClick={() => setConfirmDelete(true)}>
            Slett kort
          </button>
          <div className="row">
            <button type="button" className="btn ghost" onClick={onClose}>
              Avbryt
            </button>
            <button type="submit" className="btn primary">
              Lagre
            </button>
          </div>
        </div>
      </form>
    </Dialog>
  );
}
