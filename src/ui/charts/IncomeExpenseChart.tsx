import { useEffect, useRef, useState } from 'react';
import type { MonthPoint } from '../../domain/calculations';
import { formatMonth } from '../../domain/dates';
import { formatMoney } from '../../domain/money';
import { useData } from '../../state/StoreContext';

const INCOME = '#3987e5';
const EXPENSE = '#d95926';

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const exp = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / exp;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return step * exp;
}

function compact(minor: number): string {
  const kr = minor / 100;
  if (Math.abs(kr) >= 1000) return `${Math.round(kr / 1000)}k`;
  return String(Math.round(kr));
}

/**
 * Inntekter mot utgifter per måned. Én akse, to serier med legende og
 * tabellvisning som alternativ. Verdiene kommer fra samme beregning som
 * summene på siden.
 */
export function IncomeExpenseChart({ points, currency, height = 200 }: { points: MonthPoint[]; currency: string; height?: number }) {
  const hidden = useData().settings.hideAmounts;
  const [hover, setHover] = useState<number | null>(null);
  const [asTable, setAsTable] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const [measured, setMeasured] = useState(560);
  useEffect(() => {
    const el = boxRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([e]) => setMeasured(Math.max(260, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, [asTable]);
  // Tegn i faktisk bredde slik at teksten beholder lesbar størrelse på mobil.
  const width = measured;
  const padL = 40;
  const padB = 26;
  const padT = 10;
  const innerW = width - padL - 4;
  const innerH = height - padB - padT;
  const max = niceMax(Math.max(1, ...points.flatMap((p) => [p.income, p.expense])));
  const groupW = innerW / Math.max(1, points.length);
  const barW = Math.min(22, groupW * 0.28);
  const gap = 3;
  const y = (v: number) => padT + innerH - (Math.max(0, v) / max) * innerH;
  const ticks = [0, max / 2, max];
  const fmt = (v: number) => (hidden ? '••••' : formatMoney(v, currency));

  return (
    <div className="stack-sm">
      <div className="spread">
        <div className="legend" aria-hidden={asTable}>
          <span>
            <span className="sw" style={{ background: INCOME }} />
            Inntekter
          </span>
          <span>
            <span className="sw" style={{ background: EXPENSE }} />
            Utgifter
          </span>
        </div>
        <button type="button" className="btn ghost small" aria-pressed={asTable} onClick={() => setAsTable((v) => !v)}>
          {asTable ? 'Vis diagram' : 'Vis som tabell'}
        </button>
      </div>
      {asTable ? (
        <div className="table-scroll">
          <table className="data">
            <caption className="sr-only">Inntekter og utgifter per måned</caption>
            <thead>
              <tr>
                <th scope="col">Måned</th>
                <th scope="col">Inntekter</th>
                <th scope="col">Utgifter</th>
                <th scope="col">Differanse</th>
              </tr>
            </thead>
            <tbody>
              {points.map((p) => (
                <tr key={p.month}>
                  <th scope="row" style={{ fontWeight: 500, color: 'var(--text)' }}>
                    {formatMonth(p.month)}
                  </th>
                  <td className="num">{fmt(p.income)}</td>
                  <td className="num">{fmt(p.expense)}</td>
                  <td className="num">{hidden ? '••••' : formatMoney(p.net, currency, { signed: true })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="chart" ref={boxRef} onMouseLeave={() => setHover(null)}>
          <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Inntekter og utgifter siste ${points.length} måneder. Bruk «Vis som tabell» for tallene.`}>
            {ticks.map((t) => (
              <g key={t}>
                <line className="grid-line" x1={padL} x2={width} y1={y(t)} y2={y(t)} />
                <text className="axis-label" x={padL - 8} y={y(t) + 4} textAnchor="end">
                  {hidden ? '' : compact(t)}
                </text>
              </g>
            ))}
            {points.map((p, i) => {
              const cx = padL + groupW * i + groupW / 2;
              const bars = [
                { v: p.income, color: INCOME, x: cx - barW - gap / 2 },
                { v: p.expense, color: EXPENSE, x: cx + gap / 2 },
              ];
              return (
                <g key={p.month}>
                  <rect
                    className="hit"
                    x={padL + groupW * i}
                    y={padT}
                    width={groupW}
                    height={innerH + padB}
                    fill="transparent"
                    onMouseEnter={() => setHover(i)}
                    onFocus={() => setHover(i)}
                    onBlur={() => setHover(null)}
                    tabIndex={0}
                    aria-label={`${formatMonth(p.month)}: inntekter ${fmt(p.income)}, utgifter ${fmt(p.expense)}`}
                  />
                  {bars.map((b, j) => {
                    const top = y(b.v);
                    const h = Math.max(0, padT + innerH - top);
                    const r = Math.min(4, h);
                    return (
                      <path
                        key={j}
                        className={`bar ${hover !== null && hover !== i ? 'dim' : ''}`}
                        fill={b.color}
                        d={
                          h > 0
                            ? `M${b.x},${padT + innerH} V${top + r} Q${b.x},${top} ${b.x + r},${top} H${b.x + barW - r} Q${b.x + barW},${top} ${b.x + barW},${top + r} V${padT + innerH} Z`
                            : ''
                        }
                        pointerEvents="none"
                      />
                    );
                  })}
                  <text className="axis-label" x={cx} y={height - 6} textAnchor="middle">
                    {formatMonth(p.month, true)}
                  </text>
                </g>
              );
            })}
          </svg>
          {hover !== null && points[hover] && (
            <div
              className="tooltip"
              style={{
                left: `${((padL + groupW * hover + groupW / 2) / width) * 100}%`,
                top: `${(y(Math.max(points[hover].income, points[hover].expense)) / height) * 100}%`,
              }}
            >
              <div style={{ fontWeight: 600, marginBottom: 2 }}>{formatMonth(points[hover].month)}</div>
              <div>
                <span className="dot" style={{ background: INCOME, marginRight: 6 }} />
                Inntekter <span className="num">{fmt(points[hover].income)}</span>
              </div>
              <div>
                <span className="dot" style={{ background: EXPENSE, marginRight: 6 }} />
                Utgifter <span className="num">{fmt(points[hover].expense)}</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
