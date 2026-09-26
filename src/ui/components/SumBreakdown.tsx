import type { ReactNode } from 'react';
import { formatTimestamp } from '../../domain/dates';
import type { MoneySum } from '../../domain/money';
import type { Account } from '../../domain/types';
import { useData } from '../../state/StoreContext';
import { Amount } from './Amount';
import { Notice } from './common';

/** Liste over hvilke kontoer som inngår i en sum, hva som mangler og brukt valutakurs. */
export function SumBreakdown({
  sum,
  accounts,
  valueOf,
  explanation,
  totalLabel,
  valuePrefix,
}: {
  sum: MoneySum;
  accounts: Account[];
  valueOf: (a: Account) => number | null;
  explanation?: ReactNode;
  totalLabel: string;
  valuePrefix?: string;
}) {
  const tz = useData().settings.timeZone;
  return (
    <div className="stack">
      {explanation && <p className="muted small">{explanation}</p>}
      <dl className="dl">
        {accounts.map((a) => {
          const v = valueOf(a);
          return (
            <div key={a.id} style={{ display: 'contents' }}>
              <dt>
                <span style={{ color: 'var(--text)' }}>{a.name}</span>
                <span className="xsmall subtle" style={{ display: 'block' }}>
                  {a.bankName} · {a.maskedNumber}
                  {a.currency !== sum.currency ? ` · ${a.currency}` : ''}
                </span>
              </dt>
              <dd>
                {v === null ? (
                  <span className="subtle small">Ukjent – ikke med</span>
                ) : (
                  <>
                    {valuePrefix}
                    <Amount value={v} currency={a.currency} />
                  </>
                )}
              </dd>
            </div>
          );
        })}
        <div className="total" style={{ display: 'contents' }}>
          <dt>{totalLabel}</dt>
          <dd>
            <Amount value={sum.amount} currency={sum.currency} />
          </dd>
        </div>
      </dl>
      {sum.conversions.length > 0 && (
        <Notice title="Totalsummen er omregnet">
          {sum.conversions.map((c) => (
            <span key={c.currency} style={{ display: 'block' }}>
              1 {c.currency} = {c.rate.toLocaleString('nb-NO', { maximumFractionDigits: 4 })} {sum.currency} per {formatTimestamp(c.asOf, tz)}. Kilde: {c.source}.
            </span>
          ))}
        </Notice>
      )}
      {!sum.complete && (
        <Notice tone="warn" title="Summen er ufullstendig">
          {sum.missing.length > 0 && <>Beløp mangler for {sum.missing.map((m) => m.label).join(', ')}. Ukjente beløp regnes ikke som 0. </>}
          {sum.unconvertible.length > 0 && <>Valutakurs mangler for {sum.unconvertible.map((m) => `${m.label} (${m.currency})`).join(', ')}.</>}
        </Notice>
      )}
      {accounts.length === 0 && <p className="muted small">Ingen kontoer inngår i denne summen.</p>}
    </div>
  );
}

export function IncompleteMark({ complete }: { complete: boolean }) {
  if (complete) return null;
  return (
    <span className="badge warn" title="Noen beløp mangler eller mangler valutakurs">
      Ufullstendig
    </span>
  );
}
