import { Download, FlaskConical, Link2, ShieldCheck, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { CATEGORY_BY_ID } from '../../domain/categories';
import { formatTimestamp } from '../../domain/dates';
import type { Accent, NotificationSettings } from '../../domain/types';
import { useData, useStore } from '../../state/StoreContext';
import { Dialog } from '../components/Dialog';
import { ConnectionBadge, DemoBadge, Notice, Segmented, Switch } from '../components/common';
import { Page } from '../Layout';
import { ConnectBankDialog } from '../components/ConnectBank';
import { BankSetup } from '../components/BankSetup';
import { useBackend } from '../../backend/session';

const CURRENCIES = ['NOK', 'EUR', 'SEK', 'DKK', 'USD', 'GBP'];

const NOTIFICATIONS: { key: keyof NotificationSettings; label: string; hint: string }[] = [
  { key: 'reauthNeeded', label: 'Bank må kobles til på nytt', hint: 'Vis varsel når en tilkobling feiler eller samtykket har utløpt.' },
  { key: 'upcomingPayments', label: 'Kommende betalinger', hint: 'Vis betalinger som forfaller de neste tre dagene.' },
  { key: 'priceChanges', label: 'Mulige prisendringer', hint: 'Vis varsel når et abonnement trekker et annet beløp enn før.' },
  { key: 'largeTransactions', label: 'Store transaksjoner', hint: 'Vis utgifter over 5 000 kr de siste sju dagene.' },
];

export function SettingsPage() {
  const data = useData();
  const store = useStore();
  const location = useLocation();
  const s = data.settings;
  const [confirm, setConfirm] = useState<'demo' | 'all' | null>(null);
  const [connecting, setConnecting] = useState(false);
  const hasDemo = store.hasDemoData();
  const backend = useBackend();
  const remote = backend.mode === 'remote';
  const hasBank = data.connections.some((c) => c.providerId === 'enablebanking' && c.status !== 'disconnected');
  const ownAccounts = data.accounts.filter((a) => !a.isDemo);
  const foreign = [...new Set(data.accounts.map((a) => a.currency).filter((c) => c !== s.baseCurrency))];

  useEffect(() => {
    if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView({ block: 'start' });
  }, [location.hash]);

  const exportData = () => {
    const blob = new Blob([store.exportJson()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `saldo-eksport-${store.today()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <Page title="Innstillinger" plain>
      <section className="card stack" id="data" aria-labelledby="mode-h">
        <div className="spread">
          <h2 id="mode-h">Datakilde</h2>
          {hasDemo ? <DemoBadge /> : <span className="badge ok">Egne data</span>}
        </div>
        {hasDemo ? (
          <Notice tone="warn" title="Demomodus er aktiv">
            Bankene «Nordlys Bank», «Fjordsparebanken» og «Vidde Kreditt» er fiktive, og alle tall er syntetiske. Ingen ekte bank er tilkoblet.
          </Notice>
        ) : (
          <Notice title="Egne data">
            {hasBank ? 'Du bruker data fra tilkoblede banker, i tillegg til eventuelle manuelle kontoer og CSV-import.' : 'Du bruker manuelle kontoer og CSV-import. Ingen bank er tilkoblet ennå.'}
          </Notice>
        )}
        <p className="small muted">
          Du har {ownAccounts.length} egne kontoer. Å fjerne demodata sletter bare demokontoene og transaksjonene deres – egne kontoer og importerte data beholdes.
        </p>
        <div className="row wrap">
          {hasDemo ? (
            <button type="button" className="btn" onClick={() => setConfirm('demo')}>
              <FlaskConical size={16} aria-hidden="true" /> Fjern demodata
            </button>
          ) : remote ? null : (
            <button type="button" className="btn" onClick={() => store.loadDemo()}>
              <FlaskConical size={16} aria-hidden="true" /> Last inn demodata
            </button>
          )}
          {hasDemo && (
            <button type="button" className="btn ghost" onClick={() => store.loadDemo()}>
              Tilbakestill demodata
            </button>
          )}
        </div>
      </section>

      <BankSetup />

      <section className="card flush" aria-labelledby="conn-h">
        <div className="card-head" style={{ padding: '18px 18px 0' }}>
          <h2 id="conn-h">Banktilkoblinger og manuelle kontoer</h2>
          <Link className="link" to="/kontoer">
            Administrer
          </Link>
        </div>
        <ul className="list" style={{ marginTop: 8 }}>
          {data.connections.map((c) => (
            <li key={c.id} className="list-item" style={{ cursor: 'default' }}>
              <span className="li-main">
                <span className="li-title" style={{ display: 'block' }}>
                  {c.institutionName}
                </span>
                <span className="li-sub" style={{ display: 'block' }}>
                  {c.providerId === 'manual' ? 'Manuell' : c.isDemo ? 'Demotilkobling' : 'Banktilkobling'} · {data.accounts.filter((a) => a.connectionId === c.id).length} kontoer
                  {c.consentExpiresAt && c.status === 'ok' ? ` · samtykke til ${formatTimestamp(c.consentExpiresAt, s.timeZone).split(',')[0]}` : ''}
                </span>
              </span>
              <ConnectionBadge connection={c} />
            </li>
          ))}
          {data.connections.length === 0 && <li className="list-item muted small">Ingen tilkoblinger eller manuelle kontoer.</li>}
        </ul>
        <div style={{ padding: 18 }}>
          <button type="button" className="btn small" onClick={() => setConnecting(true)}>
            <Link2 size={16} aria-hidden="true" /> Koble til bank
          </button>
        </div>
      </section>

      <div className="grid cols-2">
        <section className="card stack" aria-labelledby="look-h">
          <h2 id="look-h">Utseende</h2>
          <div className="stack-sm">
            <span className="small muted">Aksentfarge</span>
            <Segmented<Accent>
              label="Aksentfarge"
              value={s.accent}
              onChange={(accent) => store.updateSettings({ accent })}
              options={[
                { value: 'blue', label: 'Blå' },
                { value: 'coral', label: 'Korall' },
              ]}
            />
          </div>
          <label className="spread" style={{ cursor: 'pointer' }}>
            <span>
              <span style={{ display: 'block' }}>Skjul beløp</span>
              <span className="hint">Kan også slås av og på med øye-ikonet øverst.</span>
            </span>
            <Switch checked={s.hideAmounts} onChange={(v) => store.updateSettings({ hideAmounts: v })} label="Skjul beløp" />
          </label>
        </section>

        <section className="card stack" aria-labelledby="cur-h">
          <h2 id="cur-h">Valuta og tid</h2>
          <label className="field">
            <span>Standardvaluta for totalsummer</span>
            <select className="select" value={s.baseCurrency} onChange={(e) => store.updateSettings({ baseCurrency: e.target.value })}>
              {CURRENCIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          {foreign.map((cur) => {
            const rate = data.rates.find((r) => r.currency === cur && r.base === s.baseCurrency);
            return <RateField key={cur} currency={cur} base={s.baseCurrency} rate={rate?.rate ?? null} meta={rate ? `${rate.source}, ${formatTimestamp(rate.asOf, s.timeZone)}` : 'Kurs mangler – kontoer i denne valutaen holdes utenfor totalsummer.'} />;
          })}
          <p className="hint">Tidssone: {s.timeZone}. Datoer og tidspunkter vises i denne tidssonen.</p>
        </section>
      </div>

      <section className="card stack" aria-labelledby="notif-h">
        <h2 id="notif-h">Varsler</h2>
        <p className="small muted">Varslene vises på oversiktssiden i appen. Push-varsler og e-post krever en serverkomponent og er ikke aktivert i denne versjonen.</p>
        {NOTIFICATIONS.map((n) => (
          <label key={n.key} className="spread" style={{ cursor: 'pointer' }}>
            <span>
              <span style={{ display: 'block' }}>{n.label}</span>
              <span className="hint">{n.hint}</span>
            </span>
            <Switch
              checked={s.notifications[n.key]}
              onChange={(v) => store.updateSettings({ notifications: { ...s.notifications, [n.key]: v } })}
              label={n.label}
            />
          </label>
        ))}
      </section>

      {data.rules.length > 0 && (
        <section className="card flush" aria-labelledby="rules-h">
          <div className="card-head" style={{ padding: '18px 18px 0' }}>
            <h2 id="rules-h">Kategoriseringsregler</h2>
          </div>
          <ul className="list" style={{ marginTop: 8 }}>
            {data.rules.map((r) => (
              <li key={r.id} className="list-item" style={{ cursor: 'default' }}>
                <span className="li-main">
                  <span className="li-title" style={{ display: 'block' }}>
                    «{r.matchKey}» → {CATEGORY_BY_ID[r.category].label}
                  </span>
                </span>
                <button type="button" className="btn ghost small" onClick={() => store.deleteRule(r.id)} aria-label={`Slett regel for ${r.matchKey}`}>
                  Slett
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card stack" aria-labelledby="privacy-h">
        <h2 id="privacy-h" className="row" style={{ gap: 8 }}>
          <ShieldCheck size={18} aria-hidden="true" /> Personvern og dine data
        </h2>
        <ul className="small muted" style={{ margin: 0, paddingLeft: 18 }}>
          <li>Saldo leser og organiserer økonomidata. Appen kan ikke gjennomføre betalinger.</li>
          <li>Saldo ber aldri om bankpassord, BankID-opplysninger eller fullstendige kortnummer. Bare de siste sifrene lagres.</li>
          {remote ? (
            <li>Dataene dine lagres i Saldos database hos Supabase i EU (kryptert lagring). Radnivåsikkerhet sørger for at bare du kan lese dem. Banknøkkelen ligger i et kryptert hvelv på serveren.</li>
          ) : (
            <li>I demomodus lagres alt kun i denne nettleseren (localStorage). Det er ikke kryptert og sendes ikke til noen server.</li>
          )}
          <li>Å koble fra en bank stopper videre henting. Allerede lagrede data slettes bare hvis du velger det.</li>
          <li>Dette er en prototype. Den er ikke sikkerhetsrevidert og ikke klar for ekte bankdata i produksjon.</li>
        </ul>
        <div className="row wrap">
          <button type="button" className="btn" onClick={exportData}>
            <Download size={16} aria-hidden="true" /> Eksporter mine data (JSON)
          </button>
          <button type="button" className="btn danger" onClick={() => setConfirm('all')}>
            <Trash2 size={16} aria-hidden="true" /> Slett alle data
          </button>
        </div>
      </section>

      <ConnectBankDialog open={connecting} onClose={() => setConnecting(false)} />
      <Dialog open={confirm !== null} onClose={() => setConfirm(null)} title={confirm === 'all' ? 'Slette alle data?' : 'Fjerne demodata?'}>
        <div className="stack">
          <p className="muted small">
            {confirm === 'all'
              ? 'Alle kontoer, transaksjoner, abonnementer, regler og tilkoblinger slettes fra denne nettleseren. Innstillinger for utseende beholdes. Dette kan ikke angres – eksporter først om du vil ta vare på noe.'
              : 'Demokontoene og alle transaksjonene deres fjernes. Egne kontoer og importerte data beholdes.'}
          </p>
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button type="button" className="btn ghost" onClick={() => setConfirm(null)}>
              Avbryt
            </button>
            <button
              type="button"
              className="btn danger"
              onClick={() => {
                if (confirm === 'all') store.deleteAll();
                else store.clearDemo();
                setConfirm(null);
              }}
            >
              {confirm === 'all' ? 'Slett alt' : 'Fjern demodata'}
            </button>
          </div>
        </div>
      </Dialog>
    </Page>
  );
}

function RateField({ currency, base, rate, meta }: { currency: string; base: string; rate: number | null; meta: string }) {
  const store = useStore();
  const [value, setValue] = useState(rate?.toLocaleString('nb-NO', { maximumFractionDigits: 6 }) ?? '');
  const [error, setError] = useState<string | null>(null);
  const save = () => {
    const n = Number(value.replace(/\s/g, '').replace(',', '.'));
    if (!Number.isFinite(n) || n <= 0) return setError('Ugyldig kurs');
    setError(null);
    store.setRate(currency, n);
  };
  return (
    <div className="field">
      <label htmlFor={`rate-${currency}`}>
        Kurs: 1 {currency} = ? {base}
      </label>
      <div className="row">
        <input id={`rate-${currency}`} className="input" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} />
        <button type="button" className="btn small" onClick={save}>
          Lagre
        </button>
      </div>
      <span className="hint">{meta}</span>
      {error && <span className="error-text">{error}</span>}
    </div>
  );
}
