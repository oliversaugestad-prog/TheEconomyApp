import { Receipt, Search, SlidersHorizontal, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  EMPTY_FILTER,
  categoryBreakdown,
  filterTransactions,
  monthlySeries,
  sortByDateDesc,
  summarizeFlows,
  type TransactionFilter,
  type TxStatusFilter,
  type TxTypeFilter,
} from '../../domain/calculations';
import { CATEGORIES, CATEGORY_BY_ID } from '../../domain/categories';
import { formatDate, monthKey } from '../../domain/dates';
import type { CategoryId, Transaction } from '../../domain/types';
import { useData, useToday } from '../../state/StoreContext';
import { CategoryBars } from '../charts/CategoryBars';
import { IncomeExpenseChart } from '../charts/IncomeExpenseChart';
import { Amount } from '../components/Amount';
import { Empty, Segmented } from '../components/common';
import { TransactionDetail } from '../components/TransactionViews';
import { Page } from '../Layout';
import { GroupedTransactions } from './AccountDetail';

const TYPE_OPTIONS: { value: TxTypeFilter; label: string }[] = [
  { value: 'all', label: 'Alle' },
  { value: 'expense', label: 'Utgifter' },
  { value: 'income', label: 'Inntekter' },
  { value: 'transfer', label: 'Overføringer' },
  { value: 'refund', label: 'Refusjoner' },
];

const PAGE_SIZE = 60;

export function TransactionsPage() {
  const data = useData();
  const today = useToday();
  const [params] = useSearchParams();
  const base = data.settings.baseCurrency;
  const [filter, setFilter] = useState<TransactionFilter>(() => ({
    ...EMPTY_FILTER,
    accountId: params.get('konto'),
    from: params.get('fra'),
    category: (params.get('kategori') as CategoryId) || null,
  }));
  const [view, setView] = useState<'list' | 'analysis'>(params.get('vis') === 'analyse' ? 'analysis' : 'list');
  const [showFilters, setShowFilters] = useState(false);
  const [openTx, setOpenTx] = useState<Transaction | null>(null);
  const [limit, setLimit] = useState(PAGE_SIZE);

  const set = (patch: Partial<TransactionFilter>) => {
    setFilter((f) => ({ ...f, ...patch }));
    setLimit(PAGE_SIZE);
  };

  // Alle filtre, lister, summer og diagrammer bruker samme filtrerte datasett.
  const filtered = useMemo(() => sortByDateDesc(filterTransactions(data.transactions, data.accounts, filter)), [data.transactions, data.accounts, filter]);
  const summary = useMemo(() => summarizeFlows(filtered, base, data.rates), [filtered, base, data.rates]);
  const breakdown = useMemo(() => categoryBreakdown(summary), [summary]);
  const lastMonth = filter.to ? monthKey(filter.to) : monthKey(today);
  // Periode: valgt fra-dato, ellers første måned med data i utvalget (maks 12 måneder).
  const earliest = filter.from ?? filtered.reduce<string | null>((m, t) => (!m || t.bookingDate < m ? t.bookingDate : m), null) ?? `${lastMonth}-01`;
  const monthCount = Math.min(12, Math.max(1, (Number(lastMonth.slice(0, 4)) - Number(earliest.slice(0, 4))) * 12 + Number(lastMonth.slice(5, 7)) - Number(earliest.slice(5, 7)) + 1));
  const series = useMemo(() => monthlySeries(filtered, lastMonth, monthCount, base, data.rates), [filtered, lastMonth, monthCount, base, data.rates]);

  const banks = [...new Set(data.accounts.map((a) => a.bankName))].sort((a, b) => a.localeCompare(b, 'nb'));
  const accountOptions = data.accounts.filter((a) => !filter.bank || a.bankName === filter.bank);
  const activeFilters: { key: keyof TransactionFilter; label: string }[] = [];
  if (filter.from) activeFilters.push({ key: 'from', label: `Fra ${formatDate(filter.from, 'short')}` });
  if (filter.to) activeFilters.push({ key: 'to', label: `Til ${formatDate(filter.to, 'short')}` });
  if (filter.bank) activeFilters.push({ key: 'bank', label: filter.bank });
  if (filter.accountId) activeFilters.push({ key: 'accountId', label: data.accounts.find((a) => a.id === filter.accountId)?.name ?? 'Konto' });
  if (filter.category) activeFilters.push({ key: 'category', label: CATEGORY_BY_ID[filter.category].label });
  if (filter.status !== 'all') activeFilters.push({ key: 'status', label: filter.status === 'pending' ? 'Reservert' : 'Bokført' });

  const clearOne = (key: keyof TransactionFilter) => set({ [key]: key === 'status' ? 'all' : null } as Partial<TransactionFilter>);

  return (
    <Page title="Transaksjoner">
      <div className="stack-sm">
        <div className="row">
          <div className="search grow">
            <Search size={18} aria-hidden="true" />
            <input
              className="input"
              type="search"
              placeholder="Søk på mottaker, tekst eller beløp"
              value={filter.query}
              onChange={(e) => set({ query: e.target.value })}
              aria-label="Søk i transaksjoner"
            />
          </div>
          <button
            type="button"
            className="btn"
            aria-expanded={showFilters}
            aria-controls="tx-filters"
            onClick={() => setShowFilters((v) => !v)}
          >
            <SlidersHorizontal size={18} aria-hidden="true" />
            <span className="desktop-only">Filter</span>
            {activeFilters.length > 0 && <span className="badge accent">{activeFilters.length}</span>}
            <span className="sr-only">Filtre</span>
          </button>
        </div>
        <div className="chips" role="group" aria-label="Transaksjonstype">
          {TYPE_OPTIONS.map((o) => (
            <button key={o.value} type="button" className="chip" aria-pressed={filter.type === o.value} onClick={() => set({ type: o.value })}>
              {o.label}
            </button>
          ))}
        </div>

        {showFilters && (
          <div id="tx-filters" className="card fade-in">
            <div className="form-grid two">
              <label className="field">
                <span>Fra dato</span>
                <input className="input" type="date" value={filter.from ?? ''} onChange={(e) => set({ from: e.target.value || null })} />
              </label>
              <label className="field">
                <span>Til dato</span>
                <input className="input" type="date" value={filter.to ?? ''} onChange={(e) => set({ to: e.target.value || null })} />
              </label>
              <label className="field">
                <span>Bank</span>
                <select className="select" value={filter.bank ?? ''} onChange={(e) => set({ bank: e.target.value || null, accountId: null })}>
                  <option value="">Alle banker</option>
                  {banks.map((b) => (
                    <option key={b}>{b}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Konto</span>
                <select className="select" value={filter.accountId ?? ''} onChange={(e) => set({ accountId: e.target.value || null })}>
                  <option value="">Alle kontoer</option>
                  {accountOptions.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} ({a.bankName})
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Kategori</span>
                <select className="select" value={filter.category ?? ''} onChange={(e) => set({ category: (e.target.value as CategoryId) || null })}>
                  <option value="">Alle kategorier</option>
                  {CATEGORIES.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Status</span>
                <select className="select" value={filter.status} onChange={(e) => set({ status: e.target.value as TxStatusFilter })}>
                  <option value="all">Bokført og reservert</option>
                  <option value="booked">Bare bokført</option>
                  <option value="pending">Bare reservert</option>
                </select>
              </label>
            </div>
            <div className="row" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
              <button type="button" className="btn ghost small" onClick={() => setFilter({ ...EMPTY_FILTER, query: filter.query })}>
                Nullstill filtre
              </button>
              <button type="button" className="btn small" onClick={() => setShowFilters(false)}>
                Lukk
              </button>
            </div>
          </div>
        )}

        {activeFilters.length > 0 && (
          <div className="chips" aria-label="Aktive filtre">
            {activeFilters.map((f) => (
              <button key={f.key} type="button" className="chip" onClick={() => clearOne(f.key)} aria-label={`Fjern filter ${f.label}`}>
                {f.label} <X size={14} aria-hidden="true" />
              </button>
            ))}
          </div>
        )}
      </div>

      <section className="card" aria-label="Sum for utvalget" aria-live="polite">
        <div className="grid cols-3" style={{ gap: 12 }}>
          <div>
            <p className="small muted">Inntekter</p>
            <p className="num" style={{ fontSize: '1.2rem', fontWeight: 620 }}>
              <Amount value={summary.income} currency={base} signed tone />
            </p>
          </div>
          <div>
            <p className="small muted">Utgifter</p>
            <p className="num" style={{ fontSize: '1.2rem', fontWeight: 620 }}>
              <Amount value={-summary.expense} currency={base} signed />
            </p>
            {summary.refunds > 0 && (
              <p className="xsmall subtle">
                etter <Amount value={summary.refunds} currency={base} /> i refusjoner
              </p>
            )}
          </div>
          <div>
            <p className="small muted">Differanse</p>
            <p className="num" style={{ fontSize: '1.2rem', fontWeight: 620 }}>
              <Amount value={summary.net} currency={base} signed tone />
            </p>
          </div>
        </div>
        <p className="xsmall subtle" style={{ marginTop: 10 }}>
          {filtered.length} transaksjoner i utvalget. Overføringer mellom egne kontoer og kortbetalinger telles ikke som inntekt eller utgift.
          {summary.skipped > 0 && ` ${summary.skipped} i fremmed valuta mangler kurs.`}
        </p>
      </section>

      <Segmented
        label="Visning"
        value={view}
        onChange={setView}
        options={[
          { value: 'list', label: 'Liste' },
          { value: 'analysis', label: 'Analyse' },
        ]}
      />

      {view === 'analysis' ? (
        <div className="grid cols-2">
          <section className="card">
            <div className="card-head">
              <h2>Utgifter per kategori</h2>
              {filter.category && (
                <button type="button" className="btn ghost small" onClick={() => set({ category: null })}>
                  Vis alle
                </button>
              )}
            </div>
            {breakdown.length ? (
              <CategoryBars shares={breakdown} currency={base} onSelect={(c) => set({ category: filter.category === c ? null : c })} selected={filter.category} />
            ) : (
              <Empty icon={<Receipt size={22} />} title="Ingen utgifter i utvalget" />
            )}
            <p className="xsmall subtle" style={{ marginTop: 12 }}>
              Trykk på en kategori for å filtrere. Refusjoner er trukket fra i kategorien de hører til.
            </p>
          </section>
          <section className="card">
            <div className="card-head">
              <h2>Inntekter mot utgifter</h2>
            </div>
            <IncomeExpenseChart points={series} currency={base} />
          </section>
        </div>
      ) : (
        <section className="card flush" aria-label="Transaksjonsliste">
          {filtered.length ? (
            <>
              <GroupedTransactions transactions={filtered.slice(0, limit)} onOpen={setOpenTx} />
              {filtered.length > limit && (
                <div style={{ padding: 16, textAlign: 'center' }}>
                  <button type="button" className="btn" onClick={() => setLimit((l) => l + PAGE_SIZE)}>
                    Vis flere ({filtered.length - limit} til)
                  </button>
                </div>
              )}
            </>
          ) : (
            <Empty
              icon={<Search size={22} />}
              title={data.transactions.length ? 'Ingen treff' : 'Ingen transaksjoner ennå'}
              action={
                data.transactions.length ? (
                  <button type="button" className="btn small" onClick={() => setFilter(EMPTY_FILTER)}>
                    Nullstill søk og filtre
                  </button>
                ) : undefined
              }
            >
              {data.transactions.length ? 'Prøv et annet søk eller fjern noen filtre.' : 'Legg til en konto og importer transaksjoner fra CSV.'}
            </Empty>
          )}
        </section>
      )}

      {openTx && <TransactionDetail key={openTx.id} tx={openTx} onClose={() => setOpenTx(null)} />}
    </Page>
  );
}
