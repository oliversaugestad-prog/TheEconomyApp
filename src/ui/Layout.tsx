import { ArrowLeftRight, CalendarRange, PiggyBank, Briefcase, CheckCircle2, CircleAlert, CreditCard, Eye, EyeOff, LayoutGrid, Landmark, Repeat, RefreshCw, Settings, TriangleAlert, FlaskConical } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useData, useSnapshot, useStore } from '../state/StoreContext';

const NAV = [
  { to: '/', label: 'Oversikt', short: 'Oversikt', icon: LayoutGrid, end: true },
  { to: '/kontoer', label: 'Kontoer', short: 'Kontoer', icon: Landmark },
  { to: '/transaksjoner', label: 'Transaksjoner', short: 'Transaksjoner', icon: ArrowLeftRight },
  { to: '/abonnementer', label: 'Abonnementer', short: 'Abonnement', icon: Repeat },
  { to: '/formue', label: 'Formue', short: 'Formue', icon: PiggyBank },
];

export function AppShell({ children }: { children: ReactNode }) {
  const snap = useSnapshot();
  const store = useStore();
  const accent = snap.data.settings.accent;

  useEffect(() => {
    document.documentElement.dataset.accent = accent;
  }, [accent]);

  // Advar hvis siden lukkes eller lastes på nytt mens banker hentes – da går resultatet tapt.
  const syncing = snap.syncing.length > 0;
  useEffect(() => {
    if (!syncing) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [syncing]);

  return (
    <div className="app">
      <a className="skip-link" href="#innhold">
        Hopp til innhold
      </a>
      <aside className="sidebar" aria-label="Hovedmeny">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            S
          </span>
          Saldo
        </div>
        <nav className="side-nav" aria-label="Hovedmeny">
          {[
            ...NAV.slice(0, 4),
            { to: '/kort', label: 'Kredittkort', short: 'Kort', icon: CreditCard },
            NAV[4],
            { to: '/hendelser', label: 'Hendelser', short: 'Hendelser', icon: CalendarRange },
            { to: '/bedrift', label: 'Bedrift', short: 'Bedrift', icon: Briefcase },
            { to: '/innstillinger', label: 'Innstillinger', short: 'Innstillinger', icon: Settings },
          ].map((n) => (
            <NavLink key={n.to} to={n.to} end={'end' in n ? n.end : false}>
              <n.icon size={20} aria-hidden="true" />
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-footer">
          {store.hasDemoData() && (
            <Link to="/innstillinger#data" className="demo-banner" style={{ margin: 0 }}>
              <FlaskConical size={16} aria-hidden="true" />
              <span>Demomodus – syntetiske data</span>
            </Link>
          )}
        </div>
      </aside>

      <main className="main" id="innhold" tabIndex={-1}>
        {children}
      </main>

      <nav className="bottom-nav" aria-label="Hovedmeny">
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end} aria-label={n.label}>
            <n.icon size={22} aria-hidden="true" />
            <span aria-hidden="true">{n.short}</span>
          </NavLink>
        ))}
      </nav>
      <SyncToast />
    </div>
  );
}

function SyncToast() {
  const { syncMessage } = useSnapshot();
  const [visible, setVisible] = useState<typeof syncMessage>(null);
  useEffect(() => {
    if (!syncMessage) return;
    setVisible(syncMessage);
    const t = setTimeout(() => setVisible(null), 5000);
    return () => clearTimeout(t);
  }, [syncMessage]);
  if (!visible) return null;
  const Icon = visible.tone === 'ok' ? CheckCircle2 : visible.tone === 'warn' ? TriangleAlert : CircleAlert;
  const color = visible.tone === 'ok' ? 'var(--positive)' : visible.tone === 'warn' ? 'var(--warning)' : 'var(--danger)';
  return (
    <div className="toast" role="status" aria-live="polite">
      <Icon size={18} style={{ color, flex: 'none' }} aria-hidden="true" />
      <span>{visible.text}</span>
    </div>
  );
}

interface PageProps {
  title: string;
  children: ReactNode;
  actions?: ReactNode;
  back?: { to: string; label: string };
  /** Skjul standardknappene (oppdater/skjul beløp). */
  plain?: boolean;
}

export function Page({ title, children, actions, back, plain }: PageProps) {
  useEffect(() => {
    document.title = `${title} · Saldo`;
  }, [title]);
  const store = useStore();
  return (
    <>
      <header className="topbar">
        {back ? (
          <Link to={back.to} className="icon-btn" aria-label={back.label}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m15 18-6-6 6-6" />
            </svg>
          </Link>
        ) : (
          <span className="brand-mobile" aria-hidden="true">
            <span className="brand-mark" style={{ width: 28, height: 28, fontSize: '0.85rem' }}>
              S
            </span>
          </span>
        )}
        <h1>{title}</h1>
        {actions}
        {!plain && <HideToggle />}
        {!plain && <RefreshButton />}
        <SettingsLink />
      </header>
      {store.hasDemoData() && <DemoBannerMobile />}
      <div className="stack fade-in">{children}</div>
    </>
  );
}

function DemoBannerMobile() {
  return (
    <div className="demo-banner mobile-only">
      <FlaskConical size={16} aria-hidden="true" />
      <span className="grow">
        <strong>Demomodus.</strong> Syntetiske data – ingen ekte bank er tilkoblet.
      </span>
      <Link to="/innstillinger#data" className="small">
        Endre
      </Link>
    </div>
  );
}

export function HideToggle() {
  const store = useStore();
  const hidden = useData().settings.hideAmounts;
  return (
    <button
      type="button"
      className="icon-btn"
      aria-pressed={hidden}
      aria-label={hidden ? 'Vis beløp' : 'Skjul beløp'}
      title={hidden ? 'Vis beløp' : 'Skjul beløp'}
      onClick={() => store.updateSettings({ hideAmounts: !hidden })}
    >
      {hidden ? <EyeOff size={20} aria-hidden="true" /> : <Eye size={20} aria-hidden="true" />}
    </button>
  );
}

export function RefreshButton() {
  const store = useStore();
  const { syncing, data } = useSnapshot();
  const syncable = data.connections.some((c) => c.providerId !== 'manual' && c.status !== 'disconnected');
  if (!syncable) return null;
  const busy = syncing.length > 0;
  return (
    <button
      type="button"
      className="icon-btn"
      onClick={() => store.syncAll()}
      disabled={busy}
      aria-label={busy ? 'Oppdaterer data' : 'Hent nye data fra tilkoblinger'}
      title="Hent nye data"
    >
      <RefreshCw size={20} className={busy ? 'spin' : ''} aria-hidden="true" />
    </button>
  );
}

function SettingsLink() {
  const navigate = useNavigate();
  return (
    <button type="button" className="icon-btn mobile-only" aria-label="Innstillinger" onClick={() => navigate('/innstillinger')}>
      <Settings size={20} aria-hidden="true" />
    </button>
  );
}
