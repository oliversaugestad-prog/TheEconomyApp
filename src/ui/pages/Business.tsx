import { Briefcase, Building2, Landmark, Loader2, Pencil, Plus, RefreshCw, Search, TrendingDown, TrendingUp, Wallet } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useBackend } from '../../backend/session';
import { BankApiError, callBank } from '../../backend/supabase';
import { emptyBusiness, normalizeQuoteCurrency, summarizeBusiness, type AssetScope, type HoldingValuation } from '../../domain/business';
import { formatTimestamp } from '../../domain/dates';
import { formatMoney, parseAmount } from '../../domain/money';
import type { BusinessItem, Holding, Quote } from '../../domain/types';
import { newId } from '../../state/store';
import { useData, useStore } from '../../state/StoreContext';
import { Amount } from '../components/Amount';
import { Dialog } from '../components/Dialog';
import { Empty, Notice, Segmented } from '../components/common';
import { Page } from '../Layout';

export const CURRENCIES = ['NOK', 'USD', 'EUR', 'SEK', 'DKK', 'GBP', 'CHF'];
const REFRESH_MS = 60_000;

export const KIND_LABEL: Record<BusinessItem['kind'], string> = {
  cash: 'Bank og kontanter',
  asset: 'Andre eiendeler',
  debt: 'Gjeld',
};

function parseNumber(v: string): number | null {
  const n = Number(v.replace(/[\s ]/g, '').replace(',', '.'));
  return v.trim() && Number.isFinite(n) ? n : null;
}

function formatPrice(price: number, currency: string) {
  return new Intl.NumberFormat('nb-NO', { style: 'currency', currency, currencyDisplay: currency === 'NOK' ? 'symbol' : 'code', minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(price);
}

export function formatPct(p: number) {
  return `${p > 0 ? '+' : p < 0 ? '−' : ''}${Math.abs(p * 100).toLocaleString('nb-NO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} %`;
}

interface ServerQuote {
  symbol: string;
  name?: string;
  exchange?: string;
  currency: string | null;
  price?: number;
  previousClose?: number | null;
  time?: string | null;
  error: string | null;
}

/** Henter markedskurser jevnlig mens siden er åpen og synlig. */
export function useLiveQuotes(symbols: string[], scope: AssetScope = 'business') {
  const store = useStore();
  const backend = useBackend();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastFetch, setLastFetch] = useState<string | null>(null);
  const key = symbols.slice().sort().join(',');

  const refresh = useCallback(async () => {
    if (backend.mode !== 'remote' || !key) return;
    setLoading(true);
    try {
      const r = await callBank<{ quotes: ServerQuote[]; fetchedAt: string; source: string }>('quotes', { symbols: key.split(',') });
      const ok: Quote[] = r.quotes
        .filter((q) => !q.error && typeof q.price === 'number' && q.currency)
        .map((q) => {
          const norm = normalizeQuoteCurrency(q.currency!, q.price!);
          const prev = q.previousClose != null ? normalizeQuoteCurrency(q.currency!, q.previousClose).price : null;
          return { symbol: q.symbol, price: norm.price, previousClose: prev, currency: norm.currency, time: q.time ?? null, fetchedAt: r.fetchedAt, source: r.source };
        });
      store.setQuotes(ok, scope);
      const failed = r.quotes.filter((q) => q.error).map((q) => q.symbol);
      setError(failed.length ? `Fant ikke kurs for ${failed.join(', ')}.` : null);
      setLastFetch(r.fetchedAt);
    } catch (e) {
      setError(e instanceof BankApiError ? e.message : 'Kunne ikke hente kurser.');
    } finally {
      setLoading(false);
    }
  }, [backend.mode, key, store, scope]);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, REFRESH_MS);
    const onVisible = () => document.visibilityState === 'visible' && void refresh();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refresh]);

  return { loading, error, lastFetch, refresh, available: backend.mode === 'remote' };
}

export function BusinessPage() {
  const data = useData();
  const store = useStore();
  const business = data.business ?? emptyBusiness();
  const base = data.settings.baseCurrency;
  const tz = data.settings.timeZone;
  const summary = useMemo(() => summarizeBusiness(business, base, data.rates), [business, base, data.rates]);
  const symbols = useMemo(() => business.holdings.map((h) => h.symbol).filter(Boolean) as string[], [business.holdings]);
  const live = useLiveQuotes(symbols);
  const [editingHolding, setEditingHolding] = useState<Holding | 'new' | null>(null);
  const [editingItem, setEditingItem] = useState<BusinessItem | BusinessItem['kind'] | null>(null);
  const [renaming, setRenaming] = useState(false);

  const itemsOf = (kind: BusinessItem['kind']) => business.items.filter((i) => i.kind === kind);

  return (
    <Page
      title={business.name}
      actions={
        <button type="button" className="icon-btn" aria-label="Endre navn på bedriften" onClick={() => setRenaming(true)}>
          <Pencil size={18} aria-hidden="true" />
        </button>
      }
    >
      <section className="hero" aria-labelledby="biz-total">
        <p className="label" id="biz-total">
          <Briefcase size={16} aria-hidden="true" /> Samlet verdi (eiendeler minus gjeld)
        </p>
        <p className="big">
          <Amount value={summary.total} currency={base} />
        </p>
        <div className="hero-meta">
          {summary.valuations.some((v) => v.dayChange !== null) && (
            <span>
              I dag <Amount value={summary.dayChange} currency={base} signed />
            </span>
          )}
          {summary.valuations.some((v) => v.gain !== null) && (
            <span>
              Urealisert <Amount value={summary.gain} currency={base} signed />
            </span>
          )}
          {symbols.length > 0 && (
            <span aria-live="polite">
              {live.loading ? 'Henter kurser …' : live.lastFetch ? `Kurser hentet ${formatTimestamp(live.lastFetch, tz).split(', ')[1] ?? ''}` : ''}
            </span>
          )}
        </div>
        {symbols.length > 0 && live.available && (
          <div className="hero-actions">
            <button type="button" className="btn glass small" onClick={() => live.refresh()} disabled={live.loading}>
              <RefreshCw size={16} className={live.loading ? 'spin' : ''} aria-hidden="true" /> Oppdater kurser
            </button>
          </div>
        )}
      </section>

      {!live.available && symbols.length > 0 && (
        <Notice tone="warn">Markedskurser krever innlogging. Aksjene vises med manuell kurs der den er oppgitt.</Notice>
      )}
      {live.error && <Notice tone="warn">{live.error}</Notice>}
      {summary.missing.length > 0 && (
        <Notice tone="warn" title="Ikke med i totalen">
          {summary.missing.join(', ')}.
        </Notice>
      )}

      <div className="metrics four">
        <div className="metric" style={{ cursor: 'default' }}>
          <span className="m-label">Bank og kontanter</span>
          <span className="m-value">
            <Amount value={summary.cash} currency={base} />
          </span>
        </div>
        <div className="metric" style={{ cursor: 'default' }}>
          <span className="m-label">Aksjer og fond</span>
          <span className="m-value">
            <Amount value={summary.shares} currency={base} />
          </span>
        </div>
        <div className="metric" style={{ cursor: 'default' }}>
          <span className="m-label">Andre eiendeler</span>
          <span className="m-value">
            <Amount value={summary.otherAssets} currency={base} />
          </span>
        </div>
        <div className="metric" style={{ cursor: 'default' }}>
          <span className="m-label">Gjeld</span>
          <span className="m-value">
            <Amount value={summary.debt} currency={base} />
          </span>
        </div>
      </div>

      <section className="card flush" aria-labelledby="shares-h">
        <div className="card-head" style={{ padding: '18px 18px 0' }}>
          <h2 id="shares-h">Aksjer og fond</h2>
          <button type="button" className="btn small" onClick={() => setEditingHolding('new')}>
            <Plus size={16} aria-hidden="true" /> Legg til
          </button>
        </div>
        {summary.valuations.length ? (
          <ul className="list" style={{ marginTop: 8 }}>
            {summary.valuations.map((v) => (
              <li key={v.holding.id}>
                <HoldingRow v={v} onOpen={() => setEditingHolding(v.holding)} />
              </li>
            ))}
          </ul>
        ) : (
          <Empty icon={<TrendingUp size={22} />} title="Ingen aksjer ennå">
            Legg til børsnoterte aksjer og fond. Verdien følger markedskursen. Unoterte aksjer kan legges inn med egen kurs.
          </Empty>
        )}
        {symbols.length > 0 && (
          <p className="xsmall subtle" style={{ padding: '10px 18px 16px' }}>
            Kurser fra Yahoo Finance, oppdateres hvert minutt mens siden er åpen. Kursene kan være forsinket med opptil 15–20 minutter, og er ikke egnet som grunnlag for handel.
          </p>
        )}
      </section>

      <div className="grid cols-3">
        {(['cash', 'asset', 'debt'] as const).map((kind) => (
          <section key={kind} className="card flush" aria-labelledby={`biz-${kind}`}>
            <div className="card-head" style={{ padding: '18px 18px 0' }}>
              <h2 id={`biz-${kind}`}>{KIND_LABEL[kind]}</h2>
              <button type="button" className="btn small" onClick={() => setEditingItem(kind)} aria-label={`Legg til ${KIND_LABEL[kind].toLowerCase()}`}>
                <Plus size={16} aria-hidden="true" />
              </button>
            </div>
            {itemsOf(kind).length ? (
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
              </ul>
            ) : (
              <p className="small muted" style={{ padding: '10px 18px 18px' }}>
                {kind === 'cash' ? 'Legg inn saldo på bedriftens bankkontoer.' : kind === 'asset' ? 'F.eks. eiendom, kjøretøy eller utstyr.' : 'F.eks. lån eller leverandørgjeld.'}
              </p>
            )}
          </section>
        ))}
      </div>

      <p className="xsmall subtle">
        Bedriftssiden er manuell og holdes utenfor din private oversikt og ditt private forbruk. Tallene lagres sammen med resten av dataene dine i Saldo.
      </p>

      {editingHolding && (
        <HoldingDialog
          key={editingHolding === 'new' ? 'new' : editingHolding.id}
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
          item={typeof editingItem === 'string' ? null : editingItem}
          kind={typeof editingItem === 'string' ? editingItem : editingItem.kind}
          onClose={() => setEditingItem(null)}
        />
      )}
      {renaming && <RenameDialog name={business.name} onClose={() => setRenaming(false)} onSave={(n) => { store.setBusinessName(n); setRenaming(false); }} />}
    </Page>
  );
}

export function HoldingRow({ v, onOpen }: { v: HoldingValuation; onOpen: () => void }) {
  const h = v.holding;
  const up = (v.dayChangePct ?? 0) > 0;
  const down = (v.dayChangePct ?? 0) < 0;
  return (
    <button type="button" className="list-item" onClick={onOpen}>
      <span className="avatar" aria-hidden="true" style={{ color: up ? 'var(--positive)' : down ? 'var(--danger)' : undefined }}>
        {down ? <TrendingDown size={18} /> : <TrendingUp size={18} />}
      </span>
      <span className="li-main">
        <span className="li-title" style={{ display: 'block' }}>
          {h.name}
        </span>
        <span className="li-sub" style={{ display: 'block' }}>
          {[
            h.symbol ? `${h.symbol} · ${h.exchange}` : 'Unotert',
            `${h.quantity.toLocaleString('nb-NO')} stk`,
            v.price !== null ? formatPrice(v.price, v.currency) : null,
            v.priceSource === 'manual' && h.symbol ? 'manuell kurs' : null,
            v.gainPct !== null ? `${formatPct(v.gainPct)} totalt` : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </span>
      </span>
      <span className="li-end" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
        <Amount value={v.value} currency={v.currency} unknownLabel="Mangler kurs" />
        {v.dayChangePct !== null && (
          <span className={`badge ${up ? 'ok' : down ? 'error' : ''}`} style={{ marginTop: 2 }}>
            {formatPct(v.dayChangePct)} i dag
          </span>
        )}
      </span>
    </button>
  );
}

interface SearchResult {
  symbol: string;
  name: string;
  exchange: string;
  type: string;
}

export function HoldingDialog({ holding, onClose, onSaved, scope = 'business' }: { holding: Holding | null; onClose: () => void; onSaved: () => void; scope?: AssetScope }) {
  const store = useStore();
  const backend = useBackend();
  const [mode, setMode] = useState<'listed' | 'unlisted'>(holding && !holding.symbol ? 'unlisted' : backend.mode === 'remote' ? 'listed' : 'unlisted');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [picked, setPicked] = useState<{ symbol: string; name: string; exchange: string } | null>(
    holding?.symbol ? { symbol: holding.symbol, name: holding.name, exchange: holding.exchange } : null,
  );
  const [preview, setPreview] = useState<{ price: number; currency: string } | null>(null);
  const [name, setName] = useState(holding?.name ?? '');
  const [currency, setCurrency] = useState(holding?.currency ?? 'NOK');
  const [quantity, setQuantity] = useState(holding ? String(holding.quantity).replace('.', ',') : '');
  const [cost, setCost] = useState(holding?.costPerShare != null ? String(holding.costPerShare).replace('.', ',') : '');
  const [manualPrice, setManualPrice] = useState(holding?.manualPrice != null ? String(holding.manualPrice).replace('.', ',') : '');
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Søk med litt forsinkelse mens brukeren skriver.
  useEffect(() => {
    if (mode !== 'listed' || query.trim().length < 2) {
      setResults([]);
      return;
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      setSearching(true);
      try {
        const r = await callBank<{ results: SearchResult[] }>('quote-search', { q: query });
        setResults(r.results);
      } catch (e) {
        setError(e instanceof BankApiError ? e.message : 'Søket feilet.');
      } finally {
        setSearching(false);
      }
    }, 350);
  }, [query, mode]);

  // Hent kurs og valuta for valgt aksje.
  useEffect(() => {
    if (!picked || backend.mode !== 'remote') return;
    callBank<{ quotes: ServerQuote[] }>('quotes', { symbols: [picked.symbol] })
      .then((r) => {
        const q = r.quotes[0];
        if (q && !q.error && q.currency && typeof q.price === 'number') {
          const n = normalizeQuoteCurrency(q.currency, q.price);
          setPreview(n);
          setCurrency(n.currency);
        }
      })
      .catch(() => {});
  }, [picked, backend.mode]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const qty = parseNumber(quantity);
    const costN = cost.trim() ? parseNumber(cost) : null;
    const manualN = manualPrice.trim() ? parseNumber(manualPrice) : null;
    if (qty === null || qty <= 0) return setError('Oppgi antall aksjer, f.eks. 150 eller 12,5.');
    if (cost.trim() && costN === null) return setError('Ugyldig kjøpskurs.');
    if (mode === 'listed' && !picked) return setError('Søk opp og velg en aksje eller et fond.');
    if (mode === 'unlisted' && (!name.trim() || manualN === null)) return setError('Oppgi navn og kurs per aksje.');
    store.upsertHolding({
      id: holding?.id ?? newId('holding'),
      symbol: mode === 'listed' ? picked!.symbol : null,
      name: mode === 'listed' ? picked!.name : name.trim(),
      exchange: mode === 'listed' ? picked!.exchange : 'Unotert',
      currency,
      quantity: qty,
      costPerShare: costN,
      manualPrice: mode === 'unlisted' ? manualN : null,
      updatedAt: new Date().toISOString(),
    }, scope);
    onSaved();
  };

  return (
    <Dialog open onClose={onClose} title={holding ? holding.name : scope === 'personal' ? 'Legg til aksje, fond eller krypto' : 'Legg til aksje eller fond'}>
      <form className="stack" onSubmit={submit} noValidate>
        {!holding && (
          <Segmented
            label="Type"
            value={mode}
            onChange={(m) => {
              setMode(m);
              setError(null);
            }}
            options={[
              { value: 'listed', label: 'Børsnotert' },
              { value: 'unlisted', label: 'Unotert' },
            ]}
          />
        )}

        {mode === 'listed' ? (
          backend.mode !== 'remote' ? (
            <Notice tone="warn">Søk etter børsnoterte aksjer krever innlogging.</Notice>
          ) : picked ? (
            <div className="notice">
              <TrendingUp size={18} aria-hidden="true" />
              <div className="notice-body">
                <p style={{ fontWeight: 600 }}>{picked.name}</p>
                <p className="small muted">
                  {picked.symbol} · {picked.exchange}
                  {preview ? ` · ${formatPrice(preview.price, preview.currency)}` : ''}
                </p>
                {!holding && (
                  <button type="button" className="btn ghost small" style={{ marginTop: 6 }} onClick={() => { setPicked(null); setPreview(null); }}>
                    Velg en annen
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="stack-sm">
              <label className="field">
                <span>Søk etter navn eller ticker</span>
                <span className="search">
                  <Search size={18} aria-hidden="true" />
                  <input id="holding-search" className="input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="F.eks. Equinor, KLP AksjeGlobal eller Bitcoin" autoComplete="off" />
                </span>
              </label>
              {searching && (
                <p className="small muted row">
                  <Loader2 size={16} className="spin" aria-hidden="true" /> Søker …
                </p>
              )}
              {results.length > 0 && (
                <ul className="list card flush" style={{ maxHeight: 280, overflowY: 'auto' }} aria-label="Søkeresultater">
                  {results.map((r) => (
                    <li key={r.symbol}>
                      <button type="button" className="list-item" onClick={() => setPicked({ symbol: r.symbol, name: r.name, exchange: r.exchange })}>
                        <span className="li-main">
                          <span className="li-title" style={{ display: 'block' }}>
                            {r.name}
                          </span>
                          <span className="li-sub" style={{ display: 'block' }}>
                            {r.symbol} · {r.exchange} · {r.type}
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )
        ) : (
          <div className="form-grid two">
            <label className="field">
              <span>Navn</span>
              <input id="holding-name" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="F.eks. Eksempel Holding AS" />
            </label>
            <label className="field">
              <span>Valuta</span>
              <select id="holding-currency" className="select" value={currency} onChange={(e) => setCurrency(e.target.value)}>
                {CURRENCIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Kurs per aksje ({currency})</span>
              <input id="holding-manual" className="input" inputMode="decimal" value={manualPrice} onChange={(e) => setManualPrice(e.target.value)} placeholder="F.eks. 125,50" />
              <span className="hint">Oppdater når du får en ny verdivurdering.</span>
            </label>
          </div>
        )}

        <div className="form-grid two">
          <label className="field">
            <span>Antall</span>
            <input id="holding-qty" className="input" inputMode="decimal" value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder="F.eks. 150" />
          </label>
          <label className="field">
            <span>Snittkurs ved kjøp ({currency}, valgfritt)</span>
            <input id="holding-cost" className="input" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="Brukes til gevinst/tap" />
          </label>
        </div>

        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
        <div className="row wrap" style={{ justifyContent: 'space-between' }}>
          {holding ? (
            <button type="button" className="btn danger small" onClick={() => { store.deleteHolding(holding.id, scope); onClose(); }}>
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

export function ItemDialog({ item, kind, onClose, scope = 'business' }: { item: BusinessItem | null; kind: BusinessItem['kind']; onClose: () => void; scope?: AssetScope }) {
  const store = useStore();
  const [name, setName] = useState(item?.name ?? '');
  const [institution, setInstitution] = useState(item?.institution ?? (kind === 'cash' && scope === 'business' ? 'SpareBank 1 SMN' : ''));
  const [currency, setCurrency] = useState(item?.currency ?? 'NOK');
  const [amount, setAmount] = useState(item ? formatMoney(item.amount, item.currency).replace(/[^\d,\-−]/g, '').replace('−', '-') : '');
  const [error, setError] = useState<string | null>(null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const minor = parseAmount(amount, currency);
    if (!name.trim()) return setError('Gi posten et navn.');
    if (minor === null) return setError('Oppgi et gyldig beløp, f.eks. 250 000.');
    store.upsertBusinessItem({
      id: item?.id ?? newId('bizitem'),
      kind,
      name: name.trim(),
      institution: institution.trim(),
      currency,
      amount: kind === 'debt' ? Math.abs(minor) : minor,
      updatedAt: new Date().toISOString(),
    }, scope);
    onClose();
  };

  return (
    <Dialog open onClose={onClose} title={item ? item.name : `Ny post: ${KIND_LABEL[kind].toLowerCase()}`}>
      <form className="stack" onSubmit={submit} noValidate>
        <div className="form-grid two">
          <label className="field">
            <span>Navn</span>
            <input id="item-name" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder={scope === 'personal' ? (kind === 'cash' ? 'F.eks. Kontanter i Nordnet' : kind === 'asset' ? 'F.eks. Leilighet eller bil' : 'F.eks. Boliglån eller studielån') : kind === 'cash' ? 'F.eks. Driftskonto' : kind === 'asset' ? 'F.eks. Firmabil' : 'F.eks. Banklån'} />
          </label>
          <label className="field">
            <span>{kind === 'debt' ? 'Långiver' : kind === 'cash' ? 'Bank' : 'Beskrivelse'} (valgfritt)</span>
            <input id="item-inst" className="input" value={institution} onChange={(e) => setInstitution(e.target.value)} />
          </label>
          <label className="field">
            <span>{kind === 'debt' ? 'Utestående' : kind === 'cash' ? 'Saldo' : 'Verdi'}</span>
            <input id="item-amount" className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="F.eks. 250 000" />
          </label>
          <label className="field">
            <span>Valuta</span>
            <select id="item-currency" className="select" value={currency} onChange={(e) => setCurrency(e.target.value)}>
              {CURRENCIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
        </div>
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
        <div className="row wrap" style={{ justifyContent: 'space-between' }}>
          {item ? (
            <button type="button" className="btn danger small" onClick={() => { store.deleteBusinessItem(item.id, scope); onClose(); }}>
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

function RenameDialog({ name, onClose, onSave }: { name: string; onClose: () => void; onSave: (n: string) => void }) {
  const [value, setValue] = useState(name);
  return (
    <Dialog open onClose={onClose} title="Navn på bedriften">
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          onSave(value);
        }}
      >
        <label className="field">
          <span>Navn</span>
          <input id="biz-name" className="input" value={value} onChange={(e) => setValue(e.target.value)} placeholder="F.eks. Eksempel AS" />
        </label>
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
