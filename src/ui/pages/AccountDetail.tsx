import { FileUp, Pencil, Receipt, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { reservedAmount, sortByDateDesc } from '../../domain/calculations';
import { formatMonth, monthKey } from '../../domain/dates';
import type { Transaction } from '../../domain/types';
import { useData, useStore } from '../../state/StoreContext';
import { ACCOUNT_TYPE_LABEL, EditBalanceDialog } from '../components/AccountForms';
import { Amount } from '../components/Amount';
import { Dialog } from '../components/Dialog';
import { ConnectionBadge, DemoBadge, Empty, LastUpdated, Notice, Switch } from '../components/common';
import { TransactionDetail, TransactionRow } from '../components/TransactionViews';
import { Page } from '../Layout';

export function AccountDetailPage() {
  const { id } = useParams();
  const data = useData();
  const account = data.accounts.find((a) => a.id === id);
  if (!account) {
    return (
      <Page title="Konto" back={{ to: '/kontoer', label: 'Tilbake til kontoer' }}>
        <div className="card">
          <Empty icon={<Receipt size={22} />} title="Fant ikke kontoen">
            Den kan være slettet. <Link to="/kontoer">Tilbake til kontoer</Link>
          </Empty>
        </div>
      </Page>
    );
  }
  return <AccountDetail accountId={account.id} />;
}

export function GroupedTransactions({ transactions, onOpen, showAccount }: { transactions: Transaction[]; onOpen: (t: Transaction) => void; showAccount?: boolean }) {
  const data = useData();
  const accById = useMemo(() => new Map(data.accounts.map((a) => [a.id, a])), [data.accounts]);
  const groups = useMemo(() => {
    const out: { key: string; label: string; items: Transaction[] }[] = [];
    for (const t of transactions) {
      const key = t.status === 'pending' ? 'pending' : monthKey(t.bookingDate);
      let g = out.find((x) => x.key === key);
      if (!g) {
        g = { key, label: key === 'pending' ? 'Reservert – ikke bokført' : formatMonth(key), items: [] };
        out.push(g);
      }
      g.items.push(t);
    }
    return out;
  }, [transactions]);
  return (
    <>
      {groups.map((g) => (
        <div key={g.key} role="group" aria-label={g.label}>
          <div className="list-group-label">{g.label}</div>
          <ul className="list">
            {g.items.map((t) => (
              <li key={t.id}>
                <TransactionRow t={t} account={accById.get(t.accountId)} onOpen={onOpen} showAccount={showAccount} />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </>
  );
}

function AccountDetail({ accountId }: { accountId: string }) {
  const data = useData();
  const store = useStore();
  const navigate = useNavigate();
  const account = data.accounts.find((a) => a.id === accountId)!;
  const connection = data.connections.find((c) => c.id === account.connectionId);
  const [openTx, setOpenTx] = useState<Transaction | null>(null);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const txs = useMemo(() => sortByDateDesc(data.transactions.filter((t) => t.accountId === accountId)), [data.transactions, accountId]);
  const reserved = reservedAmount(accountId, data.transactions);
  const isManual = account.source === 'manual';

  return (
    <Page title={account.name} back={{ to: '/kontoer', label: 'Tilbake til kontoer' }}>
      <section className="hero">
        <p className="label">
          {account.bankName} · {ACCOUNT_TYPE_LABEL[account.type]} {account.isDemo && <DemoBadge />}
        </p>
        <p className="big">
          <Amount value={account.bookedBalance} currency={account.currency} />
        </p>
        <div className="hero-meta">
          <span>Bokført saldo</span>
          <span>{account.maskedNumber}</span>
          <span>{account.currency}</span>
        </div>
      </section>

      <div className="grid cols-2">
        <section className="card">
          <h2 style={{ marginBottom: 8 }}>Saldo</h2>
          <dl className="dl">
            <dt>Bokført saldo</dt>
            <dd>
              <Amount value={account.bookedBalance} currency={account.currency} />
            </dd>
            <dt>Tilgjengelig</dt>
            <dd>
              <Amount value={account.availableBalance} currency={account.currency} unknownLabel="Ikke oppgitt av kilden" />
            </dd>
            <dt>Reservert (ikke bokført)</dt>
            <dd>
              <Amount value={reserved} currency={account.currency} />
            </dd>
          </dl>
          <p className="xsmall subtle" style={{ marginTop: 10 }}>
            {account.availableBalance !== null && account.availableIncludesReservations
              ? 'Tilgjengelig saldo fra banken tar allerede hensyn til reservasjonene.'
              : 'Tilgjengelig saldo beregnes ikke av Saldo når kilden ikke oppgir den.'}{' '}
            {account.balanceUpdatedAt ? <LastUpdated ts={account.balanceUpdatedAt} prefix="Saldo oppdatert" /> : 'Saldo er ikke registrert.'}
          </p>
          {isManual && (
            <button type="button" className="btn small" style={{ marginTop: 12 }} onClick={() => setEditing(true)}>
              <Pencil size={16} aria-hidden="true" /> Oppdater saldo
            </button>
          )}
        </section>
        <section className="card">
          <h2 style={{ marginBottom: 8 }}>Detaljer</h2>
          <dl className="dl">
            <dt>Bank</dt>
            <dd>{account.bankName}</dd>
            <dt>Kilde</dt>
            <dd>{account.isDemo ? 'Demodata' : isManual ? 'Manuell konto' : 'Banktilkobling'}</dd>
            <dt>Status</dt>
            <dd>{connection ? <ConnectionBadge connection={connection} /> : '–'}</dd>
            <dt>Med i oversikten</dt>
            <dd>
              <Switch checked={account.includedInOverview} onChange={() => store.toggleIncluded(account.id)} label="Ta med i oversikten" />
            </dd>
          </dl>
          <div className="row wrap" style={{ marginTop: 12 }}>
            <Link to={`/kontoer/import?konto=${account.id}`} className="btn small">
              <FileUp size={16} aria-hidden="true" /> Importer CSV hit
            </Link>
            {isManual && (
              <button type="button" className="btn danger small" onClick={() => setConfirmDelete(true)}>
                <Trash2 size={16} aria-hidden="true" /> Slett konto
              </button>
            )}
          </div>
        </section>
      </div>

      {connection && connection.status !== 'ok' && connection.providerId !== 'manual' && (
        <Notice tone="warn">Dataene er fra siste vellykkede oppdatering og kan være utdaterte.</Notice>
      )}

      <section className="card flush" aria-labelledby="acc-tx">
        <div className="card-head" style={{ padding: '18px 18px 4px' }}>
          <h2 id="acc-tx">Transaksjoner</h2>
          <Link className="link" to={`/transaksjoner?konto=${account.id}`}>
            Filtrer og søk
          </Link>
        </div>
        {txs.length ? (
          <GroupedTransactions transactions={txs} onOpen={setOpenTx} showAccount={false} />
        ) : (
          <Empty icon={<Receipt size={22} />} title="Ingen transaksjoner" action={<Link to={`/kontoer/import?konto=${account.id}`} className="btn small">Importer fra CSV</Link>}>
            Importer en CSV-fil fra nettbanken for å se transaksjoner her.
          </Empty>
        )}
      </section>

      {editing && <EditBalanceDialog account={account} onClose={() => setEditing(false)} />}
      {openTx && <TransactionDetail key={openTx.id} tx={openTx} onClose={() => setOpenTx(null)} />}
      <Dialog open={confirmDelete} onClose={() => setConfirmDelete(false)} title="Slette kontoen?">
        <div className="stack">
          <p className="muted small">
            «{account.name}» og {txs.length} tilhørende transaksjoner slettes fra Saldo. Dette kan ikke angres.
          </p>
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button type="button" className="btn ghost" onClick={() => setConfirmDelete(false)}>
              Avbryt
            </button>
            <button
              type="button"
              className="btn danger"
              onClick={() => {
                store.deleteAccount(account.id);
                navigate('/kontoer');
              }}
            >
              Slett
            </button>
          </div>
        </div>
      </Dialog>
    </Page>
  );
}
