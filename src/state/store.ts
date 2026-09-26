import { normalizeCounterparty } from '../domain/categories';
import { todayIn } from '../domain/dates';
import { classifyTransactions, mergeTransactions, type MergeStats } from '../domain/reconcile';
import { detectSubscriptions, suggestionToSubscription, type SubscriptionSuggestion } from '../domain/subscriptions';
import type { CsvRowResult } from '../domain/csv';
import type {
  Account,
  AccountType,
  AppData,
  CardStatement,
  CategoryId,
  Connection,
  CurrencyCode,
  Minor,
  Settings,
  Subscription,
  Transaction,
  TransactionKind,
} from '../domain/types';
import { generateDemoData } from '../providers/demo';
import { getProvider } from '../providers';
import { emptyData, type Repository } from '../storage/repository';

export interface StoreSnapshot {
  data: AppData;
  /** Tilkoblinger som synkroniseres akkurat nå. */
  syncing: string[];
  /** Siste melding fra synkronisering, for statuslinje. */
  syncMessage: { tone: 'ok' | 'warn' | 'error'; text: string } | null;
}

let idCounter = 0;
export function newId(prefix: string): string {
  idCounter += 1;
  const rnd = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now().toString(36)}-${idCounter}-${rnd}`;
}

/** Nøkler til abonnementer som er «bekreftet» i demodataene fra start. */
const DEMO_CONFIRMED = ['netflix', 'spotify', 'bjerke eiendom'];

export interface ManualAccountInput {
  bankName: string;
  name: string;
  type: AccountType;
  currency: CurrencyCode;
  bookedBalance: Minor | null;
  availableBalance: Minor | null;
  last4: string;
  creditLimit: Minor | null;
}

export class SaldoStore {
  private snapshot: StoreSnapshot;
  private listeners = new Set<() => void>();

  constructor(
    private repo: Repository,
    private clock: () => Date = () => new Date(),
    seedDemo = true,
  ) {
    const loaded = repo.load();
    let data = loaded;
    if (!data) {
      // Første gang lokalt: start i demomodus slik at appen kan utforskes umiddelbart.
      // Med innlogging (egne data) startes det tomt.
      data = seedDemo ? buildWithDemo(emptyData(), this.clock()) : emptyData();
      repo.save(data);
    }
    this.snapshot = { data, syncing: [], syncMessage: null };
  }

  /* --------------------------- infrastruktur --------------------------- */

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getSnapshot = () => this.snapshot;

  get data() {
    return this.snapshot.data;
  }

  now() {
    return this.clock();
  }

  today() {
    return todayIn(this.data.settings.timeZone, this.clock());
  }

  private set(partial: Partial<StoreSnapshot>, persist = true) {
    this.snapshot = { ...this.snapshot, ...partial };
    if (persist && partial.data) this.repo.save(partial.data);
    this.listeners.forEach((l) => l());
  }

  private update(fn: (d: AppData) => AppData) {
    this.set({ data: fn(this.data) });
  }

  private reclassify(d: AppData): AppData {
    return { ...d, transactions: classifyTransactions(d.transactions, d.accounts, d.rules) };
  }

  /* ------------------------------ demodata ----------------------------- */

  hasDemoData() {
    return this.data.accounts.some((a) => a.isDemo) || this.data.connections.some((c) => c.isDemo);
  }

  loadDemo() {
    this.set({ data: buildWithDemo(removeDemo(this.data), this.clock()), syncMessage: null });
  }

  clearDemo() {
    this.set({ data: this.reclassify(removeDemo(this.data)), syncMessage: null });
  }

  /** Sletter alle lagrede data (innstillinger beholdes). */
  deleteAll() {
    const settings = this.data.settings;
    this.set({ data: { ...emptyData(), settings }, syncMessage: null });
  }

  exportJson(): string {
    return JSON.stringify(
      {
        exportedAt: this.clock().toISOString(),
        note: 'Eksport fra Saldo. Beløp er oppgitt i minste valutaenhet (øre/cent).',
        ...this.data,
      },
      null,
      2,
    );
  }

  /* --------------------------- transaksjoner --------------------------- */

  setCategory(txId: string, category: CategoryId, remember: boolean) {
    this.update((d) => {
      const tx = d.transactions.find((t) => t.id === txId);
      if (!tx) return d;
      let rules = d.rules;
      if (remember) {
        const key = normalizeCounterparty(tx.counterparty);
        rules = [...rules.filter((r) => r.matchKey !== key), { id: newId('rule'), matchKey: key, category, createdAt: this.clock().toISOString() }];
      }
      const transactions = d.transactions.map((t) => (t.id === txId ? { ...t, category, userCategorized: true } : t));
      return this.reclassify({ ...d, rules, transactions });
    });
  }

  deleteRule(ruleId: string) {
    this.update((d) => this.reclassify({ ...d, rules: d.rules.filter((r) => r.id !== ruleId) }));
  }

  setKind(txId: string, kind: TransactionKind) {
    this.update((d) => {
      const tx = d.transactions.find((t) => t.id === txId);
      if (!tx) return d;
      const partnerId = tx.linkedTransactionId;
      const neutral = kind === 'internal_transfer' || kind === 'card_payment';
      const transactions = d.transactions.map((t) => {
        if (t.id === txId) return { ...t, kind, userKind: true, linkedTransactionId: kind === 'normal' ? null : t.linkedTransactionId };
        // Motposten følger med når en overføring endres.
        if (partnerId && t.id === partnerId && t.linkedTransactionId === txId && (neutral || tx.kind !== 'refund')) {
          return { ...t, kind: kind === 'refund' ? 'normal' : kind, userKind: true, linkedTransactionId: kind === 'normal' ? null : t.linkedTransactionId };
        }
        return t;
      });
      return this.reclassify({ ...d, transactions });
    });
  }

  /** Tilbakestill til automatisk kategori/type. */
  resetTransaction(txId: string) {
    this.update((d) =>
      this.reclassify({
        ...d,
        transactions: d.transactions.map((t) => (t.id === txId ? { ...t, userCategorized: false, userKind: false } : t)),
      }),
    );
  }

  /* ------------------------------ kontoer ------------------------------ */

  toggleIncluded(accountId: string) {
    this.update((d) => ({
      ...d,
      accounts: d.accounts.map((a) => (a.id === accountId ? { ...a, includedInOverview: !a.includedInOverview } : a)),
    }));
  }

  addManualAccount(input: ManualAccountInput): Account {
    const nowIso = this.clock().toISOString();
    let account!: Account;
    this.update((d) => {
      let conn = d.connections.find((c) => c.providerId === 'manual' && c.institutionName === input.bankName);
      const connections = d.connections.slice();
      if (!conn) {
        conn = {
          id: newId('conn-manual'),
          providerId: 'manual',
          institutionName: input.bankName,
          status: 'ok',
          lastSuccessfulSync: nowIso,
          lastAttempt: nowIso,
          error: null,
          consentExpiresAt: null,
          isDemo: false,
          source: 'manual',
        };
        connections.push(conn);
      }
      account = {
        id: newId('acc'),
        connectionId: conn.id,
        bankName: input.bankName,
        name: input.name,
        type: input.type,
        currency: input.currency,
        maskedNumber: input.last4 ? `•••• ${input.last4}` : 'Ikke oppgitt',
        bookedBalance: input.bookedBalance,
        availableBalance: input.availableBalance,
        availableIncludesReservations: true,
        balanceUpdatedAt: input.bookedBalance === null ? null : nowIso,
        includedInOverview: true,
        isDemo: false,
        source: 'manual',
        card:
          input.type === 'credit_card'
            ? { issuer: input.bankName, last4: input.last4, creditLimit: input.creditLimit, statement: null }
            : undefined,
      };
      return { ...d, connections, accounts: [...d.accounts, account] };
    });
    return account;
  }

  updateBalance(accountId: string, booked: Minor | null, available: Minor | null) {
    const nowIso = this.clock().toISOString();
    this.update((d) => ({
      ...d,
      accounts: d.accounts.map((a) =>
        a.id === accountId ? { ...a, bookedBalance: booked, availableBalance: available, balanceUpdatedAt: nowIso } : a,
      ),
    }));
  }

  updateCard(accountId: string, patch: { creditLimit?: Minor | null; statement?: CardStatement | null }) {
    this.update((d) => ({
      ...d,
      accounts: d.accounts.map((a) => (a.id === accountId && a.card ? { ...a, card: { ...a.card, ...patch } } : a)),
    }));
  }

  deleteAccount(accountId: string) {
    this.update((d) => {
      const accounts = d.accounts.filter((a) => a.id !== accountId);
      const usedConns = new Set(accounts.map((a) => a.connectionId));
      return this.reclassify({
        ...d,
        accounts,
        connections: d.connections.filter((c) => c.providerId !== 'manual' || usedConns.has(c.id)),
        transactions: d.transactions.filter((t) => t.accountId !== accountId),
        subscriptions: d.subscriptions.map((s) => (s.accountId === accountId ? { ...s, accountId: null } : s)),
      });
    });
  }

  /** Importerer forhåndsviste CSV-rader. Duplikater og rader med feil hoppes over. */
  importCsv(accountId: string, rows: CsvRowResult[]): number {
    const account = this.data.accounts.find((a) => a.id === accountId);
    if (!account) return 0;
    const toAdd: Transaction[] = rows
      .filter((r) => !r.error && !r.duplicate && r.date && r.amount !== null)
      .map((r) => ({
        id: newId('tx-csv'),
        accountId,
        externalId: null,
        bookingDate: r.date!,
        amount: r.amount!,
        currency: account.currency,
        counterparty: r.counterparty || r.description,
        description: r.description,
        status: 'booked' as const,
        category: 'annet' as const,
        kind: 'normal' as const,
        linkedTransactionId: null,
        userCategorized: false,
        userKind: false,
        isDemo: false,
        source: 'csv' as const,
        importFingerprint: r.fingerprint ?? undefined,
      }));
    if (toAdd.length) {
      this.update((d) => this.reclassify({ ...d, transactions: [...d.transactions, ...toAdd] }));
    }
    return toAdd.length;
  }

  /* ---------------------------- abonnementer ---------------------------- */

  suggestions(): SubscriptionSuggestion[] {
    return detectSubscriptions(this.data.transactions, this.data.subscriptions, this.data.dismissedSuggestions);
  }

  confirmSuggestion(s: SubscriptionSuggestion, overrides: Partial<Subscription> = {}) {
    this.update((d) => ({
      ...d,
      subscriptions: [...d.subscriptions, { ...suggestionToSubscription(s, newId('sub')), ...overrides }],
    }));
  }

  dismissSuggestion(matchKey: string) {
    this.update((d) => ({ ...d, dismissedSuggestions: [...new Set([...d.dismissedSuggestions, matchKey])] }));
  }

  restoreSuggestion(matchKey: string) {
    this.update((d) => ({ ...d, dismissedSuggestions: d.dismissedSuggestions.filter((k) => k !== matchKey) }));
  }

  upsertSubscription(sub: Subscription) {
    this.update((d) => {
      const exists = d.subscriptions.some((s) => s.id === sub.id);
      return {
        ...d,
        subscriptions: exists ? d.subscriptions.map((s) => (s.id === sub.id ? sub : s)) : [...d.subscriptions, sub],
      };
    });
  }

  setSubscriptionStatus(id: string, status: Subscription['status']) {
    const today = this.today();
    this.update((d) => ({
      ...d,
      subscriptions: d.subscriptions.map((s) => (s.id === id ? { ...s, status, endedAt: status === 'ended' ? today : null } : s)),
    }));
  }

  deleteSubscription(id: string) {
    this.update((d) => ({ ...d, subscriptions: d.subscriptions.filter((s) => s.id !== id) }));
  }

  /* ---------------------------- innstillinger ---------------------------- */

  updateSettings(patch: Partial<Settings>) {
    this.update((d) => ({ ...d, settings: { ...d.settings, ...patch } }));
  }

  setRate(currency: CurrencyCode, rate: number) {
    const nowIso = this.clock().toISOString();
    this.update((d) => ({
      ...d,
      rates: [
        ...d.rates.filter((r) => !(r.currency === currency && r.base === d.settings.baseCurrency)),
        { currency, base: d.settings.baseCurrency, rate, asOf: nowIso, source: 'Oppgitt manuelt av deg' },
      ],
    }));
  }

  /* ----------------------------- tilkoblinger ----------------------------- */

  /**
   * Kobler fra en bank. Med `deleteData = false` beholdes allerede hentede data
   * (merket som frakoblet); med `true` slettes kontoer og transaksjoner.
   */
  disconnect(connectionId: string, deleteData: boolean) {
    this.update((d) => {
      if (!deleteData) {
        return {
          ...d,
          connections: d.connections.map((c) =>
            c.id === connectionId ? { ...c, status: 'disconnected' as const, error: null, consentExpiresAt: null } : c,
          ),
        };
      }
      const accIds = new Set(d.accounts.filter((a) => a.connectionId === connectionId).map((a) => a.id));
      return this.reclassify({
        ...d,
        connections: d.connections.filter((c) => c.id !== connectionId),
        accounts: d.accounts.filter((a) => !accIds.has(a.id)),
        transactions: d.transactions.filter((t) => !accIds.has(t.accountId)),
        subscriptions: d.subscriptions.map((s) => (s.accountId && accIds.has(s.accountId) ? { ...s, accountId: null } : s)),
      });
    });
  }

  /**
   * Demo: simulerer at brukeren har fornyet samtykket hos banken. En ekte
   * tilkobling fornyes via bankens/tilbyderens egen innloggingsflyt.
   */
  async reauthorizeDemo(connectionId: string) {
    const conn = this.data.connections.find((c) => c.id === connectionId);
    if (!conn?.isDemo) return;
    const expires = new Date(this.clock().getTime() + 90 * 86_400_000).toISOString();
    this.update((d) => ({
      ...d,
      connections: d.connections.map((c) => (c.id === connectionId ? { ...c, status: 'ok' as const, error: null, consentExpiresAt: expires } : c)),
    }));
    await this.syncConnection(connectionId);
  }

  /** Viser en melding i statuslinjen. */
  notify(tone: 'ok' | 'warn' | 'error', text: string) {
    this.set({ syncMessage: { tone, text } }, false);
  }

  /**
   * Oppdaterer tilkoblinger fra en ekte datakilde. Tilkoblinger fra samme kilde som
   * ikke lenger finnes der, merkes som frakoblet – dataene deres beholdes.
   */
  upsertConnections(providerId: string, fresh: Connection[]) {
    this.update((d) => {
      const ids = new Set(fresh.map((c) => c.id));
      const kept = d.connections.map((c) => {
        const f = fresh.find((x) => x.id === c.id);
        if (f) return { ...f, lastAttempt: c.lastAttempt ?? f.lastAttempt };
        if (c.providerId === providerId && !ids.has(c.id) && c.status !== 'disconnected') {
          return { ...c, status: 'disconnected' as const, error: null, consentExpiresAt: null };
        }
        return c;
      });
      const added = fresh.filter((f) => !d.connections.some((c) => c.id === f.id));
      return { ...d, connections: [...kept, ...added] };
    });
  }

  async syncAll(): Promise<void> {
    const targets = this.data.connections.filter(
      (c) => c.status !== 'disconnected' && c.providerId !== 'manual' && getProvider(c.providerId),
    );
    await Promise.all(targets.map((c) => this.syncConnection(c.id)));
  }

  async syncConnection(connectionId: string): Promise<{ ok: boolean; stats?: MergeStats }> {
    const conn = this.data.connections.find((c) => c.id === connectionId);
    const provider = conn && getProvider(conn.providerId);
    if (!conn || !provider) return { ok: false };
    this.set({ syncing: [...this.snapshot.syncing, connectionId] }, false);
    try {
      const outcome = await provider.sync(conn, {
        now: this.clock(),
        accounts: this.data.accounts,
        transactions: this.data.transactions,
      });
      if (!outcome.ok) {
        // Behold tidligere data; merk tilkoblingen med feil.
        this.update((d) => ({ ...d, connections: replaceConn(d.connections, outcome.connection) }));
        this.set(
          { syncMessage: { tone: outcome.reason === 'reauth' ? 'warn' : 'error', text: outcome.message } },
          false,
        );
        return { ok: false };
      }
      let stats: MergeStats | undefined;
      this.update((d) => {
        const accIds = outcome.accounts.map((a) => a.id);
        const merged = mergeTransactions(d.transactions, outcome.transactions, {
          pendingComplete: outcome.pendingComplete,
          accountIds: accIds,
        });
        stats = merged.stats;
        const accounts = d.accounts.map((a) => {
          const fresh = outcome.accounts.find((x) => x.id === a.id);
          // Brukerens valg (inkludert i oversikt, manuelle fakturaopplysninger) beholdes.
          if (!fresh) return a;
          const manualStatement = a.card?.statement?.source === 'manual' ? a.card.statement : null;
          return {
            ...fresh,
            includedInOverview: a.includedInOverview,
            card: fresh.card ? { ...fresh.card, statement: fresh.card.statement ?? manualStatement } : undefined,
          };
        });
        // Nye kontoer fra kilden (f.eks. første henting etter tilkobling) legges til.
        for (const fresh of outcome.accounts) {
          if (!accounts.some((a) => a.id === fresh.id)) accounts.push(fresh);
        }
        return this.reclassify({
          ...d,
          connections: replaceConn(d.connections, outcome.connection),
          accounts,
          transactions: merged.transactions,
        });
      });
      this.set(
        {
          syncMessage: {
            tone: 'ok',
            text: `${conn.institutionName} oppdatert: ${stats?.added ?? 0} nye, ${stats?.pendingReplaced ?? 0} reservasjoner bokført, ${stats?.updated ?? 0} allerede kjent.`,
          },
        },
        false,
      );
      return { ok: true, stats };
    } finally {
      this.set({ syncing: this.snapshot.syncing.filter((id) => id !== connectionId) }, false);
    }
  }
}

function replaceConn(list: Connection[], conn: Connection): Connection[] {
  return list.map((c) => (c.id === conn.id ? conn : c));
}

function removeDemo(d: AppData): AppData {
  const demoAcc = new Set(d.accounts.filter((a) => a.isDemo).map((a) => a.id));
  return {
    ...d,
    connections: d.connections.filter((c) => !c.isDemo),
    accounts: d.accounts.filter((a) => !a.isDemo),
    transactions: d.transactions.filter((t) => !t.isDemo && !demoAcc.has(t.accountId)),
    subscriptions: d.subscriptions
      .filter((s) => !s.isDemo)
      .map((s) => (s.accountId && demoAcc.has(s.accountId) ? { ...s, accountId: null } : s)),
    rates: d.rates.filter((r) => !r.source.startsWith('Demokurs')),
  };
}

export function buildWithDemo(base: AppData, now: Date): AppData {
  const today = todayIn(base.settings.timeZone, now);
  const demo = generateDemoData(today, now);
  const accounts = [...base.accounts, ...demo.accounts];
  const rules = base.rules;
  const transactions = classifyTransactions([...base.transactions, ...demo.transactions], accounts, rules);
  const existingRates = new Set(base.rates.map((r) => `${r.currency}|${r.base}`));
  let data: AppData = {
    ...base,
    connections: [...base.connections, ...demo.connections],
    accounts,
    transactions,
    subscriptions: [...base.subscriptions, ...demo.subscriptions],
    rates: [...base.rates, ...demo.rates.filter((r) => !existingRates.has(`${r.currency}|${r.base}`))],
  };
  const suggestions = detectSubscriptions(data.transactions, data.subscriptions, data.dismissedSuggestions);
  const confirmed = suggestions
    .filter((s) => DEMO_CONFIRMED.includes(s.matchKey))
    .map((s) => ({ ...suggestionToSubscription(s, `demo-sub-${s.matchKey.replace(/\s+/g, '-')}`), isDemo: true }));
  data = { ...data, subscriptions: [...data.subscriptions, ...confirmed] };
  return data;
}
