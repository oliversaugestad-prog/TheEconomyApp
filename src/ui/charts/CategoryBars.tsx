import type { CategoryShare } from '../../domain/calculations';
import { CATEGORY_BY_ID } from '../../domain/categories';
import type { CategoryId } from '../../domain/types';
import { Amount } from '../components/Amount';

/**
 * Utgifter per kategori som horisontale søyler med tekst og beløp – lettere å
 * lese nøyaktig enn et kakediagram, og identitet bæres av tekst, ikke bare farge.
 */
export function CategoryBars({
  shares,
  currency,
  limit,
  onSelect,
  selected,
}: {
  shares: CategoryShare[];
  currency: string;
  limit?: number;
  onSelect?: (c: CategoryId) => void;
  selected?: CategoryId | null;
}) {
  const list = limit ? shares.slice(0, limit) : shares;
  const rest = limit ? shares.slice(limit) : [];
  const max = Math.max(1, ...shares.map((s) => s.amount));
  const restSum = rest.reduce((s, r) => s + r.amount, 0);

  const Row = ({ s }: { s: CategoryShare }) => {
    const info = CATEGORY_BY_ID[s.category];
    const content = (
      <>
        <span className="row" style={{ gap: 8 }}>
          <span className="dot" style={{ background: info.color }} aria-hidden="true" />
          <span className="small" style={{ fontWeight: 550 }}>
            {info.label}
          </span>
          <span className="xsmall subtle">{Math.round(s.share * 100)} %</span>
        </span>
        <Amount value={s.amount} currency={currency} className="small" />
        <span className="cat-track" aria-hidden="true">
          <span style={{ width: `${(s.amount / max) * 100}%`, background: info.color }} />
        </span>
      </>
    );
    return onSelect ? (
      <button
        type="button"
        className="cat-bar-row"
        onClick={() => onSelect(s.category)}
        aria-pressed={selected === s.category}
        style={selected && selected !== s.category ? { opacity: 0.55 } : undefined}
      >
        {content}
      </button>
    ) : (
      <div className="cat-bar-row" style={{ cursor: 'default' }}>
        {content}
      </div>
    );
  };

  return (
    <div className="cat-bars">
      {list.map((s) => (
        <Row key={s.category} s={s} />
      ))}
      {rest.length > 0 && (
        <p className="xsmall subtle">
          + {rest.length} andre kategorier: <Amount value={restSum} currency={currency} />
        </p>
      )}
    </div>
  );
}
