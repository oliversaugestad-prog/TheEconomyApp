import { ArrowLeftRight, CreditCard, RotateCcw, Undo2 } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CATEGORIES, CATEGORY_BY_ID, normalizeCounterparty } from '../../domain/categories';
import { formatDate, relativeDay } from '../../domain/dates';
import type { Account, CategoryId, Transaction, TransactionKind } from '../../domain/types';
import { useData, useStore, useToday } from '../../state/StoreContext';
import { Amount } from './Amount';
import { Dialog } from './Dialog';
import { DemoBadge, Notice } from './common';

export const KIND_LABEL: Record<TransactionKind, string> = {
  normal: 'Vanlig inntekt/utgift',
  internal_transfer: 'Overføring mellom egne kontoer',
  card_payment: 'Betaling av kredittkort',
  refund: 'Refusjon',
};

function KindBadge({ t }: { t: Transaction }) {
  if (t.kind === 'internal_transfer') return <span className="badge">Overføring</span>;
  if (t.kind === 'card_payment') return <span className="badge">Kortbetaling</span>;
  if (t.kind === 'refund') return <span className="badge accent">Refusjon</span>;
  return null;
}

export function TransactionRow({ t, account, onOpen, showAccount = true }: { t: Transaction; account?: Account; onOpen: (t: Transaction) => void; showAccount?: boolean }) {
  const today = useToday();
  const cat = CATEGORY_BY_ID[t.category];
  const neutral = t.kind === 'internal_transfer' || t.kind === 'card_payment';
  const Icon = t.kind === 'card_payment' ? CreditCard : t.kind === 'internal_transfer' ? ArrowLeftRight : t.kind === 'refund' ? Undo2 : null;
  return (
    <button type="button" className="list-item" onClick={() => onOpen(t)}>
      <span className="avatar" aria-hidden="true" style={{ color: Icon ? 'var(--text-2)' : cat.color, background: 'var(--surface-2)' }}>
        {Icon ? <Icon size={18} /> : <span style={{ fontWeight: 700 }}>{t.counterparty.slice(0, 1).toUpperCase()}</span>}
      </span>
      <span className="li-main">
        <span className="li-title" style={{ display: 'block' }}>
          {t.counterparty}
        </span>
        <span className="li-sub" style={{ display: 'block' }}>
          {relativeDay(t.bookingDate, today)}
          {showAccount && account ? ` · ${account.name}` : ''}
          {!neutral ? ` · ${cat.label}` : ''}
        </span>
      </span>
      <span className="li-end">
        <Amount value={t.amount} currency={t.currency} signed tone={!neutral} className={neutral ? 'amount-neutral' : ''} />
        <span className="row" style={{ justifyContent: 'flex-end', gap: 4, marginTop: 2 }}>
          {t.status === 'pending' && <span className="badge warn">Reservert</span>}
          <KindBadge t={t} />
        </span>
      </span>
    </button>
  );
}

/** Forklarer hvordan transaksjonen påvirker summene. */
function effectText(t: Transaction): string {
  switch (t.kind) {
    case 'internal_transfer':
      return 'Teller ikke som inntekt eller utgift – pengene flyttes bare mellom dine egne kontoer.';
    case 'card_payment':
      return 'Reduserer kredittkortgjelden, men telles ikke som ny utgift. Kjøpene er allerede registrert på kortet.';
    case 'refund':
      return `Reduserer utgiftene i kategorien ${CATEGORY_BY_ID[t.category].label}. Telles ikke som inntekt.`;
    default:
      return t.amount >= 0 ? `Telles som inntekt (${CATEGORY_BY_ID[t.category].label}).` : `Telles som utgift i kategorien ${CATEGORY_BY_ID[t.category].label}.`;
  }
}

export function TransactionDetail({ tx, onClose }: { tx: Transaction | null; onClose: () => void }) {
  const store = useStore();
  const data = useData();
  // Hent alltid siste versjon fra lageret.
  const t = tx ? data.transactions.find((x) => x.id === tx.id) ?? null : null;
  const [remember, setRemember] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  if (!t) return null;
  const account = data.accounts.find((a) => a.id === t.accountId);
  const linked = t.linkedTransactionId ? data.transactions.find((x) => x.id === t.linkedTransactionId) : null;
  const linkedAcc = linked ? data.accounts.find((a) => a.id === linked.accountId) : null;
  const key = normalizeCounterparty(t.counterparty);
  const rule = data.rules.find((r) => r.matchKey === key);
  const categories = CATEGORIES.filter((c) => (t.amount >= 0 && t.kind !== 'refund' ? true : c.type === 'expense'));
  const sameCounterparty = data.transactions.filter((x) => normalizeCounterparty(x.counterparty) === key).length;

  const changeCategory = (c: CategoryId) => {
    store.setCategory(t.id, c, remember);
    setSaved(remember ? `Lagret. Regel for «${t.counterparty}» brukes på ${sameCounterparty} transaksjoner og fremtidige.` : 'Kategori lagret.');
  };

  return (
    <Dialog open onClose={onClose} title="Transaksjon">
      <div className="stack">
        <div style={{ textAlign: 'center', padding: '6px 0 4px' }}>
          <p className="muted small">{t.counterparty}</p>
          <p style={{ fontFamily: 'var(--font-display)', fontSize: '2.1rem', fontWeight: 650, letterSpacing: '-0.03em' }}>
            <Amount value={t.amount} currency={t.currency} signed tone={t.kind === 'normal' || t.kind === 'refund'} />
          </p>
          <div className="row" style={{ justifyContent: 'center', gap: 6, marginTop: 6 }}>
            {t.status === 'pending' ? <span className="badge warn">Reservert – ikke bokført</span> : <span className="badge ok">Bokført</span>}
            {t.isDemo && <DemoBadge />}
            {t.source === 'csv' && <span className="badge">Importert fra CSV</span>}
          </div>
        </div>

        <dl className="dl">
          <dt>Dato</dt>
          <dd>{formatDate(t.bookingDate, 'long')}</dd>
          <dt>Konto</dt>
          <dd>{account ? `${account.name} · ${account.bankName}` : 'Ukjent konto'}</dd>
          <dt>Mottaker / avsender</dt>
          <dd>{t.counterparty}</dd>
          {t.description && (
            <>
              <dt>Beskrivelse</dt>
              <dd>{t.description}</dd>
            </>
          )}
          <dt>Status</dt>
          <dd>{t.status === 'pending' ? 'Reservert' : 'Bokført'}</dd>
          <dt>Type</dt>
          <dd>{KIND_LABEL[t.kind]}</dd>
          {linked && (
            <>
              <dt>{t.kind === 'refund' ? 'Gjelder kjøp' : 'Motpost'}</dt>
              <dd>
                <Amount value={linked.amount} currency={linked.currency} signed /> · {linkedAcc?.name ?? ''} · {formatDate(linked.bookingDate, 'short')}
              </dd>
            </>
          )}
        </dl>

        <Notice>{effectText(t)}</Notice>
        {t.status === 'pending' && (
          <p className="small muted">
            Reserverte beløp er med i månedens utgifter én gang. Når banken bokfører transaksjonen, erstattes reservasjonen – den telles ikke på nytt.
          </p>
        )}

        {t.kind !== 'internal_transfer' && t.kind !== 'card_payment' && (
          <div className="stack-sm">
            <label className="field">
              <span>Kategori</span>
              <select className="select" value={t.category} onChange={(e) => changeCategory(e.target.value as CategoryId)}>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="check">
              <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
              <span className="small">
                Husk for «{t.counterparty}» – bruk samme kategori på tidligere og fremtidige transaksjoner fra denne mottakeren
              </span>
            </label>
            {rule && !saved && <p className="hint">Regel finnes: «{t.counterparty}» → {CATEGORY_BY_ID[rule.category].label}</p>}
            {saved && (
              <p className="hint" role="status">
                {saved}
              </p>
            )}
          </div>
        )}

        <label className="field">
          <span>Behandle som</span>
          <select className="select" value={t.kind} onChange={(e) => store.setKind(t.id, e.target.value as TransactionKind)}>
            {(Object.keys(KIND_LABEL) as TransactionKind[])
              .filter((k) => k !== 'refund' || t.amount > 0)
              .map((k) => (
                <option key={k} value={k}>
                  {KIND_LABEL[k]}
                </option>
              ))}
          </select>
          <span className="hint">Endrer bare hvordan Saldo teller transaksjonen – ikke noe hos banken.</span>
        </label>

        <div className="row wrap">
          {account && (
            <Link className="btn small" to={account.type === 'credit_card' ? `/kort/${account.id}` : `/kontoer/${account.id}`} onClick={onClose}>
              Gå til {account.type === 'credit_card' ? 'kortet' : 'kontoen'}
            </Link>
          )}
          {(t.userCategorized || t.userKind) && (
            <button type="button" className="btn ghost small" onClick={() => store.resetTransaction(t.id)}>
              <RotateCcw size={16} aria-hidden="true" /> Tilbakestill til automatisk
            </button>
          )}
        </div>
      </div>
    </Dialog>
  );
}
