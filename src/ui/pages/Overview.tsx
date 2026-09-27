import { Bell, Briefcase, CalendarClock, Info, PiggyBank, Receipt } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  balanceSummary,
  bookedOrAvailable,
  cardDebt,
  businessBreakdown,
  categoryBreakdown,
  monthlySeries,
  monthTransactions,
  overviewTransactions,
  sortByDateDesc,
  summarizeFlows,
} from '../../domain/calculations';
import { daysBetween, formatDate, formatMonth, monthKey, relativeDay } from '../../domain/dates';
import { formatMoney } from '../../domain/money';
import { subscriptionPriceChange, subscriptionTotals } from '../../domain/subscriptions';
import { summarizeBusiness } from '../../domain/business';
import { netWorth } from '../../domain/netWorth';
import { estimateRemaining, upcomingPayments } from '../../domain/upcoming';
import type { Transaction } from '../../domain/types';
import { useData, useSnapshot, useStore, useToday } from '../../state/StoreContext';
import { CategoryBars } from '../charts/CategoryBars';
import { IncomeExpenseChart } from '../charts/IncomeExpenseChart';
import { Amount } from '../components/Amount';
import { Dialog } from '../components/Dialog';
import { Empty, LastUpdated, Notice } from '../components/common';
import { IncompleteMark, SumBreakdown } from '../components/SumBreakdown';
import { TransactionDetail, TransactionRow } from '../components/TransactionViews';
import { Page } from '../Layout';

type DetailKey = 'booked' | 'available' | 'debt' | 'net' | 'remaining' | null;

export function OverviewPage() {
  const navigate = useNavigate();
  const data = useData();
  const { syncing } = useSnapshot();
  const store = useStore();
  const today = useToday();
  const base = data.settings.baseCurrency;
  const [detail, setDetail] = useState<DetailKey>(null);
  const [openTx, setOpenTx] = useState<Transaction | null>(null);

  const balances = useMemo(() => balanceSummary(data), [data]);
  const business = data.business;
  const worth = useMemo(() => netWorth(data), [data]);
  const businessSummary = useMemo(() => (business ? summarizeBusiness(business, base, data.rates) : null), [business, base, data.rates]);
  const txs = useMemo(() => overviewTransactions(data), [data]);
  const month = monthKey(today);
  const flows = useMemo(() => summarizeFlows(monthTransactions(txs, month), base, data.rates), [txs, month, base, data.rates]);
  // Vis bare måneder vi faktisk har data for (maks seks).
  const firstMonth = useMemo(() => txs.reduce((m, t) => (t.bookingDate < m ? t.bookingDate : m), `${month}-01`).slice(0, 7), [txs, month]);
  const monthSpan = Math.min(6, Math.max(1, (Number(month.slice(0, 4)) - Number(firstMonth.slice(0, 4))) * 12 + Number(month.slice(5)) - Number(firstMonth.slice(5)) + 1));
  const series = useMemo(() => monthlySeries(txs, month, monthSpan, base, data.rates), [txs, month, monthSpan, base, data.rates]);
  const subs = useMemo(() => subscriptionTotals(data.subscriptions, base, data.rates), [data.subscriptions, base, data.rates]);
  const upcoming = useMemo(() => upcomingPayments(data.subscriptions, data.accounts, today, 30), [data.subscriptions, data.accounts, today]);
  const remaining = useMemo(() => estimateRemaining(data.accounts, upcoming, base, data.rates), [data.accounts, upcoming, base, data.rates]);
  const recent = useMemo(() => sortByDateDesc(txs).slice(0, 6), [txs]);
  const breakdown = useMemo(() => categoryBreakdown(flows), [flows]);
  const bizMonth = useMemo(() => businessBreakdown(monthTransactions(txs, month), base, data.rates), [txs, month, base, data.rates]);
  const accById = useMemo(() => new Map(data.accounts.map((a) => [a.id, a])), [data.accounts]);

  const notif = data.settings.notifications;
  const problemConnections = notif.reauthNeeded ? data.connections.filter((c) => c.status === 'reauth_required' || c.status === 'error') : [];
  const alerts = useMemo(() => {
    const out: { id: string; text: string }[] = [];
    if (notif.upcomingPayments) {
      for (const p of upcoming.filter((u) => daysBetween(today, u.date) <= 3)) {
        out.push({ id: p.id, text: `${p.name} (${formatMoney(p.amount, p.currency)}) ${relativeDay(p.date, today)}${p.estimated ? ', estimert' : ''}.` });
      }
    }
    if (notif.priceChanges) {
      for (const sub of data.subscriptions.filter((x) => x.status === 'active')) {
        const change = subscriptionPriceChange(sub, data.transactions);
        if (change && daysBetween(change.date, today) <= 45) {
          out.push({ id: `pc-${sub.id}`, text: `${sub.name} trakk ${formatMoney(change.to, sub.currency)} ${formatDate(change.date, 'short')}, mot ${formatMoney(change.from, sub.currency)} før. Mulig prisendring.` });
        }
      }
    }
    if (notif.largeTransactions) {
      for (const t of txs.filter((x) => x.kind === 'normal' && x.amount <= -500_000 && daysBetween(x.bookingDate, today) <= 7)) {
        out.push({ id: `lg-${t.id}`, text: `Stor utgift: ${t.counterparty} ${formatMoney(t.amount, t.currency)} ${relativeDay(t.bookingDate, today)}.` });
      }
    }
    return out;
  }, [notif, upcoming, today, data.subscriptions, data.transactions, txs]);
  // Konkrete poster som gjør summene ufullstendige, med snarvei til å rette dem.
  const missingValues = useMemo(() => {
    const out: { id: string; text: string; to: string; action: string }[] = [];
    const rateOk = (c: string) => c === base || data.rates.some((r) => r.currency === c && r.base === base);
    for (const a of data.accounts.filter((x) => x.includedInOverview)) {
      if (a.type === 'credit_card' && a.bookedBalance === null) {
        out.push({ id: a.id, text: `${a.name} (${a.bankName}): utestående gjeld er ikke oppgitt.`, to: `/kort/${a.id}?rediger=1`, action: 'Legg inn gjeld' });
      } else if (a.type !== 'credit_card' && a.bookedBalance === null && a.availableBalance === null) {
        out.push({ id: a.id, text: `${a.name} (${a.bankName}): saldo er ukjent.`, to: `/kontoer/${a.id}`, action: 'Oppdater saldo' });
      } else if (!rateOk(a.currency)) {
        out.push({ id: a.id, text: `${a.name}: valutakurs for ${a.currency} mangler.`, to: `/kontoer/${a.id}`, action: 'Se kontoen' });
      }
    }
    return out;
  }, [data.accounts, data.rates, base]);
  const lastSync = data.connections
    .filter((c) => c.lastSuccessfulSync && c.status !== 'disconnected')
    .map((c) => c.lastSuccessfulSync!)
    .sort()
    .reverse()[0] ?? null;

  if (data.accounts.length === 0) {
    return (
      <Page title="Oversikt">
        <div className="card">
          <Empty
            icon={<PiggyBank size={24} />}
            title="Ingen kontoer ennå"
            action={
              <div className="row wrap" style={{ justifyContent: 'center' }}>
                <Link to="/kontoer?ny=1" className="btn primary">
                  Legg til konto manuelt
                </Link>
                <Link to="/kontoer/import" className="btn">
                  Importer CSV
                </Link>
                <button type="button" className="btn ghost" onClick={() => store.loadDemo()}>
                  Utforsk med demodata
                </button>
              </div>
            }
          >
            Legg til en konto manuelt eller importer transaksjoner fra en CSV-fil. Ekte banktilkobling er ikke aktivert i denne versjonen.
          </Empty>
        </div>
      </Page>
    );
  }

  return (
    <Page title="Oversikt">
      {problemConnections.map((c) => (
        <Notice key={c.id} tone={c.status === 'error' ? 'error' : 'warn'} title={`${c.institutionName}: ${c.status === 'reauth_required' ? 'må kobles til på nytt' : 'oppdatering feilet'}`}>
          {c.error} Tallene fra denne banken er fra <LastUpdated ts={c.lastSuccessfulSync} prefix="" /> og kan være utdaterte.{' '}
          <Link to="/kontoer">Gå til kontoer</Link>
        </Notice>
      ))}

      {missingValues.length > 0 && (
        <Notice tone="warn" title="Hvorfor noen tall er merket «Ufullstendig»">
          Disse beløpene er ukjente, og regnes ikke som 0:
          <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
            {missingValues.map((m) => (
              <li key={m.id}>
                {m.text} <Link to={m.to}>{m.action}</Link>
              </li>
            ))}
          </ul>
        </Notice>
      )}

      {alerts.length > 0 && (
        <section className="card" aria-labelledby="alerts-h">
          <div className="card-head" style={{ marginBottom: 8 }}>
            <h2 id="alerts-h" className="row" style={{ gap: 8 }}>
              <Bell size={18} aria-hidden="true" /> Varsler
            </h2>
            <Link className="link" to="/innstillinger">
              Innstillinger
            </Link>
          </div>
          <ul className="small muted" style={{ margin: 0, paddingLeft: 18 }}>
            {alerts.map((a) => (
              <li key={a.id}>{a.text}</li>
            ))}
          </ul>
        </section>
      )}

      <div className="grid overview">
        <section className="hero" aria-labelledby="hero-label">
          <p className="label" id="hero-label">
            Samlet kontosaldo <IncompleteMark complete={balances.booked.complete} />
          </p>
          <p className="big">
            <Amount value={balances.booked.amount} currency={base} />
          </p>
          <div className="hero-meta">
            <span>
              {balances.bankAccounts.length} kontoer i {new Set(balances.bankAccounts.map((a) => a.bankName)).size} banker
            </span>
            {balances.booked.conversions.length > 0 && <span>Inkl. omregnet valuta</span>}
            <span aria-live="polite">{syncing.length ? 'Oppdaterer …' : <LastUpdated ts={lastSync} />}</span>
          </div>
          <div className="hero-actions">
            <button type="button" className="btn glass small" onClick={() => setDetail('booked')}>
              Se hva som inngår
            </button>
            <Link to="/kontoer" className="btn glass small">
              Kontoer
            </Link>
          </div>
        </section>

        <div className="metrics">
          <button type="button" className="metric" onClick={() => setDetail('available')}>
            <span className="m-label">
              Tilgjengelig <IncompleteMark complete={balances.available.complete} />
            </span>
            <span className="m-value">
              <Amount value={balances.available.amount} currency={base} />
            </span>
            <span className="m-foot">{balances.available.complete ? 'Slik bankene oppgir det' : `${balances.available.missing.length} konto(er) oppgir ikke`}</span>
          </button>
          <button type="button" className="metric" onClick={() => setDetail('debt')}>
            <span className="m-label">
              Kredittkortgjeld <IncompleteMark complete={balances.cardDebt.complete} />
            </span>
            <span className="m-value">
              <Amount value={balances.cardDebt.amount} currency={base} />
            </span>
            <span className="m-foot">
              {balances.cardReserved.amount > 0 ? (
                <>
                  + <Amount value={balances.cardReserved.amount} currency={base} /> reservert
                </>
              ) : (
                `${balances.cards.length} kort`
              )}
            </span>
          </button>
          <button type="button" className="metric" onClick={() => setDetail('net')}>
            <span className="m-label">
              Saldo minus kortgjeld <IncompleteMark complete={balances.net.complete} />
            </span>
            <span className="m-value">
              <Amount value={balances.net.amount} currency={base} />
            </span>
            <span className="m-foot">Se utregning</span>
          </button>
          <Link to="/formue" className="metric" style={{ textDecoration: 'none', color: 'inherit' }}>
            <span className="m-label">
              Nettoformue <IncompleteMark complete={worth.complete} />
            </span>
            <span className="m-value">
              <Amount value={worth.business ? worth.totalWithBusiness : worth.total} currency={base} />
            </span>
            <span className="m-foot">{worth.business ? 'I ditt navn, med bedriften' : 'Alt i ditt navn'}</span>
          </Link>
          {business && (business.items.length > 0 || business.holdings.length > 0) && (
            <Link to="/bedrift" className="metric" style={{ textDecoration: 'none', color: 'inherit' }}>
              <span className="m-label">{business.name}</span>
              <span className="m-value">
                <Amount value={businessSummary!.total} currency={base} />
              </span>
              <span className="m-foot">Bedrift · holdes utenfor privat oversikt</span>
            </Link>
          )}
          <Link to="/abonnementer" className="metric" style={{ textDecoration: 'none', color: 'inherit' }}>
            <span className="m-label">Abonnementer</span>
            <span className="m-value">
              <Amount value={subs.monthly.amount} currency={base} />
            </span>
            <span className="m-foot">per måned · {subs.count} aktive</span>
          </Link>
        </div>
      </div>

      <div className="grid overview">
        <section className="card" aria-labelledby="month-h">
          <div className="card-head">
            <h2 id="month-h">{formatMonth(month).replace(/^./, (c) => c.toUpperCase())}</h2>
            <Link className="link" to={`/transaksjoner?fra=${month}-01`}>
              Se transaksjoner
            </Link>
          </div>
          <div className="grid cols-3" style={{ gap: 12, marginBottom: 18 }}>
            <div>
              <p className="small muted">Inntekter</p>
              <p className="num" style={{ fontSize: '1.3rem', fontWeight: 620 }}>
                <Amount value={flows.income} currency={base} signed tone />
              </p>
            </div>
            <div>
              <p className="small muted">Utgifter</p>
              <p className="num" style={{ fontSize: '1.3rem', fontWeight: 620 }}>
                <Amount value={-flows.expense} currency={base} signed />
              </p>
              {flows.pendingExpense > 0 && (
                <p className="xsmall subtle">
                  herav <Amount value={flows.pendingExpense} currency={base} /> reservert
                </p>
              )}
            </div>
            <div>
              <p className="small muted">Differanse</p>
              <p className="num" style={{ fontSize: '1.3rem', fontWeight: 620 }}>
                <Amount value={flows.net} currency={base} signed tone />
              </p>
              <p className="xsmall subtle">{flows.net >= 0 ? 'Mer inn enn ut' : 'Mer ut enn inn'}</p>
            </div>
          </div>
          <IncomeExpenseChart points={series} currency={base} />
          <p className="xsmall subtle" style={{ marginTop: 10 }}>
            Overføringer mellom egne kontoer og betaling av kredittkort er holdt utenfor. Refusjoner trekkes fra utgiftene.
            {flows.skipped > 0 && ` ${flows.skipped} transaksjon(er) i fremmed valuta mangler kurs og er ikke med.`}
          </p>
        </section>

        <section className="card" aria-labelledby="cat-h">
          <div className="card-head">
            <h2 id="cat-h">Utgifter per kategori · {formatMonth(month)}</h2>
            <Link className="link" to="/transaksjoner?vis=analyse">
              Analyse
            </Link>
          </div>
          {breakdown.length ? (
            <CategoryBars shares={breakdown} currency={base} onSelect={(c) => navigate(`/transaksjoner?kategori=${c}&fra=${month}-01`)} />
          ) : (
            <Empty icon={<Receipt size={22} />} title="Ingen utgifter denne måneden" />
          )}
          {bizMonth.shares.length > 0 && (
            <div className="biz-block">
              <div className="spread">
                <p className="small" style={{ fontWeight: 600 }}>
                  <Briefcase size={14} aria-hidden="true" style={{ verticalAlign: -2 }} /> Betalt for bedriften
                </p>
                <Amount value={bizMonth.total} currency={base} className="small" />
              </div>
              <p className="xsmall subtle" style={{ marginBottom: 8 }}>Egen post – ikke med i prosentene eller utgiftene over.</p>
              <CategoryBars
                shares={bizMonth.shares}
                currency={base}
                labelSuffix=" – Bedrift"
                hideShare
                onSelect={(c) => navigate(`/transaksjoner?type=business&kategori=${c}&fra=${month}-01`)}
              />
            </div>
          )}
        </section>
      </div>

      <div className="grid overview">
        <section className="card flush" aria-labelledby="recent-h">
          <div className="card-head" style={{ padding: '18px 18px 0' }}>
            <h2 id="recent-h">Siste transaksjoner</h2>
            <Link className="link" to="/transaksjoner">
              Se alle
            </Link>
          </div>
          {recent.length ? (
            <ul className="list">
              {recent.map((t) => (
                <li key={t.id}>
                  <TransactionRow t={t} account={accById.get(t.accountId)} onOpen={setOpenTx} />
                </li>
              ))}
            </ul>
          ) : (
            <Empty icon={<Receipt size={22} />} title="Ingen transaksjoner ennå" />
          )}
        </section>

        <section className="card flush" aria-labelledby="up-h">
          <div className="card-head" style={{ padding: '18px 18px 0' }}>
            <h2 id="up-h">Kommende betalinger</h2>
            <span className="xsmall subtle">neste 30 dager</span>
          </div>
          {upcoming.length ? (
            <ul className="list">
              {upcoming.slice(0, 6).map((p) => (
                <li key={p.id} className="list-item" style={{ cursor: 'default' }}>
                  <span className="avatar" aria-hidden="true">
                    <CalendarClock size={18} />
                  </span>
                  <span className="li-main">
                    <span className="li-title" style={{ display: 'block' }}>
                      {p.name}
                    </span>
                    <span className="li-sub" style={{ display: 'block' }}>
                      {relativeDay(p.date, today)} · {p.estimated ? 'estimert dato' : 'forfall oppgitt'}
                      {p.accountId && accById.get(p.accountId) ? ` · ${accById.get(p.accountId)!.name}` : ''}
                    </span>
                  </span>
                  <span className="li-end">
                    <Amount value={-p.amount} currency={p.currency} signed />
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <Empty icon={<CalendarClock size={22} />} title="Ingen kjente betalinger" >
              Bekreft abonnementer eller registrer kortfaktura for å se kommende trekk.
            </Empty>
          )}
          <div style={{ padding: 18, borderTop: '1px solid var(--border)' }}>
            <button type="button" className="metric" style={{ background: 'var(--surface-2)' }} onClick={() => setDetail('remaining')}>
              <span className="m-label">
                Estimert igjen etter kommende betalinger <Info size={14} aria-hidden="true" />
                <IncompleteMark complete={remaining.complete} />
              </span>
              <span className="m-value">
                <Amount value={remaining.remaining} currency={base} />
              </span>
              <span className="m-foot">Anslag for brukskontoer – ikke et garantert disponibelt beløp. Trykk for forutsetninger.</span>
            </button>
          </div>
        </section>
      </div>

      <Dialog open={detail === 'booked'} onClose={() => setDetail(null)} title="Samlet kontosaldo">
        <SumBreakdown
          sum={balances.booked}
          accounts={balances.bankAccounts}
          valueOf={bookedOrAvailable}
          totalLabel="Samlet bokført saldo"
          explanation={
            <>
              Summen av bokført saldo på bankkontoene som inngår i oversikten. Kredittkort, kredittgrenser og tilgjengelig kreditt er ikke med – det er ikke dine egne penger.{' '}
              {balances.bookedSubstituted.length > 0 && (
                <>
                  For {[...new Set(balances.bookedSubstituted.map((a) => a.bankName))].join(', ')} er tilgjengelig saldo brukt, fordi banken ikke oppgir bokført saldo.{' '}
                </>
              )}
              <Link to="/kontoer" onClick={() => setDetail(null)}>
                Velg kontoer
              </Link>
            </>
          }
        />
      </Dialog>
      <Dialog open={detail === 'available'} onClose={() => setDetail(null)} title="Tilgjengelig på bankkontoer">
        <SumBreakdown
          sum={balances.available}
          accounts={balances.bankAccounts}
          valueOf={(a) => a.availableBalance}
          totalLabel="Sum tilgjengelig (kjent)"
          explanation="Tilgjengelig saldo slik banken oppgir den. Bankene tar allerede hensyn til reservasjoner her, så Saldo trekker dem ikke fra på nytt. Kontoer der banken ikke oppgir tallet, er ikke regnet som 0."
        />
      </Dialog>
      <Dialog open={detail === 'debt'} onClose={() => setDetail(null)} title="Kredittkortgjeld">
        <SumBreakdown
          sum={balances.cardDebt}
          accounts={balances.cards}
          valueOf={cardDebt}
          totalLabel="Samlet bokført gjeld"
          explanation={
            <>
              Bokført utestående på kortene. Reserverte kjøp ({<Amount value={balances.cardReserved.amount} currency={base} />}) er ikke bokført ennå og vises separat.{' '}
              <Link to="/kort" onClick={() => setDetail(null)}>
                Se kortene
              </Link>
            </>
          }
        />
      </Dialog>
      <Dialog open={detail === 'net'} onClose={() => setDetail(null)} title="Kontosaldo minus kredittkortgjeld">
        <div className="stack">
          <div className="calc">
            <span className="op" aria-hidden="true" />
            <span>Samlet bokført kontosaldo</span>
            <Amount value={balances.booked.amount} currency={base} />
            <span className="op" aria-label="minus">
              −
            </span>
            <span>Bokført kredittkortgjeld</span>
            <Amount value={balances.cardDebt.amount} currency={base} />
            <span className="line" />
            <span className="op" aria-label="er lik">
              =
            </span>
            <strong>Saldo minus kortgjeld</strong>
            <strong>
              <Amount value={balances.net.amount} currency={base} />
            </strong>
          </div>
          <p className="small muted">
            Viser hva du sitter igjen med om all bokført kortgjeld ble betalt fra bankkontoene i dag. Reserverte kortkjøp, kredittgrenser og lån er ikke med.
          </p>
          {!balances.net.complete && (
            <Notice tone="warn" title="Ufullstendig">
              En eller flere kontoer eller kort mangler saldo eller valutakurs. Se detaljene for kontosaldo og kortgjeld.
            </Notice>
          )}
        </div>
      </Dialog>
      <Dialog open={detail === 'remaining'} onClose={() => setDetail(null)} title="Estimert igjen etter kommende betalinger">
        <div className="stack">
          <div className="calc">
            <span className="op" aria-hidden="true" />
            <span>Tilgjengelig på brukskontoer</span>
            <Amount value={remaining.available} currency={base} />
            {remaining.deductions.map((d) => (
              <div key={d.id} style={{ display: 'contents' }}>
                <span className="op" aria-label="minus">
                  −
                </span>
                <span>
                  {d.name} <span className="xsmall subtle">({d.date ? `${formatDate(d.date, 'short')}, ` : ''}{d.estimated ? 'estimert' : 'oppgitt'})</span>
                </span>
                <Amount value={d.amount} currency={d.currency} />
              </div>
            ))}
            <span className="line" />
            <span className="op" aria-label="er lik">
              =
            </span>
            <strong>Estimert igjen</strong>
            <strong>
              <Amount value={remaining.remaining} currency={base} />
            </strong>
          </div>
          <Notice title="Forutsetninger">
            <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
              <li>Gjelder de neste 30 dagene. Sparekontoer og BSU er ikke med.</li>
              {remaining.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
              <li>Andre utgifter som ikke er kjente faste betalinger, er ikke trukket fra. Dette er ikke et garantert disponibelt beløp.</li>
            </ul>
          </Notice>
        </div>
      </Dialog>
      {openTx && <TransactionDetail key={openTx.id} tx={openTx} onClose={() => setOpenTx(null)} />}
    </Page>
  );
}
