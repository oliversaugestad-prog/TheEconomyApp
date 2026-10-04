import { Archive, CalendarRange, Link2, Pencil, Plus, Search, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { sortByDateDesc } from '../../domain/calculations';
import { formatDate } from '../../domain/dates';
import { summarizeEvent, suggestEventTransactions, type EventSummary } from '../../domain/events';
import { formatMoney, parseAmount } from '../../domain/money';
import type { EventItem, SpendEvent, Transaction } from '../../domain/types';
import { newId } from '../../state/store';
import { useData, useStore, useToday } from '../../state/StoreContext';
import { CategoryBars } from '../charts/CategoryBars';
import { Amount } from '../components/Amount';
import { Dialog } from '../components/Dialog';
import { Empty, Notice } from '../components/common';
import { TransactionDetail, TransactionRow } from '../components/TransactionViews';
import { Page } from '../Layout';

export const EVENT_EMOJIS = ['✈️', '🏖️', '🏔️', '🎿', '🏕️', '🎉', '💍', '🎓', '🏠', '🚗', '🎁', '⚽'];
const CURRENCIES = ['NOK', 'EUR', 'USD', 'SEK', 'DKK', 'GBP', 'CHF'];

function dateRange(ev: Pick<SpendEvent, 'startDate' | 'endDate'>): string | null {
  if (!ev.startDate) return null;
  if (!ev.endDate || ev.endDate === ev.startDate) return formatDate(ev.startDate, 'short');
  return `${formatDate(ev.startDate, 'short')} – ${formatDate(ev.endDate, 'short')}`;
}

/** Fremdriftslinje mot budsjettet. Fargen forsterkes av tekst, ikke alene. */
function BudgetBar({ s }: { s: EventSummary }) {
  if (s.usage === null) return null;
  const pct = Math.min(100, Math.round(s.usage * 100));
  const color = s.status === 'over' ? 'var(--danger)' : s.status === 'warn' ? 'var(--warning)' : 'var(--positive)';
  return (
    <div className="progress" role="img" aria-label={`Brukt ${Math.round(s.usage * 100)} prosent av budsjettet`}>
      <span style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}

function BudgetStatus({ s }: { s: EventSummary }) {
  if (s.remaining === null) return <span className="subtle">Uten budsjett</span>;
  if (s.remaining >= 0) {
    return (
      <span>
        <Amount value={s.remaining} currency={s.currency} /> igjen
        {s.status === 'warn' && <span className="badge warn" style={{ marginLeft: 6 }}>Nesten brukt opp</span>}
      </span>
    );
  }
  return (
    <span style={{ color: 'var(--danger)' }}>
      Over budsjett med <Amount value={-s.remaining} currency={s.currency} />
    </span>
  );
}

export function EventsPage() {
  const data = useData();
  const [params, setParams] = useSearchParams();
  const [creating, setCreating] = useState(params.get('ny') === '1');
  const [showArchived, setShowArchived] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    if (params.get('ny') === '1') setParams({}, { replace: true });
  }, [params, setParams]);

  const events = data.events ?? [];
  const rows = useMemo(
    () =>
      events
        .map((ev) => ({ ev, s: summarizeEvent(ev, data.transactions, data.rates) }))
        .sort((a, b) => (b.ev.startDate ?? b.ev.createdAt).localeCompare(a.ev.startDate ?? a.ev.createdAt)),
    [events, data.transactions, data.rates],
  );
  const active = rows.filter((r) => !r.ev.archived);
  const archived = rows.filter((r) => r.ev.archived);

  return (
    <Page
      title="Hendelser"
      actions={
        <button type="button" className="btn primary small" onClick={() => setCreating(true)} aria-label="Ny hendelse">
          <Plus size={16} aria-hidden="true" /> <span className="desktop-only" aria-hidden="true">Ny hendelse</span>
        </button>
      }
    >
      <p className="small muted">
        Samle kjøp til en tur, et bryllup eller et prosjekt, sett et budsjett og se om du holder deg innenfor. Hendelser er en egen visning – de endrer ikke inntekter og utgifter i oversikten.
      </p>

      {active.length ? (
        <div className="grid cols-2">
          {active.map(({ ev, s }) => (
            <EventCard key={ev.id} ev={ev} s={s} />
          ))}
        </div>
      ) : (
        <div className="card">
          <Empty
            icon={<CalendarRange size={24} />}
            title="Ingen hendelser ennå"
            action={
              <button type="button" className="btn primary small" onClick={() => setCreating(true)}>
                <Plus size={16} aria-hidden="true" /> Lag din første
              </button>
            }
          >
            For eksempel «Marokko-tur» med budsjett 15 000 kr. Koble flybilletter, hotell og kortkjøp til den.
          </Empty>
        </div>
      )}

      {archived.length > 0 && (
        <section className="stack-sm">
          <button type="button" className="btn ghost small" onClick={() => setShowArchived((v) => !v)} aria-expanded={showArchived}>
            <Archive size={16} aria-hidden="true" /> {showArchived ? 'Skjul' : 'Vis'} arkiverte ({archived.length})
          </button>
          {showArchived && (
            <div className="grid cols-2">
              {archived.map(({ ev, s }) => (
                <EventCard key={ev.id} ev={ev} s={s} />
              ))}
            </div>
          )}
        </section>
      )}

      {creating && (
        <EventDialog
          event={null}
          onClose={() => setCreating(false)}
          onSaved={(ev) => {
            setCreating(false);
            navigate(`/hendelser/${ev.id}`);
          }}
        />
      )}
    </Page>
  );
}

export function EventCard({ ev, s }: { ev: SpendEvent; s: EventSummary }) {
  return (
    <Link to={`/hendelser/${ev.id}`} className="card event-card" style={{ textDecoration: 'none', color: 'inherit' }}>
      <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
        <span className="event-emoji" aria-hidden="true">
          {ev.emoji}
        </span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <h2 style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ev.name}</h2>
          <p className="xsmall subtle">
            {[dateRange(ev), `${s.transactions.length + ev.items.length} poster`, ev.archived ? 'arkivert' : null].filter(Boolean).join(' · ')}
          </p>
        </div>
      </div>
      <p className="num" style={{ fontSize: '1.4rem', fontWeight: 650, margin: '12px 0 6px' }}>
        <Amount value={s.spent} currency={s.currency} />
        {s.budget !== null && (
          <span className="small muted" style={{ fontWeight: 500 }}>
            {' '}
            av <Amount value={s.budget} currency={s.currency} />
          </span>
        )}
      </p>
      <BudgetBar s={s} />
      <p className="small" style={{ marginTop: 6 }}>
        <BudgetStatus s={s} />
      </p>
    </Link>
  );
}

export function EventDetailPage() {
  const { id } = useParams();
  const data = useData();
  const store = useStore();
  const ev = (data.events ?? []).find((e) => e.id === id);
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [addingItem, setAddingItem] = useState<EventItem | 'new' | null>(null);
  const [openTx, setOpenTx] = useState<Transaction | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const navigate = useNavigate();

  const s = useMemo(() => (ev ? summarizeEvent(ev, data.transactions, data.rates) : null), [ev, data.transactions, data.rates]);
  const suggestions = useMemo(() => (ev ? suggestEventTransactions(ev, data.transactions) : []), [ev, data.transactions]);

  if (!ev || !s) {
    return (
      <Page title="Hendelse" back={{ to: '/hendelser', label: 'Tilbake til hendelser' }}>
        <div className="card">
          <Empty icon={<CalendarRange size={22} />} title="Fant ikke hendelsen" />
        </div>
      </Page>
    );
  }
  const accById = new Map(data.accounts.map((a) => [a.id, a]));
  const total = s.byCategory.reduce((sum, c) => sum + c.amount, 0);

  return (
    <Page
      title={`${ev.emoji} ${ev.name}`}
      back={{ to: '/hendelser', label: 'Tilbake til hendelser' }}
      actions={
        <button type="button" className="btn small" onClick={() => setEditing(true)}>
          <Pencil size={16} aria-hidden="true" /> Rediger
        </button>
      }
    >
      <section className="hero" aria-labelledby="ev-spent">
        <p className="label" id="ev-spent">
          Brukt {dateRange(ev) ? `· ${dateRange(ev)}` : ''}
        </p>
        <p className="big">
          <Amount value={s.spent} currency={s.currency} />
        </p>
        <div className="hero-meta">
          {s.budget !== null ? (
            <span>
              Budsjett <Amount value={s.budget} currency={s.currency} />
            </span>
          ) : (
            <span>Ingen budsjett satt</span>
          )}
          <span>
            <BudgetStatus s={s} />
          </span>
          {s.usage !== null && <span>{Math.round(s.usage * 100)} % brukt</span>}
        </div>
        {s.usage !== null && (
          <div style={{ marginTop: 12 }}>
            <BudgetBar s={s} />
          </div>
        )}
        <div className="hero-actions">
          <button type="button" className="btn glass small" onClick={() => setAdding(true)}>
            <Link2 size={16} aria-hidden="true" /> Koble kjøp
          </button>
          <button type="button" className="btn glass small" onClick={() => setAddingItem('new')}>
            <Plus size={16} aria-hidden="true" /> Utgift uten kort
          </button>
        </div>
      </section>

      {s.missing > 0 && <Notice tone="warn">{s.missing} post(er) i fremmed valuta mangler valutakurs og er ikke med i summen.</Notice>}
      {ev.note && <p className="small muted">{ev.note}</p>}

      {suggestions.length > 0 && (
        <section className="card flush" aria-labelledby="ev-sugg">
          <div className="card-head" style={{ padding: '18px 18px 0' }}>
            <div>
              <h2 id="ev-sugg">Kjøp i perioden</h2>
              <p className="xsmall subtle">Kryss av det som hører til {ev.name}. Kjøp to dager før start er tatt med (f.eks. billetter).</p>
            </div>
            <button
              type="button"
              className="btn primary small"
              disabled={picked.size === 0}
              onClick={() => {
                store.setTransactionsEvent([...picked], ev.id);
                setPicked(new Set());
              }}
            >
              Koble {picked.size || ''} valgte
            </button>
          </div>
          <ul className="list" style={{ marginTop: 8 }}>
            {suggestions.slice(0, 40).map((t) => (
              <li key={t.id}>
                <label className="list-item" style={{ cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={picked.has(t.id)}
                    onChange={(e) => {
                      const next = new Set(picked);
                      if (e.target.checked) next.add(t.id);
                      else next.delete(t.id);
                      setPicked(next);
                    }}
                    aria-label={`${t.counterparty} ${formatDate(t.bookingDate, 'short')}`}
                    style={{ width: 18, height: 18, flex: 'none' }}
                  />
                  <span className="li-main">
                    <span className="li-title" style={{ display: 'block' }}>
                      {t.counterparty}
                    </span>
                    <span className="li-sub" style={{ display: 'block' }}>
                      {formatDate(t.bookingDate, 'short')} · {accById.get(t.accountId)?.name ?? ''}
                    </span>
                  </span>
                  <span className="li-end">
                    <Amount value={t.amount} currency={t.currency} signed />
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="grid cols-2">
        <section className="card">
          <div className="card-head">
            <h2>Fordeling</h2>
          </div>
          {s.byCategory.length ? (
            <CategoryBars shares={s.byCategory.map((c) => ({ ...c, share: total ? c.amount / total : 0 }))} currency={s.currency} />
          ) : (
            <p className="small muted">Ingen koblede kjøp ennå.</p>
          )}
          {s.manual > 0 && (
            <p className="small muted" style={{ marginTop: 10 }}>
              + utgifter uten kort: <Amount value={s.manual} currency={s.currency} />
            </p>
          )}
        </section>

        <section className="card flush" aria-labelledby="ev-items">
          <div className="card-head" style={{ padding: '18px 18px 0' }}>
            <h2 id="ev-items">Utgifter uten kort</h2>
            <button type="button" className="btn small" onClick={() => setAddingItem('new')} aria-label="Legg til utgift uten kort">
              <Plus size={16} aria-hidden="true" />
            </button>
          </div>
          {ev.items.length ? (
            <ul className="list" style={{ marginTop: 8 }}>
              {ev.items.map((it) => (
                <li key={it.id}>
                  <button type="button" className="list-item" onClick={() => setAddingItem(it)}>
                    <span className="li-main">
                      <span className="li-title" style={{ display: 'block' }}>
                        {it.name}
                      </span>
                      <span className="li-sub" style={{ display: 'block' }}>
                        {it.date ? formatDate(it.date, 'short') : 'Uten dato'}
                      </span>
                    </span>
                    <span className="li-end">
                      <Amount value={-it.amount} currency={it.currency} signed />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="small muted" style={{ padding: '10px 18px 18px' }}>
              Kontanter, noe en venn la ut for deg, eller forhåndsbetalt reise som ikke finnes i banken.
            </p>
          )}
        </section>
      </div>

      <section className="card flush" aria-label="Koblede kjøp">
        <div className="card-head" style={{ padding: '18px 18px 0' }}>
          <h2>Koblede kjøp ({s.transactions.length})</h2>
          <button type="button" className="btn small" onClick={() => setAdding(true)}>
            <Link2 size={16} aria-hidden="true" /> Koble kjøp
          </button>
        </div>
        {s.transactions.length ? (
          <ul className="list" style={{ marginTop: 8 }}>
            {s.transactions.map((t) => (
              <li key={t.id} className="row" style={{ gap: 0 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <TransactionRow t={t} account={accById.get(t.accountId)} onOpen={setOpenTx} />
                </div>
                <button
                  type="button"
                  className="icon-btn"
                  style={{ marginRight: 10 }}
                  aria-label={`Fjern ${t.counterparty} fra ${ev.name}`}
                  onClick={() => store.setTransactionsEvent([t.id], null)}
                >
                  <X size={16} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="small muted" style={{ padding: '10px 18px 18px' }}>
            Trykk «Koble kjøp» for å velge transaksjoner, eller åpne en transaksjon og velg hendelsen der.
          </p>
        )}
      </section>

      <p className="xsmall subtle">
        Kjøpene telles fortsatt i sine vanlige kategorier i oversikten. Refusjoner koblet til hendelsen trekkes fra. Beløp i fremmed valuta regnes om med siste kurs fra Norges Bank.
      </p>

      {editing && (
        <EventDialog
          event={ev}
          onClose={() => setEditing(false)}
          onSaved={() => setEditing(false)}
          onDeleted={() => {
            store.deleteEvent(ev.id);
            navigate('/hendelser');
          }}
        />
      )}
      {adding && <LinkDialog ev={ev} onClose={() => setAdding(false)} />}
      {addingItem && <ItemDialog ev={ev} item={addingItem === 'new' ? null : addingItem} onClose={() => setAddingItem(null)} />}
      {openTx && <TransactionDetail key={openTx.id} tx={openTx} onClose={() => setOpenTx(null)} />}
    </Page>
  );
}

function EventDialog({ event, onClose, onSaved, onDeleted }: { event: SpendEvent | null; onClose: () => void; onSaved: (ev: SpendEvent) => void; onDeleted?: () => void }) {
  const data = useData();
  const store = useStore();
  const [name, setName] = useState(event?.name ?? '');
  const [emoji, setEmoji] = useState(event?.emoji ?? '✈️');
  const [currency, setCurrency] = useState(event?.currency ?? data.settings.baseCurrency);
  const [budget, setBudget] = useState(event?.budget != null ? formatMoney(event.budget, event.currency).replace(/[^\d,\s]/g, '').trim() : '');
  const [startDate, setStart] = useState(event?.startDate ?? '');
  const [endDate, setEnd] = useState(event?.endDate ?? '');
  const [note, setNote] = useState(event?.note ?? '');
  const [archived, setArchived] = useState(event?.archived ?? false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setError('Gi hendelsen et navn, f.eks. «Marokko-tur».');
    const b = budget.trim() ? parseAmount(budget, currency) : null;
    if (budget.trim() && (b === null || b < 0)) return setError('Ugyldig budsjett. Skriv f.eks. 15 000.');
    if (startDate && endDate && endDate < startDate) return setError('Sluttdato kan ikke være før startdato.');
    const ev: SpendEvent = {
      id: event?.id ?? newId('event'),
      name: name.trim(),
      emoji,
      budget: b,
      currency,
      startDate: startDate || null,
      endDate: endDate || null,
      note: note.trim(),
      items: event?.items ?? [],
      archived,
      createdAt: event?.createdAt ?? new Date().toISOString(),
    };
    store.upsertEvent(ev);
    onSaved(ev);
  };

  if (confirmDelete && event) {
    return (
      <Dialog open onClose={onClose} title={`Slette ${event.name}?`}>
        <div className="stack">
          <p className="small">Hendelsen og utgiftene uten kort slettes. Koblede kjøp beholdes i Saldo, men kobles fra.</p>
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button type="button" className="btn ghost" onClick={() => setConfirmDelete(false)}>
              Avbryt
            </button>
            <button type="button" className="btn danger" onClick={onDeleted}>
              Ja, slett hendelsen
            </button>
          </div>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog open onClose={onClose} title={event ? 'Rediger hendelse' : 'Ny hendelse'}>
      <form className="stack" onSubmit={submit} noValidate>
        <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend style={{ marginBottom: 8 }}>Ikon</legend>
          <div className="swatches">
            {EVENT_EMOJIS.map((em) => (
              <label key={em} className={`emoji-choice${emoji === em ? ' on' : ''}`}>
                <input type="radio" name="event-emoji" value={em} checked={emoji === em} onChange={() => setEmoji(em)} className="sr-only" />
                <span aria-hidden="true">{em}</span>
                <span className="sr-only">{em}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <div className="form-grid two">
          <label className="field">
            <span>Navn</span>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="F.eks. Marokko-tur" />
          </label>
          <label className="field">
            <span>Budsjett (valgfritt)</span>
            <input className="input" inputMode="decimal" value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="F.eks. 15 000" />
          </label>
          <label className="field">
            <span>Fra</span>
            <input className="input" type="date" value={startDate} onChange={(e) => setStart(e.target.value)} />
          </label>
          <label className="field">
            <span>Til</span>
            <input className="input" type="date" value={endDate} onChange={(e) => setEnd(e.target.value)} />
          </label>
          <label className="field">
            <span>Valuta for budsjettet</span>
            <select className="select" value={currency} onChange={(e) => setCurrency(e.target.value)}>
              {CURRENCIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Notat (valgfritt)</span>
            <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="F.eks. med Ola og Kari" />
          </label>
        </div>
        <p className="xsmall subtle">Med datoer foreslår Saldo kjøp fra perioden, så du kan koble dem med ett trykk.</p>
        {event && (
          <label className="check">
            <input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} />
            <span className="small">Arkiver (ferdig – vises ikke blant aktive)</span>
          </label>
        )}
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
        <div className="row wrap" style={{ justifyContent: 'space-between' }}>
          {event ? (
            <button type="button" className="btn danger small" onClick={() => setConfirmDelete(true)}>
              <Trash2 size={16} aria-hidden="true" /> Slett
            </button>
          ) : (
            <span />
          )}
          <div className="row">
            <button type="button" className="btn ghost" onClick={onClose}>
              Avbryt
            </button>
            <button type="submit" className="btn primary">
              {event ? 'Lagre' : 'Opprett'}
            </button>
          </div>
        </div>
      </form>
    </Dialog>
  );
}

/** Velg hvilke kjøp som hører til hendelsen. */
function LinkDialog({ ev, onClose }: { ev: SpendEvent; onClose: () => void }) {
  const data = useData();
  const store = useStore();
  const today = useToday();
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const accById = new Map(data.accounts.map((a) => [a.id, a]));
  const candidates = useMemo(() => {
    const q = query.trim().toLowerCase();
    return sortByDateDesc(
      data.transactions.filter(
        (t) =>
          t.eventId !== ev.id &&
          t.amount < 0 &&
          t.kind !== 'internal_transfer' &&
          t.kind !== 'card_payment' &&
          (!q || t.counterparty.toLowerCase().includes(q) || t.description.toLowerCase().includes(q)),
      ),
    ).slice(0, 80);
  }, [data.transactions, ev.id, query]);

  return (
    <Dialog open onClose={onClose} title={`Koble kjøp til ${ev.name}`}>
      <div className="stack">
        <label className="field">
          <span>Søk</span>
          <span className="search">
            <Search size={18} aria-hidden="true" />
            <input className="input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="F.eks. Norwegian, hotell, Booking" autoComplete="off" />
          </span>
        </label>
        <ul className="list card flush" style={{ maxHeight: 360, overflowY: 'auto' }} aria-label="Kjøp å velge blant">
          {candidates.map((t) => (
            <li key={t.id}>
              <label className="list-item" style={{ cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={picked.has(t.id)}
                  onChange={(e) => {
                    const next = new Set(picked);
                    if (e.target.checked) next.add(t.id);
                    else next.delete(t.id);
                    setPicked(next);
                  }}
                  aria-label={`${t.counterparty} ${formatDate(t.bookingDate, 'short')}`}
                  style={{ width: 18, height: 18, flex: 'none' }}
                />
                <span className="li-main">
                  <span className="li-title" style={{ display: 'block' }}>
                    {t.counterparty}
                  </span>
                  <span className="li-sub" style={{ display: 'block' }}>
                    {formatDate(t.bookingDate, t.bookingDate.slice(0, 4) === today.slice(0, 4) ? 'short' : 'long')} · {accById.get(t.accountId)?.name ?? ''}
                    {t.eventId ? ' · koblet til annen hendelse' : ''}
                  </span>
                </span>
                <span className="li-end">
                  <Amount value={t.amount} currency={t.currency} signed />
                </span>
              </label>
            </li>
          ))}
          {!candidates.length && <li className="small muted" style={{ padding: 16 }}>Ingen treff.</li>}
        </ul>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn ghost" onClick={onClose}>
            Avbryt
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={picked.size === 0}
            onClick={() => {
              store.setTransactionsEvent([...picked], ev.id);
              onClose();
            }}
          >
            Koble {picked.size} kjøp
          </button>
        </div>
      </div>
    </Dialog>
  );
}

function ItemDialog({ ev, item, onClose }: { ev: SpendEvent; item: EventItem | null; onClose: () => void }) {
  const store = useStore();
  const [name, setName] = useState(item?.name ?? '');
  const [currency, setCurrency] = useState(item?.currency ?? ev.currency);
  const [amount, setAmount] = useState(item ? formatMoney(item.amount, item.currency).replace(/[^\d,\s]/g, '').trim() : '');
  const [date, setDate] = useState(item?.date ?? ev.startDate ?? '');
  const [error, setError] = useState<string | null>(null);

  const save = (items: EventItem[]) => store.upsertEvent({ ...ev, items });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const minor = parseAmount(amount, currency);
    if (!name.trim()) return setError('Gi utgiften et navn.');
    if (minor === null || minor === 0) return setError('Oppgi et beløp, f.eks. 450.');
    const next: EventItem = { id: item?.id ?? newId('evitem'), name: name.trim(), amount: Math.abs(minor), currency, date: date || null };
    save(item ? ev.items.map((i) => (i.id === item.id ? next : i)) : [...ev.items, next]);
    onClose();
  };

  return (
    <Dialog open onClose={onClose} title={item ? item.name : 'Utgift uten kort'}>
      <form className="stack" onSubmit={submit} noValidate>
        <div className="form-grid two">
          <label className="field">
            <span>Hva</span>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="F.eks. Kontanter i Marrakech" />
          </label>
          <label className="field">
            <span>Beløp</span>
            <input className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="F.eks. 1 200" />
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
            <span>Dato (valgfritt)</span>
            <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
        </div>
        <p className="xsmall subtle">Bare for hendelsens budsjett – endrer ikke saldo eller forbruk i oversikten.</p>
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
        <div className="row wrap" style={{ justifyContent: 'space-between' }}>
          {item ? (
            <button
              type="button"
              className="btn danger small"
              onClick={() => {
                save(ev.items.filter((i) => i.id !== item.id));
                onClose();
              }}
            >
              Slett
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
