import { CalendarClock, Check, Plus, Repeat, Sparkles, TrendingUp, X } from 'lucide-react';
import { useMemo, useState, type FormEvent } from 'react';
import { CATEGORIES } from '../../domain/categories';
import { formatDate, relativeDay } from '../../domain/dates';
import { formatMoney, parseAmount } from '../../domain/money';
import {
  INTERVAL_LABEL,
  chargesFor,
  detectPriceChange,
  detectSubscriptions,
  monthlyCost,
  nextChargeDate,
  subscriptionTotals,
  type SubscriptionSuggestion,
} from '../../domain/subscriptions';
import type { BillingInterval, CategoryId, Subscription } from '../../domain/types';
import { newId } from '../../state/store';
import { useData, useStore, useToday } from '../../state/StoreContext';
import { Amount } from '../components/Amount';
import { Dialog } from '../components/Dialog';
import { DemoBadge, Empty, Notice, Segmented } from '../components/common';
import { IncompleteMark } from '../components/SumBreakdown';
import { Page } from '../Layout';

type Tab = 'subscription' | 'fixed' | 'suggestions' | 'ended';

export function SubscriptionsPage() {
  const data = useData();
  const store = useStore();
  const today = useToday();
  const base = data.settings.baseCurrency;
  const [editing, setEditing] = useState<Subscription | null>(null);
  const [creating, setCreating] = useState(false);

  const suggestions = useMemo(() => detectSubscriptions(data.transactions, data.subscriptions, data.dismissedSuggestions), [data]);
  // Uten bekreftede abonnementer åpnes forslagene direkte, så de ikke overses.
  const [tab, setTab] = useState<Tab>(() => (!data.subscriptions.some((s) => s.status === 'active') && suggestions.length ? 'suggestions' : 'subscription'));
  const subsTotal = useMemo(() => subscriptionTotals(data.subscriptions, base, data.rates, 'subscription'), [data, base]);
  const fixedTotal = useMemo(() => subscriptionTotals(data.subscriptions, base, data.rates, 'fixed'), [data, base]);
  const accById = useMemo(() => new Map(data.accounts.map((a) => [a.id, a])), [data.accounts]);

  const list = data.subscriptions
    .filter((s) => (tab === 'ended' ? s.status === 'ended' : s.status === 'active' && s.kind === tab))
    .map((s) => ({ s, next: nextChargeDate(s, today) }))
    .sort((a, b) => a.next.localeCompare(b.next));

  return (
    <Page
      title="Abonnementer"
      actions={
        <button type="button" className="btn primary small" onClick={() => setCreating(true)}>
          <Plus size={16} aria-hidden="true" /> <span className="desktop-only">Legg til</span>
          <span className="sr-only">Legg til abonnement</span>
        </button>
      }
    >
      <div className="grid cols-2">
        <section className="hero">
          <p className="label">
            Abonnementer per måned <IncompleteMark complete={subsTotal.monthly.complete} />
          </p>
          <p className="big">
            <Amount value={subsTotal.monthly.amount} currency={base} />
          </p>
          <div className="hero-meta">
            <span>
              <Amount value={subsTotal.yearly.amount} currency={base} /> per år
            </span>
            <span>{subsTotal.count} aktive</span>
          </div>
          <p className="xsmall" style={{ opacity: 0.85, marginTop: 10 }}>
            Årsabonnementer er fordelt over 12 måneder. Faktisk trekkdato vises per abonnement.
          </p>
        </section>
        <section className="card">
          <p className="small muted">Andre faste betalinger per måned</p>
          <p className="num" style={{ fontSize: '1.5rem', fontWeight: 650 }}>
            <Amount value={fixedTotal.monthly.amount} currency={base} />
          </p>
          <p className="xsmall subtle">Husleie, strøm og lignende holdes adskilt fra abonnementene. {fixedTotal.count} registrert.</p>
          <hr className="sep" style={{ margin: '14px 0' }} />
          <p className="small muted">Forslag som venter på deg</p>
          <p style={{ fontWeight: 600 }}>
            {suggestions.length} mulige gjentakende betalinger{' '}
            {suggestions.length > 0 && (
              <button type="button" className="btn ghost small" onClick={() => setTab('suggestions')}>
                Se forslag
              </button>
            )}
          </p>
        </section>
      </div>

      <Segmented
        label="Vis"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'subscription', label: 'Abonnementer' },
          { value: 'fixed', label: 'Faste betalinger' },
          { value: 'suggestions', label: `Forslag (${suggestions.length})` },
          { value: 'ended', label: 'Avsluttet' },
        ]}
      />

      {tab === 'suggestions' ? (
        <Suggestions suggestions={suggestions} />
      ) : (
        <section className="card flush">
          {list.length ? (
            <ul className="list">
              {list.map(({ s, next }) => {
                const change = detectPriceChange(chargesFor(s, data.transactions));
                const acc = s.accountId ? accById.get(s.accountId) : null;
                return (
                  <li key={s.id}>
                    <button type="button" className="list-item" onClick={() => setEditing(s)}>
                      <span className="avatar" aria-hidden="true">
                        <Repeat size={18} />
                      </span>
                      <span className="li-main">
                        <span className="li-title row" style={{ gap: 6 }}>
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.name}</span>
                          {s.isDemo && <DemoBadge />}
                        </span>
                        <span className="li-sub" style={{ display: 'block' }}>
                          {INTERVAL_LABEL[s.interval]}
                          {acc ? ` · ${acc.name}` : ''}
                          {s.status === 'active' ? ` · neste ca. ${relativeDay(next, today)} (estimert)` : s.endedAt ? ` · avsluttet ${formatDate(s.endedAt, 'short')}` : ''}
                        </span>
                        {change && s.status === 'active' && (
                          <span className="badge warn" style={{ marginTop: 4 }}>
                            <TrendingUp size={12} aria-hidden="true" /> Mulig prisendring {formatMoney(change.from, s.currency)} → {formatMoney(change.to, s.currency)}
                          </span>
                        )}
                      </span>
                      <span className="li-end">
                        <Amount value={s.amount} currency={s.currency} />
                        {s.interval !== 'monthly' && (
                          <span className="xsmall subtle" style={{ display: 'block' }}>
                            ≈ <Amount value={monthlyCost(s)} currency={s.currency} />/mnd
                          </span>
                        )}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <Empty icon={<Repeat size={22} />} title={tab === 'ended' ? 'Ingen avsluttede' : 'Ingen registrert'}>
              {tab === 'ended' ? 'Abonnementer du markerer som avsluttet, havner her.' : 'Bekreft forslag eller legg til manuelt.'}
            </Empty>
          )}
        </section>
      )}

      {tab !== 'suggestions' && tab !== 'ended' && list.length > 0 && (
        <p className="xsmall subtle">
          <CalendarClock size={12} aria-hidden="true" style={{ verticalAlign: -1 }} /> Neste trekk er beregnet ut fra tidligere trekk og intervall, og kan avvike fra det leverandøren faktisk trekker.
        </p>
      )}

      {(editing || creating) && (
        <SubscriptionDialog
          key={editing?.id ?? 'new'}
          sub={editing}
          defaultKind={tab === 'fixed' ? 'fixed' : 'subscription'}
          onClose={() => {
            setEditing(null);
            setCreating(false);
          }}
          onSave={(s) => {
            store.upsertSubscription(s);
            setEditing(null);
            setCreating(false);
          }}
        />
      )}
    </Page>
  );
}

function Suggestions({ suggestions }: { suggestions: SubscriptionSuggestion[] }) {
  const data = useData();
  const store = useStore();
  const accById = new Map(data.accounts.map((a) => [a.id, a]));
  return (
    <div className="stack">
      <Notice>
        Forslagene er funnet fra gjentakende betalinger til samme mottaker. De er ikke bekreftet av leverandøren – sjekk før du bekrefter.
      </Notice>
      {suggestions.length === 0 && (
        <div className="card">
          <Empty icon={<Sparkles size={22} />} title="Ingen nye forslag">
            Saldo trenger minst tre trekk med jevne mellomrom (to for årlige) for å foreslå et abonnement.
          </Empty>
        </div>
      )}
      <div className="grid cols-2">
        {suggestions.map((s) => (
          <section key={s.matchKey} className="card stack-sm">
            <div className="spread">
              <h3>{s.name}</h3>
              <span className={`badge ${s.confidence >= 0.8 ? 'accent' : ''}`}>{s.confidence >= 0.8 ? 'Sannsynlig' : 'Mulig'}</span>
            </div>
            <p className="num" style={{ fontSize: '1.3rem', fontWeight: 650 }}>
              <Amount value={s.amount} currency={s.currency} /> <span className="small muted">/ {INTERVAL_LABEL[s.interval].toLowerCase()}</span>
            </p>
            <p className="small muted">
              {s.occurrences} trekk · sist {formatDate(s.anchorDate, 'short')} · {accById.get(s.accountId)?.name ?? 'ukjent konto'}
            </p>
            <p className="small muted">Foreslått som {s.kind === 'fixed' ? 'fast betaling' : 'abonnement'}.</p>
            {s.priceChange && (
              <span className="badge warn">
                <TrendingUp size={12} aria-hidden="true" /> Beløpet endret seg fra {formatMoney(s.priceChange.from, s.currency)} til {formatMoney(s.priceChange.to, s.currency)}
              </span>
            )}
            <div className="row wrap" style={{ marginTop: 4 }}>
              <button type="button" className="btn primary small" onClick={() => store.confirmSuggestion(s)}>
                <Check size={16} aria-hidden="true" /> Bekreft
              </button>
              <button
                type="button"
                className="btn small"
                onClick={() => store.confirmSuggestion(s, { kind: s.kind === 'fixed' ? 'subscription' : 'fixed' })}
              >
                Lagre som {s.kind === 'fixed' ? 'abonnement' : 'fast betaling'}
              </button>
              <button type="button" className="btn ghost small" onClick={() => store.dismissSuggestion(s.matchKey)}>
                <X size={16} aria-hidden="true" /> Avvis
              </button>
            </div>
          </section>
        ))}
      </div>
      {data.dismissedSuggestions.length > 0 && (
        <details className="card">
          <summary style={{ cursor: 'pointer' }} className="small">
            Avviste forslag ({data.dismissedSuggestions.length})
          </summary>
          <ul className="list" style={{ marginTop: 8 }}>
            {data.dismissedSuggestions.map((k) => (
              <li key={k} className="spread" style={{ padding: '8px 0' }}>
                <span className="small">{k}</span>
                <button type="button" className="btn ghost small" onClick={() => store.restoreSuggestion(k)}>
                  Gjenopprett
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function SubscriptionDialog({
  sub,
  defaultKind,
  onClose,
  onSave,
}: {
  sub: Subscription | null;
  defaultKind: Subscription['kind'];
  onClose: () => void;
  onSave: (s: Subscription) => void;
}) {
  const data = useData();
  const store = useStore();
  const today = useToday();
  const [name, setName] = useState(sub?.name ?? '');
  const [amount, setAmount] = useState(sub ? formatMoney(sub.amount, sub.currency).replace(/[^\d,]/g, '') : '');
  const [interval, setBillingInterval] = useState<BillingInterval>(sub?.interval ?? 'monthly');
  const [accountId, setAccountId] = useState(sub?.accountId ?? '');
  const [anchorDate, setAnchor] = useState(sub?.anchorDate ?? today);
  const [kind, setKind] = useState<Subscription['kind']>(sub?.kind ?? defaultKind);
  const [category, setCategory] = useState<CategoryId>(sub?.category ?? (defaultKind === 'fixed' ? 'bolig' : 'abonnementer'));
  const [error, setError] = useState<string | null>(null);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const account = data.accounts.find((a) => a.id === accountId);
  const currency = account?.currency ?? sub?.currency ?? data.settings.baseCurrency;
  const charges = sub ? chargesFor(sub, data.transactions).slice(-6).reverse() : [];

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const minor = parseAmount(amount, currency);
    if (!name.trim()) return setError('Gi abonnementet et navn.');
    if (minor === null || minor <= 0) return setError('Oppgi en gyldig pris, f.eks. 179,00.');
    onSave({
      id: sub?.id ?? newId('sub'),
      name: name.trim(),
      amount: Math.abs(minor),
      currency,
      interval,
      accountId: accountId || null,
      anchorDate,
      kind,
      status: sub?.status ?? 'active',
      endedAt: sub?.endedAt ?? null,
      source: sub?.source ?? 'manual',
      matchKey: sub?.matchKey ?? null,
      category,
      isDemo: sub?.isDemo ?? false,
    });
  };

  return (
    <Dialog open onClose={onClose} title={sub ? sub.name : 'Nytt abonnement eller fast betaling'}>
      <form className="stack" onSubmit={submit} noValidate>
        <div className="form-grid two">
          <label className="field">
            <span>Navn</span>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} required />
          </label>
          <label className="field">
            <span>Pris per trekk ({currency})</span>
            <input className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="179,00" />
          </label>
          <label className="field">
            <span>Intervall</span>
            <select className="select" value={interval} onChange={(e) => setBillingInterval(e.target.value as BillingInterval)}>
              {(Object.keys(INTERVAL_LABEL) as BillingInterval[]).map((i) => (
                <option key={i} value={i}>
                  {INTERVAL_LABEL[i]}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Belastes</span>
            <select className="select" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              <option value="">Ikke valgt</option>
              {data.accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({a.bankName})
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Kjent trekkdato</span>
            <input className="input" type="date" value={anchorDate} onChange={(e) => setAnchor(e.target.value)} />
            <span className="hint">Neste trekk estimeres fra denne datoen.</span>
          </label>
          <label className="field">
            <span>Type</span>
            <select className="select" value={kind} onChange={(e) => setKind(e.target.value as Subscription['kind'])}>
              <option value="subscription">Abonnement</option>
              <option value="fixed">Fast betaling (husleie, strøm, lån …)</option>
            </select>
          </label>
          <label className="field">
            <span>Kategori</span>
            <select className="select" value={category} onChange={(e) => setCategory(e.target.value as CategoryId)}>
              {CATEGORIES.filter((c) => c.type === 'expense').map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        {sub && sub.status === 'active' && (
          <p className="small muted">
            Neste trekk ca. {formatDate(nextChargeDate({ anchorDate, interval }, today), 'long')} (estimert).
            {interval !== 'monthly' && (
              <>
                {' '}
                Tilsvarer {formatMoney(monthlyCost({ amount: parseAmount(amount, currency) ?? 0, interval }), currency)} per måned i sammenligningen.
              </>
            )}
          </p>
        )}

        {charges.length > 0 && (
          <div className="stack-sm">
            <h3>Siste trekk</h3>
            <dl className="dl">
              {charges.map((c) => (
                <div key={c.id} style={{ display: 'contents' }}>
                  <dt>{formatDate(c.bookingDate)}</dt>
                  <dd>
                    <Amount value={c.amount} currency={c.currency} signed />
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        )}

        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}

        <div className="row wrap" style={{ justifyContent: 'space-between' }}>
          <div className="row wrap">
            {sub?.status === 'active' && (
              <button type="button" className="btn ghost small" onClick={() => setConfirmEnd(true)}>
                Marker som avsluttet
              </button>
            )}
            {sub?.status === 'ended' && (
              <button type="button" className="btn ghost small" onClick={() => { store.setSubscriptionStatus(sub.id, 'active'); onClose(); }}>
                Gjenoppta
              </button>
            )}
            {sub && (
              <button type="button" className="btn danger small" onClick={() => { store.deleteSubscription(sub.id); onClose(); }}>
                Slett
              </button>
            )}
          </div>
          <div className="row">
            <button type="button" className="btn ghost" onClick={onClose}>
              Avbryt
            </button>
            <button type="submit" className="btn primary">
              Lagre
            </button>
          </div>
        </div>

        {confirmEnd && sub && (
          <Notice tone="warn" title="Merk som avsluttet?">
            <p>Dette endrer bare oversikten i Saldo. Abonnementet sies ikke opp hos {sub.name} – det må du gjøre hos leverandøren.</p>
            <div className="row" style={{ marginTop: 8 }}>
              <button
                type="button"
                className="btn small"
                onClick={() => {
                  store.setSubscriptionStatus(sub.id, 'ended');
                  onClose();
                }}
              >
                Ja, marker som avsluttet
              </button>
              <button type="button" className="btn ghost small" onClick={() => setConfirmEnd(false)}>
                Avbryt
              </button>
            </div>
          </Notice>
        )}
      </form>
    </Dialog>
  );
}
