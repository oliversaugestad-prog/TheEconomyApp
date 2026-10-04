import { ArrowLeftRight, Briefcase, CreditCard, RotateCcw, Undo2 } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CATEGORIES, CATEGORY_BY_ID, normalizeCounterparty, ruleMatches, suggestRuleKey, findRule } from '../../domain/categories';
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
  business: 'Bedrift – betalt av eier',
};

function KindBadge({ t }: { t: Transaction }) {
  if (t.kind === 'internal_transfer') return <span className="badge">Overføring</span>;
  if (t.kind === 'card_payment') return <span className="badge">Kortbetaling</span>;
  if (t.kind === 'refund') return <span className="badge accent">Refusjon</span>;
  if (t.kind === 'business') return <span className="badge">Bedrift</span>;
  return null;
}

export function TransactionRow({ t, account, onOpen, showAccount = true }: { t: Transaction; account?: Account; onOpen: (t: Transaction) => void; showAccount?: boolean }) {
  const today = useToday();
  const events = useData().events;
  const ev = t.eventId ? events?.find((e) => e.id === t.eventId) : undefined;
  const cat = CATEGORY_BY_ID[t.category];
  const neutral = t.kind === 'internal_transfer' || t.kind === 'card_payment' || t.kind === 'business';
  const Icon = t.kind === 'card_payment' ? CreditCard : t.kind === 'internal_transfer' ? ArrowLeftRight : t.kind === 'refund' ? Undo2 : t.kind === 'business' ? Briefcase : null;
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
          {ev && <span className="event-tag"> · {ev.emoji} {ev.name}</span>}
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
    case 'business':
      return 'Bedriftens utgift som du har betalt privat. Holdes utenfor ditt private forbruk og vises som egen post under Bedrift (utlegg bedriften skylder deg).';
    default:
      return t.amount >= 0 ? `Telles som inntekt (${CATEGORY_BY_ID[t.category].label}).` : `Telles som utgift i kategorien ${CATEGORY_BY_ID[t.category].label}.`;
  }
}

export function TransactionDetail({ tx, onClose }: { tx: Transaction | null; onClose: () => void }) {
  const store = useStore();
  const data = useData();
  const navigate = useNavigate();
  // Hent alltid siste versjon fra lageret.
  const t = tx ? (data.transactions.find((x) => x.id === tx.id) ?? null) : null;
  const [remember, setRemember] = useState(true);
  const [ruleKey, setRuleKey] = useState(() => (tx ? (findRule(data.rules, tx.counterparty)?.matchKey ?? suggestRuleKey(tx.counterparty)) : ''));
  const [saved, setSaved] = useState<string | null>(null);
  if (!t) return null;
  const account = data.accounts.find((a) => a.id === t.accountId);
  const linked = t.linkedTransactionId ? data.transactions.find((x) => x.id === t.linkedTransactionId) : null;
  const linkedAcc = linked ? data.accounts.find((a) => a.id === linked.accountId) : null;
  const rule = findRule(data.rules, t.counterparty);
  const effectiveKey = normalizeCounterparty(ruleKey) || suggestRuleKey(t.counterparty);
  const categories = CATEGORIES.filter((c) => (t.amount >= 0 && t.kind !== 'refund' ? true : c.type === 'expense'));
  const similar = data.transactions.filter((x) => ruleMatches(effectiveKey, x.counterparty)).length;

  const changeCategory = (c: CategoryId) => {
    store.setCategory(t.id, c, remember, effectiveKey);
    setSaved(remember ? `Lagret. Gjelder ${similar} transaksjon(er) fra «${effectiveKey}» og fremtidige lignende kjøp.` : 'Kategori lagret for denne transaksjonen.');
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
          <p className="small muted">Reserverte beløp er med i månedens utgifter én gang. Når banken bokfører transaksjonen, erstattes reservasjonen – den telles ikke på nytt.</p>
        )}

        {t.kind !== 'internal_transfer' && t.kind !== 'card_payment' && (
          <div className="stack-sm">
            <label className="check">
              <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
              <span className="small">Husk for lignende kjøp – bruk samme kategori på tidligere og fremtidige transaksjoner</span>
            </label>
            {remember && (
              <label className="field">
                <span>Mottakere som starter med</span>
                <input className="input" value={ruleKey} onChange={(e) => setRuleKey(e.target.value)} autoComplete="off" />
                <span className="hint">Treffer {similar} transaksjon(er). Gjør teksten kortere for å treffe flere butikker i samme kjede (f.eks. «zara»).</span>
              </label>
            )}
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
            {rule && !saved && (
              <p className="hint">
                Regel finnes: «{rule.matchKey}» → {CATEGORY_BY_ID[rule.category].label}
              </p>
            )}
            {saved && (
              <p className="hint" role="status">
                {saved}
              </p>
            )}
          </div>
        )}

        {t.amount < 0 && (t.kind === 'normal' || t.kind === 'business') && (
          <div className="notice" style={{ alignItems: 'center' }}>
            <Briefcase size={18} aria-hidden="true" />
            <div className="notice-body">
              <p style={{ fontWeight: 600 }}>{t.kind === 'business' ? 'Markert som bedriftsutgift' : 'Var dette for bedriften?'}</p>
              <p className="small muted">
                {t.kind === 'business'
                  ? 'Holdes utenfor ditt private forbruk og vises under Bedrift som utlegg bedriften skylder deg.'
                  : 'Marker kjøpet som betalt av deg for bedriften, så telles det ikke i din private økonomi.'}
              </p>
              <button
                type="button"
                className={`btn small ${t.kind === 'business' ? 'ghost' : 'primary'}`}
                style={{ marginTop: 8 }}
                onClick={() => {
                  const on = t.kind !== 'business';
                  store.setBusiness(t.id, on, remember, effectiveKey);
                  setSaved(
                    on
                      ? remember
                        ? `Markert som bedrift. Gjelder også ${similar} transaksjon(er) fra «${effectiveKey}» og fremtidige lignende kjøp.`
                        : 'Markert som bedrift – betalt av eier.'
                      : 'Fjernet markeringen. Telles igjen i din private økonomi.',
                  );
                }}
              >
                <Briefcase size={16} aria-hidden="true" /> {t.kind === 'business' ? 'Ikke bedrift likevel' : 'Bedrift – betalt av eier'}
              </button>
            </div>
          </div>
        )}

        {t.kind !== 'internal_transfer' && t.kind !== 'card_payment' && (
          <label className="field">
            <span>Hendelse</span>
            <select
              className="select"
              value={t.eventId ?? ''}
              onChange={(e) => {
                if (e.target.value === '__new') {
                  onClose();
                  navigate('/hendelser?ny=1');
                  return;
                }
                store.setTransactionsEvent([t.id], e.target.value || null);
              }}
            >
              <option value="">Ingen</option>
              {(data.events ?? [])
                .filter((ev) => !ev.archived || ev.id === t.eventId)
                .map((ev) => (
                  <option key={ev.id} value={ev.id}>
                    {ev.emoji} {ev.name}
                  </option>
                ))}
              <option value="__new">+ Ny hendelse …</option>
            </select>
            <span className="hint">Koble kjøpet til en tur eller hendelse for å følge budsjettet.</span>
          </label>
        )}

        <label className="field">
          <span>Behandle som</span>
          <select className="select" value={t.kind} onChange={(e) => store.setKind(t.id, e.target.value as TransactionKind)}>
            {(Object.keys(KIND_LABEL) as TransactionKind[])
              .filter((k) => (k !== 'refund' || t.amount > 0) && (k !== 'business' || t.amount < 0))
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
