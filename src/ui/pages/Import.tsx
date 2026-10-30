import { CheckCircle2, FileUp, Loader2, Upload } from 'lucide-react';
import { useMemo, useRef, useState, type ChangeEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { guessMapping, parseCsv, positiveShare, previewImport, type CsvColumn, type CsvMapping } from '../../domain/csv';
import { formatDate } from '../../domain/dates';
import { formatMoney } from '../../domain/money';
import { parseStatementLines, statementToCsv, type PdfStatement } from '../../domain/pdfStatement';
import { pdfToLines } from '../lib/pdfText';
import { useData, useStore, useToday } from '../../state/StoreContext';
import { AddAccountDialog } from '../components/AccountForms';
import { Amount } from '../components/Amount';
import { Notice } from '../components/common';
import { Page } from '../Layout';

const SAMPLE = `Dato;Beskrivelse;Mottaker;Beløp
02.09.2026;Varekjøp;REMA 1000 Grünerløkka;-289,40
03.09.2026;Månedskort;Ruter;-890,00
05.09.2026;Refusjon;Zalando SE;499,00
05.09.2026;Varekjøp;REMA 1000 Grünerløkka;-289,40
25.09.2026;Lønn;Arbeidsgiver AS;32 450,00`;

const FIELDS: { key: CsvColumn; label: string; required?: boolean }[] = [
  { key: 'date', label: 'Dato', required: true },
  { key: 'amount', label: 'Beløp (med fortegn)' },
  { key: 'outAmount', label: 'Beløp ut' },
  { key: 'inAmount', label: 'Beløp inn' },
  { key: 'counterparty', label: 'Mottaker' },
  { key: 'description', label: 'Beskrivelse' },
];

export function ImportPage() {
  const data = useData();
  const store = useStore();
  const [params] = useSearchParams();
  const accounts = data.accounts;
  const [accountId, setAccountId] = useState(params.get('konto') ?? accounts.find((a) => a.source !== 'demo')?.id ?? accounts[0]?.id ?? '');
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [mapping, setMapping] = useState<CsvMapping | null>(null);
  const [result, setResult] = useState<{ imported: number; skipped: number } | null>(null);
  const [adding, setAdding] = useState<false | 'account' | 'card'>(false);
  /** `null` = automatisk forslag ut fra kontotype og beløpene i filen. */
  const [invert, setInvert] = useState<boolean | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [pdf, setPdf] = useState<PdfStatement | null>(null);
  const [readingPdf, setReadingPdf] = useState(false);
  const [updateStatement, setUpdateStatement] = useState(true);
  const today = useToday();
  const fileRef = useRef<HTMLInputElement>(null);

  const account = accounts.find((a) => a.id === accountId);
  const parsed = useMemo(() => (text.trim() ? parseCsv(text) : null), [text]);
  // Kredittkortutstedere (f.eks. Amex) eksporterer ofte kjøp som positive beløp. Foreslå å snu fortegnet da.
  const autoInvert = useMemo(() => {
    if (!parsed || !mapping || account?.type !== 'credit_card') return false;
    return positiveShare(previewImport(parsed.rows, { ...mapping, invert: false }, account.id, account.currency, [])) > 0.5;
  }, [parsed, mapping, account]);
  const effectiveInvert = invert ?? autoInvert;
  const preview = useMemo(
    () => (parsed && mapping && account ? previewImport(parsed.rows, { ...mapping, invert: effectiveInvert }, account.id, account.currency, data.transactions) : []),
    [parsed, mapping, account, data.transactions, effectiveInvert],
  );
  const counts = {
    ok: preview.filter((r) => !r.error && !r.duplicate).length,
    dup: preview.filter((r) => r.duplicate).length,
    err: preview.filter((r) => r.error).length,
  };
  const header = parsed && mapping?.hasHeader ? parsed.rows[0] : parsed?.rows[0]?.map((_, i) => `Kolonne ${i + 1}`);

  const load = (content: string, name: string | null) => {
    setText(content);
    setFileName(name);
    setResult(null);
    setInvert(null);
    const p = content.trim() ? parseCsv(content) : null;
    setMapping(p ? guessMapping(p.rows) : null);
  };

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    setFileError(null);
    setPdf(null);
    if (!f) return;
    if (f.size > 10_000_000) {
      setFileError('Filen er for stor (maks 10 MB).');
      return;
    }
    const buf = await f.arrayBuffer();
    if (f.type === 'application/pdf' || /\.pdf$/i.test(f.name)) {
      setReadingPdf(true);
      try {
        const lines = await pdfToLines(buf);
        const st = parseStatementLines(lines, today);
        if (!lines.length) return setFileError('PDF-en inneholder ingen tekst (trolig et skannet bilde). Last ned fakturaen som PDF fra nettbanken, eller bruk CSV.');
        if (!st.rows.length) return setFileError('Fant ingen transaksjoner i PDF-en. Formatet støttes kanskje ikke – prøv CSV fra kortutstederen.');
        setPdf(st);
        load(statementToCsv(st), f.name);
      } catch {
        setFileError('Kunne ikke lese PDF-en. Er den passordbeskyttet? Prøv å laste den ned på nytt, eller bruk CSV.');
      } finally {
        setReadingPdf(false);
      }
      return;
    }
    // Norske banker eksporterer ofte i Windows-1252 – prøv UTF-8 først.
    let content = new TextDecoder('utf-8').decode(buf);
    if (content.includes(String.fromCharCode(0xfffd))) content = new TextDecoder('windows-1252').decode(buf);
    load(content, f.name);
  };

  const doImport = () => {
    if (!account) return;
    const n = store.importCsv(account.id, preview);
    // Fakturaopplysninger fra PDF-en lagres på kortet.
    if (pdf && updateStatement && account.type === 'credit_card' && (pdf.total !== null || pdf.dueDate)) {
      const prev = account.card?.statement;
      store.updateCard(account.id, {
        statement: { amount: pdf.total, minimumPayment: prev?.minimumPayment ?? null, dueDate: pdf.dueDate, source: 'manual', updatedAt: new Date().toISOString() },
      });
    }
    setPdf(null);
    setResult({ imported: n, skipped: counts.dup + counts.err });
    setText('');
    setMapping(null);
    setFileName(null);
    if (fileRef.current) fileRef.current.value = '';
  };

  return (
    <Page title="Importer CSV eller PDF" back={{ to: '/kontoer', label: 'Tilbake til kontoer' }} plain>
      <p className="muted small">
        Eksporter transaksjoner fra nettbanken som CSV – eller last opp PDF-fakturaen fra kredittkortet (f.eks. Amex eller SpareBank 1) – og importer dem hit. Du ser en forhåndsvisning før noe lagres, og transaksjoner som allerede finnes, hoppes over.
      </p>

      {result && (
        <div className="notice" role="status">
          <CheckCircle2 size={18} style={{ color: 'var(--positive)' }} aria-hidden="true" />
          <div className="notice-body">
            <p style={{ fontWeight: 600 }}>
              {result.imported} transaksjoner importert til {account?.name}.
            </p>
            <p className="muted small">
              {result.skipped} rader ble hoppet over (duplikater eller feil). Saldoen på kontoen endres ikke av importen – oppdater den manuelt ved behov.{' '}
              <Link to={`/kontoer/${account?.id}`}>Se kontoen</Link>
            </p>
          </div>
        </div>
      )}

      <section className="card stack">
        <h2>1. Velg konto</h2>
        {accounts.length ? (
          <div className="row wrap" style={{ alignItems: 'flex-end' }}>
            <label className="field grow" style={{ minWidth: 220 }}>
              <span>Transaksjonene gjelder</span>
              <select className="select" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.bankName} · {a.name} ({a.currency}){a.isDemo ? ' – demo' : ''}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className="btn" onClick={() => setAdding('card')}>
              Nytt kredittkort
            </button>
            <button type="button" className="btn" onClick={() => setAdding('account')}>
              Ny manuell konto
            </button>
          </div>
        ) : (
          <div className="stack-sm">
            <p className="muted small">Du må ha en konto eller et kort å importere til.</p>
            <div className="row wrap">
              <button type="button" className="btn primary" onClick={() => setAdding('card')}>
                Opprett kredittkort (f.eks. Amex)
              </button>
              <button type="button" className="btn" onClick={() => setAdding('account')}>
                Opprett manuell konto
              </button>
            </div>
          </div>
        )}
      </section>

      <section className="card stack">
        <h2>2. Velg fil</h2>
        <div className="row wrap">
          <label className="btn primary" style={{ position: 'relative' }}>
            <Upload size={16} aria-hidden="true" /> Velg CSV- eller PDF-fil
            <input ref={fileRef} type="file" accept=".csv,.txt,text/csv,.pdf,application/pdf" onChange={onFile} className="sr-only" />
          </label>
          <button type="button" className="btn" onClick={() => {
            setPdf(null);
            load(SAMPLE, 'eksempel.csv');
          }}>
            <FileUp size={16} aria-hidden="true" /> Bruk eksempelfil
          </button>
          {fileName && <span className="small muted">{fileName}</span>}
        </div>
        {readingPdf && (
          <p className="small muted row">
            <Loader2 size={16} className="spin" aria-hidden="true" /> Leser PDF-en …
          </p>
        )}
        {pdf && (
          <Notice title={`Fant ${pdf.rows.length} transaksjoner i PDF-en`}>
            PDF-er har ingen fast struktur, så dette er et beste forsøk. Sjekk forhåndsvisningen før du importerer – rader som ikke er transaksjoner kan du rette i CSV eller la være.
            {account?.type === 'credit_card' && (pdf.total !== null || pdf.dueDate) && (
              <label className="check" style={{ marginTop: 8 }}>
                <input type="checkbox" checked={updateStatement} onChange={(e) => setUpdateStatement(e.target.checked)} />
                <span className="small">
                  Oppdater fakturaen på kortet
                  {pdf.total !== null ? ` – å betale ${formatMoney(pdf.total, account.currency)}` : ''}
                  {pdf.dueDate ? `, forfall ${formatDate(pdf.dueDate, 'short')}` : ''}
                </span>
              </label>
            )}
          </Notice>
        )}
        <p className="xsmall subtle">PDF-en leses lokalt i nettleseren og sendes ikke noe sted. Skannede PDF-er (bilder) kan ikke leses.</p>
        {fileError && (
          <p className="error-text" role="alert">
            {fileError}
          </p>
        )}
        <details>
          <summary className="small" style={{ cursor: 'pointer', color: 'var(--text-2)' }}>
            Eller lim inn innhold
          </summary>
          <textarea
            className="input"
            rows={6}
            style={{ marginTop: 8, fontFamily: 'ui-monospace, monospace', fontSize: '0.8rem' }}
            value={text}
            onChange={(e) => {
              setPdf(null);
              load(e.target.value, null);
            }}
            aria-label="CSV-innhold"
            placeholder="Dato;Beskrivelse;Beløp"
          />
        </details>
      </section>

      {parsed && mapping && (
        <section className="card stack">
          <h2>3. Koble kolonner</h2>
          <p className="small muted">
            Fant {parsed.rows.length} rader, skilletegn «{parsed.delimiter === '\t' ? 'tab' : parsed.delimiter}». Bruk enten én beløpskolonne med fortegn, eller separate kolonner for inn og ut.
          </p>
          <label className="check">
            <input type="checkbox" checked={mapping.hasHeader} onChange={(e) => setMapping({ ...mapping, hasHeader: e.target.checked })} />
            <span className="small">Første rad er overskrifter</span>
          </label>
          <label className="check">
            <input type="checkbox" checked={effectiveInvert} onChange={(e) => setInvert(e.target.checked)} />
            <span className="small">
              Kjøp står som positive beløp – snu fortegn
              {account?.type === 'credit_card' && autoInvert && invert === null ? ' (foreslått for kredittkort som Amex)' : ''}
            </span>
          </label>
          <label className="check">
            <input type="checkbox" checked={mapping.dateOrder === 'mdy'} onChange={(e) => setMapping({ ...mapping, dateOrder: e.target.checked ? 'mdy' : 'dmy' })} />
            <span className="small">Datoer har måned først (09/24/2026)</span>
          </label>
          <div className="form-grid two">
            {FIELDS.map((f) => (
              <label className="field" key={f.key}>
                <span>
                  {f.label}
                  {f.required ? ' *' : ''}
                </span>
                <select
                  className="select"
                  value={mapping[f.key] ?? ''}
                  onChange={(e) => {
                    const v = e.target.value === '' ? null : Number(e.target.value);
                    const next = { ...mapping, [f.key]: v };
                    if (f.key === 'amount' && v !== null) {
                      next.outAmount = null;
                      next.inAmount = null;
                    }
                    if ((f.key === 'outAmount' || f.key === 'inAmount') && v !== null) next.amount = null;
                    setMapping(next);
                  }}
                >
                  <option value="">– Ikke i bruk –</option>
                  {header?.map((h, i) => (
                    <option key={i} value={i}>
                      {h || `Kolonne ${i + 1}`}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        </section>
      )}

      {preview.length > 0 && (
        <section className="card stack">
          <div className="spread wrap">
            <h2>4. Forhåndsvisning</h2>
            <div className="row wrap" style={{ gap: 6 }}>
              <span className="badge ok">{counts.ok} nye</span>
              <span className="badge">{counts.dup} duplikater</span>
              {counts.err > 0 && <span className="badge error">{counts.err} med feil</span>}
            </div>
          </div>
          <div className="table-scroll">
            <table className="data">
              <caption className="sr-only">Forhåndsvisning av import</caption>
              <thead>
                <tr>
                  <th scope="col">Rad</th>
                  <th scope="col" style={{ textAlign: 'left' }}>
                    Dato
                  </th>
                  <th scope="col" style={{ textAlign: 'left' }}>
                    Tekst
                  </th>
                  <th scope="col">Beløp</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {preview.slice(0, 200).map((r) => (
                  <tr key={r.line} style={r.duplicate || r.error ? { opacity: 0.6 } : undefined}>
                    <td>{r.line}</td>
                    <td style={{ textAlign: 'left', whiteSpace: 'nowrap' }}>{r.date ? formatDate(r.date, 'short') : '–'}</td>
                    <td style={{ textAlign: 'left', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.counterparty || r.description}</td>
                    <td>{r.amount !== null ? <Amount value={r.amount} currency={account?.currency} signed alwaysVisible /> : '–'}</td>
                    <td>
                      {r.error ? <span className="badge error">{r.error}</span> : r.duplicate ? <span className="badge">Finnes fra før</span> : <span className="badge ok">Ny</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {preview.length > 200 && <p className="xsmall subtle">Viser de første 200 radene. Alle {preview.length} behandles ved import.</p>}
          {account?.isDemo && <Notice tone="warn">Du importerer til en demokonto. Importerte rader slettes sammen med demokontoen hvis du fjerner demodata.</Notice>}
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button type="button" className="btn primary" disabled={counts.ok === 0} onClick={doImport}>
              Importer {counts.ok} transaksjoner
            </button>
          </div>
        </section>
      )}

      <AddAccountDialog
        key={adding || 'closed'}
        open={!!adding}
        initialType={adding === 'card' ? 'credit_card' : 'checking'}
        onClose={() => setAdding(false)}
        onCreated={(a) => setAccountId(a.id)}
      />
    </Page>
  );
}
