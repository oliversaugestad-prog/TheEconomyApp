import { formatMoney } from '../../domain/money';
import type { CurrencyCode, Minor } from '../../domain/types';
import { useData } from '../../state/StoreContext';

interface AmountProps {
  value: Minor | null;
  currency?: CurrencyCode;
  /** Vis fortegn også for positive beløp (+). */
  signed?: boolean;
  /** Vis uten fortegn (når teksten rundt forklarer retningen, f.eks. «Gjeld»). */
  absolute?: boolean;
  /** Farge positive beløp (i tillegg til + og tekst). */
  tone?: boolean;
  className?: string;
  /** Tekst ved ukjent beløp. */
  unknownLabel?: string;
  /** Ignorer «skjul beløp» (brukes ikke for summer). */
  alwaysVisible?: boolean;
}

/**
 * Viser et pengebeløp. Positive/negative beløp forstås gjennom fortegn og tekst,
 * ikke bare farge. Respekterer «skjul beløp». Ukjent beløp vises som «Ukjent».
 */
export function Amount({ value, currency = 'NOK', signed, absolute, tone, className = '', unknownLabel = 'Ukjent', alwaysVisible }: AmountProps) {
  const hidden = useData().settings.hideAmounts && !alwaysVisible;
  if (value === null || value === undefined) {
    return <span className={`num subtle ${className}`}>{unknownLabel}</span>;
  }
  if (hidden) {
    return (
      <span className={`num ${className}`} aria-label="Skjult beløp">
        •••• {currency === 'NOK' ? 'kr' : currency}
      </span>
    );
  }
  const text = formatMoney(value, currency, { signed, absolute });
  const toneClass = tone && value > 0 ? 'amount-pos' : '';
  return <span className={`num ${toneClass} ${className}`}>{text}</span>;
}
