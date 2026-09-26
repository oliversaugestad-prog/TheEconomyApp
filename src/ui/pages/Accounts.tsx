import { FileUp, Landmark, Link2, Plus, RefreshCw, Unplug } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { availableCredit, cardDebt, reservedAmount } from '../../domain/calculations';
import { formatTimestamp } from '../../domain/dates';
import { sumMoney } from '../../domain/money';
import type { Account, Connection } from '../../domain/types';
import { EB_PROVIDER_ID, sessionIdOf } from '../../providers/enableBanking';
import { BankApiError, callBank } from '../../backend/supabase';
import { ConnectBankDialog, startBankLogin } from '../components/ConnectBank';
import { useBankStatus } from '../BankBridge';
import { useData, useSnapshot, useStore } from '../../state/StoreContext';
import { ACCOUNT_TYPE_LABEL, AddAccountDialog } from '../components/AccountForms';
import { Amount } from '../components/Amount';
import { Dialog } from '../components/Dialog';
import { ConnectionBadge, DemoBadge, Empty, LastUpdated, Notice, Switch } from '../components/common';
import { IncompleteMark } from '../components/SumBreakdown';
import { Page } from '../Layout';

export function AccountsPage() {
  const data = useData();
  const { syncing } = useSnapshot();
  const [params, setParams] = useSearchParams();
  const [adding, setAdding] = useState(params.get('ny') === '1');
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState<Connection | null>(null);
  const base = data.settings.baseCurrency;

  useEffect(() => {
    if (params.get('ny') === '1') {
      setAdding(true);
      setParams({}, { replace: true });
    }
  }, [params, setParams]);

  const groups = useMemo(
    () =>
      data.connections
        .map((c) => ({ connection: c, accounts: data.accounts.filter((a) => a.connectionId === c.id) }))
        .filter((g) => g.accounts.length > 0)
        .sort((a, b) => a.connection.institutionName.localeCompare(b.connection.institutionName, 'nb')),
    [data.connections, data.accounts],
  );

  return (
    <Page
      title="Kontoer"
      actions={
        <button type="button" className="btn primary small desktop-only" onClick={() => setAdding(true)}>
          <Plus size={16} aria-hidden="true" /> Legg til konto
        </button>
      }
    >
      <div className="row wrap">
        <button type="button" className="btn small mobile-only" onClick={() => setAdding(true)}>
          <Plus size={16} aria-hidden="true" /> Manuell konto
        </button>
        <Link to="/kontoer/import" className="btn small">
          <FileUp size={16} aria-hidden="true" /> Importer CSV
        </Link>
        <button type="button" className="btn small" onClick={() => setConnecting(true)}>
          <Link2 size={16} aria-hidden="true" /> Koble til bank
        </button>
      </div>

      {groups.length === 0 && (
        <div className="card">
          <Empty icon={<Landmark size={24} />} title="Ingen kontoer">
            Legg til en manuell konto eller importer fra CSV.
          </Empty>
        </div>
      )}

      {groups.map(({ connection, accounts }) => {
        const bankAccounts = accounts.filter((a) => a.type !== 'credit_card');
        const cards = accounts.filter((a) => a.type === 'credit_card');
        const total = sumMoney(
          bankAccounts.map((a) => ({ id: a.id, label: a.name, amount: a.bookedBalance, currency: a.currency })),
          base,
          data.rates,
        );
        const isSyncing = syncing.includes(connection.id);
        const stale = connection.status !== 'ok' && connection.providerId !== 'manual';
        return (
          <section key={connection.id} className="card flush" aria-labelledby={`bank-${connection.id}`}>
            <div style={{ padding: '18px 18px 12px' }} className="stack-sm">
              <div className="spread" style={{ alignItems: 'flex-start', flexWrap: 'wrap' }}>
                <div className="row" style={{ alignItems: 'flex-start', flex: '1 1 220px' }}>
                  <span className="avatar" aria-hidden="true">
                    <Landmark size={18} />
                  </span>
                  <div className="grow">
                    <h2 id={`bank-${connection.id}`} className="row wrap" style={{ gap: 8 }}>
                      {connection.institutionName} {connection.isDemo && <DemoBadge />}
                    </h2>
                    <div className="row wrap small subtle" style={{ gap: 8, marginTop: 4 }}>
                      <ConnectionBadge connection={connection} syncing={isSyncing} />
                      {connection.providerId !== 'manual' && <LastUpdated ts={connection.lastSuccessfulSync} />}
                    </div>
                  </div>
                </div>
                {bankAccounts.length > 0 && (
                  <div style={{ textAlign: 'right', marginLeft: 'auto' }}>
                    <p className="xsmall subtle">Sum kontoer</p>
                    <p className="num" style={{ fontWeight: 650, fontSize: '1.1rem' }}>
                      <Amount value={total.amount} currency={base} />
                    </p>
                    <IncompleteMark complete={total.complete} />
                  </div>
                )}
              </div>
              {stale && connection.error && (
                <Notice tone={connection.status === 'reauth_required' ? 'warn' : 'error'}>
                  {connection.error} Tidligere hentede data vises, men kan være utdaterte.
                </Notice>
              )}
              {connection.status === 'disconnected' && (
                <Notice>Frakoblet. Tidligere hentede data er beholdt og oppdateres ikke. Du kan slette dem under «Koble fra».</Notice>
              )}
              <ConnectionActions connection={connection} busy={isSyncing} onDisconnect={() => setDisconnecting(connection)} />
            </div>
            <ul className="list" style={{ borderTop: '1px solid var(--border)' }}>
              {[...bankAccounts, ...cards].map((a) => (
                <li key={a.id}>
                  <AccountRow account={a} />
                </li>
              ))}
            </ul>
          </section>
        );
      })}

      <p className="small subtle">
        Bruk bryteren for å velge hvilke kontoer og kort som inngår i oversikten. Kredittkort vises her, men telles aldri med i kontosaldoen.
      </p>

      <AddAccountDialog open={adding} onClose={() => setAdding(false)} />
      <ConnectBankDialog open={connecting} onClose={() => setConnecting(false)} />
      {disconnecting && <DisconnectDialog connection={disconnecting} onClose={() => setDisconnecting(null)} />}
    </Page>
  );
}

function ConnectionActions({ connection, busy, onDisconnect }: { connection: Connection; busy: boolean; onDisconnect: () => void }) {
  const store = useStore();
  const { status } = useBankStatus();
  const [reconnecting, setReconnecting] = useState(false);
  if (connection.providerId === 'manual') return null;
  const session = status?.sessions.find((s) => `eb-${s.id}` === connection.id);
  const reconnect = async () => {
    setReconnecting(true);
    try {
      await startBankLogin({ name: connection.institutionName, country: session?.aspspCountry ?? 'NO', maxConsentSeconds: null });
    } catch (e) {
      store.notify('error', e instanceof BankApiError ? e.message : 'Kunne ikke starte ny innlogging.');
      setReconnecting(false);
    }
  };
  return (
    <div className="row wrap" style={{ gap: 8 }}>
      {connection.providerId === EB_PROVIDER_ID && (connection.status === 'reauth_required' || connection.status === 'disconnected') && (
        <button type="button" className="btn primary small" disabled={reconnecting} onClick={reconnect}>
          <RefreshCw size={16} className={reconnecting ? 'spin' : ''} aria-hidden="true" /> Koble til på nytt med BankID
        </button>
      )}
      {connection.status === 'reauth_required' && connection.isDemo && (
        <button type="button" className="btn primary small" disabled={busy} onClick={() => store.reauthorizeDemo(connection.id)}>
          <RefreshCw size={16} aria-hidden="true" /> Forny samtykke (demo)
        </button>
      )}
      {connection.status !== 'disconnected' && connection.status !== 'reauth_required' && (
        <button type="button" className="btn small" disabled={busy} onClick={() => store.syncConnection(connection.id)}>
          <RefreshCw size={16} className={busy ? 'spin' : ''} aria-hidden="true" /> {busy ? 'Oppdaterer …' : 'Oppdater nå'}
        </button>
      )}
      <button type="button" className="btn ghost small" onClick={onDisconnect}>
        <Unplug size={16} aria-hidden="true" /> Koble fra
      </button>
    </div>
  );
}

function AccountRow({ account: a }: { account: Account }) {
  const store = useStore();
  const data = useData();
  const isCard = a.type === 'credit_card';
  const reserved = reservedAmount(a.id, data.transactions);
  return (
    <div className="list-item" style={{ cursor: 'default', flexWrap: 'wrap', rowGap: 8 }}>
      <Link to={isCard ? `/kort/${a.id}` : `/kontoer/${a.id}`} className="li-main" style={{ color: 'inherit', textDecoration: 'none', minWidth: 160 }}>
        <span className="li-title" style={{ display: 'block' }}>
          {a.name}
        </span>
        <span className="li-sub" style={{ display: 'block' }}>
          {ACCOUNT_TYPE_LABEL[a.type]} · {a.currency} · {a.maskedNumber}
        </span>
      </Link>
      <div className="li-end">
        {isCard ? (
          <>
            <p className="num" style={{ fontWeight: 600 }}>
              Gjeld <Amount value={cardDebt(a)} currency={a.currency} />
            </p>
            <p className="xsmall subtle">
              Tilgj. kreditt <Amount value={availableCredit(a, data.transactions)} currency={a.currency} unknownLabel="ikke oppgitt" />
            </p>
          </>
        ) : (
          <>
            <p className="num" style={{ fontWeight: 600 }}>
              <Amount value={a.bookedBalance} currency={a.currency} />
            </p>
            <p className="xsmall subtle">
              Tilgjengelig <Amount value={a.availableBalance} currency={a.currency} unknownLabel="ikke oppgitt" />
              {reserved > 0 && (
                <>
                  {' '}
                  · <Amount value={reserved} currency={a.currency} /> reservert
                </>
              )}
            </p>
          </>
        )}
      </div>
      <label className="row small" style={{ gap: 8, flex: 'none', cursor: 'pointer' }}>
        <Switch checked={a.includedInOverview} onChange={() => store.toggleIncluded(a.id)} label={`Ta med ${a.name} i oversikten`} />
        <span className="subtle xsmall desktop-only">I oversikt</span>
      </label>
    </div>
  );
}

function DisconnectDialog({ connection, onClose }: { connection: Connection; onClose: () => void }) {
  const store = useStore();
  const data = useData();
  const accounts = data.accounts.filter((a) => a.connectionId === connection.id);
  const txCount = data.transactions.filter((t) => accounts.some((a) => a.id === t.accountId)).length;
  const tz = data.settings.timeZone;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Ekte tilkobling: trekk tilbake samtykket hos Enable Banking først.
  const revoke = async (): Promise<boolean> => {
    if (connection.providerId !== EB_PROVIDER_ID || connection.status === 'disconnected') return true;
    setBusy(true);
    setError(null);
    try {
      await callBank('disconnect', { sessionId: sessionIdOf(connection) });
      return true;
    } catch (e) {
      setError(e instanceof BankApiError ? e.message : 'Kunne ikke koble fra hos banken.');
      return false;
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onClose={onClose} title={`Koble fra ${connection.institutionName}`}>
      <div className="stack">
        <p className="small muted">
          Å koble fra stopper videre henting av data. Det er noe annet enn å slette dataene som allerede er lagret: {accounts.length} konto(er) og {txCount} transaksjoner
          {connection.lastSuccessfulSync ? ` (sist hentet ${formatTimestamp(connection.lastSuccessfulSync, tz)})` : ''}.
        </p>
        {connection.providerId === EB_PROVIDER_ID && (
          <p className="small muted">Samtykket hos Enable Banking trekkes tilbake. Du kan også se og trekke tilbake samtykker i nettbanken din.</p>
        )}
        {error && <Notice tone="error">{error}</Notice>}
        <div className="stack-sm">
          <button
            type="button"
            className="btn block"
            onClick={async () => {
              if (await revoke()) {
                store.disconnect(connection.id, false);
                onClose();
              }
            }}
            disabled={connection.status === 'disconnected' || busy}
          >
            Koble fra, men behold data
          </button>
          <button
            type="button"
            className="btn danger block"
            disabled={busy}
            onClick={async () => {
              if (await revoke()) {
                store.disconnect(connection.id, true);
                onClose();
              }
            }}
          >
            Koble fra og slett lagrede data
          </button>
          <button type="button" className="btn ghost block" onClick={onClose}>
            Avbryt
          </button>
        </div>
      </div>
    </Dialog>
  );
}
