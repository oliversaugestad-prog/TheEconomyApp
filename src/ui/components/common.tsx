import { AlertTriangle, CheckCircle2, CircleAlert, Info, Loader2, RefreshCw, Unplug } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { formatRelative, formatTimestamp } from '../../domain/dates';
import type { Connection } from '../../domain/types';
import { useData } from '../../state/StoreContext';

export function Notice({ tone = 'info', children, title }: { tone?: 'info' | 'warn' | 'error'; children: ReactNode; title?: ReactNode }) {
  const Icon = tone === 'warn' ? AlertTriangle : tone === 'error' ? CircleAlert : Info;
  return (
    <div className={`notice ${tone}`} role={tone === 'error' ? 'alert' : undefined}>
      <Icon size={18} aria-hidden="true" />
      <div className="notice-body">
        {title && <p style={{ fontWeight: 600, marginBottom: 2 }}>{title}</p>}
        <div className="muted">{children}</div>
      </div>
    </div>
  );
}

export function Empty({ icon, title, children, action }: { icon: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-icon" aria-hidden="true">
        {icon}
      </div>
      <p style={{ fontWeight: 600, color: 'var(--text)' }}>{title}</p>
      {children && <p className="small">{children}</p>}
      {action}
    </div>
  );
}

export function Skeleton({ w = '100%', h = 16, r }: { w?: number | string; h?: number; r?: number }) {
  return <span className="skeleton" style={{ display: 'block', width: w, height: h, borderRadius: r }} aria-hidden="true" />;
}

export function Initials({ name }: { name: string }) {
  const letters = name
    .replace(/[^A-Za-zÆØÅæøå0-9 ]/g, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('');
  return (
    <span className="avatar" aria-hidden="true">
      {letters || '•'}
    </span>
  );
}

const STATUS_TEXT: Record<Connection['status'], string> = {
  ok: 'Oppdatert',
  syncing: 'Oppdaterer …',
  error: 'Feil ved oppdatering',
  reauth_required: 'Må kobles til på nytt',
  disconnected: 'Frakoblet',
};

export function ConnectionBadge({ connection, syncing }: { connection: Connection; syncing?: boolean }) {
  if (syncing) {
    return (
      <span className="badge accent">
        <Loader2 size={12} className="spin" aria-hidden="true" /> Oppdaterer …
      </span>
    );
  }
  if (connection.providerId === 'manual') {
    return <span className="badge">Manuell</span>;
  }
  const s = connection.status;
  const cls = s === 'ok' ? 'ok' : s === 'reauth_required' ? 'warn' : s === 'disconnected' ? '' : 'error';
  const Icon = s === 'ok' ? CheckCircle2 : s === 'disconnected' ? Unplug : s === 'reauth_required' ? RefreshCw : CircleAlert;
  return (
    <span className={`badge ${cls}`}>
      <Icon size={12} aria-hidden="true" /> {STATUS_TEXT[s]}
    </span>
  );
}

/** «Sist oppdatert for 12 min siden» med nøyaktig tidspunkt i title/skjermleser. */
export function LastUpdated({ ts, prefix = 'Sist oppdatert' }: { ts: string | null; prefix?: string }) {
  const tz = useData().settings.timeZone;
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 60_000);
    return () => clearInterval(t);
  }, []);
  if (!ts) return <span>{prefix}: aldri</span>;
  const exact = formatTimestamp(ts, tz);
  return (
    <span title={exact}>
      {prefix} {formatRelative(ts)} <span className="sr-only">({exact})</span>
    </span>
  );
}

export function DemoBadge() {
  return <span className="badge demo">DEMO</span>;
}

export function Switch({ checked, onChange, label, id }: { checked: boolean; onChange: (v: boolean) => void; label: string; id?: string }) {
  return (
    <span className="switch">
      <input id={id} type="checkbox" role="switch" checked={checked} aria-label={label} onChange={(e) => onChange(e.target.checked)} />
      <span className="track" aria-hidden="true" />
    </span>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
