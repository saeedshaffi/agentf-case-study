import { STAKE_ORDER, type CustomerConfig, type DecisionGroupConfig, type RoleId } from './config';
import { abs, sum, toCents, type Cents } from './money';
import type { Decision, Indexed, Invoice } from './types';

export interface Answer {
  optionId: string; value?: string; by: RoleId; at: string;
  /** Set when the answer was given as part of one bulk action; the whole batch undoes together. */
  batch?: string; bulk?: boolean;
}
export type Answers = Record<string, Answer>;

export interface LogEntry {
  at: string; by: RoleId; decisionId: string;
  action: 'answered' | 'undone'; optionId?: string; value?: string; bulk?: boolean; batch?: string;
}

/** Options that record a choice but leave the underlying item open ("ask the customer", "leave open"). */
export const KEEPS_OPEN = ['ask_customer', 'leave_open'];

/** Answered with an option that actually settles the question. Deferring is not settling. */
export function isSettled(a: Answer | undefined): boolean {
  return !!a && !KEEPS_OPEN.includes(a.optionId);
}

export function isDeferred(a: Answer | undefined): boolean {
  return !!a && KEEPS_OPEN.includes(a.optionId);
}

export interface DecisionGroup {
  config: DecisionGroupConfig;
  decisions: Decision[];
  /** Sub-groups (e.g. by invoice description) in display order. */
  clusters: { key: string; label: string; decisions: Decision[]; amount: Cents }[];
  /** Affected amounts per currency (never mixed). */
  amounts: Map<string, Cents>;
}

const OTHER_GROUP: DecisionGroupConfig = {
  id: '_other',
  title: 'Other questions',
  why: 'Questions this workspace has no specific guidance for yet. They are shown as the engine sent them.',
  match: { type: '*' },
  stake: 'records',
  blocksSignOff: true,
};

export function invoiceOf(d: Decision, idx: Indexed): Invoice | undefined {
  for (const r of d.references) if ('invoice' in r) return idx.invoiceById.get(r.invoice);
  return undefined;
}

export function partnerIdOf(d: Decision): string | undefined {
  for (const r of d.references) if ('partner' in r) return r.partner;
  return undefined;
}

export function amountOf(d: Decision): Cents {
  return d.amount_affected ? abs(toCents(d.amount_affected.amount)) : 0n;
}

function partnerHasZeroRatedSales(partnerId: string | undefined, idx: Indexed, cfg: CustomerConfig): boolean {
  if (!partnerId) return false;
  return (idx.invoicesByPartner.get(partnerId) ?? []).some(
    (i) => i.direction === 'receivable' && cfg.zeroRatedAccounts.includes(i.classification.account),
  );
}

function matches(g: DecisionGroupConfig, d: Decision, idx: Indexed, cfg: CustomerConfig): boolean {
  if (g.match.type !== d.type) return false;
  if (g.match.partnerHasZeroRatedSales !== undefined) {
    return partnerHasZeroRatedSales(partnerIdOf(d), idx, cfg) === g.match.partnerHasZeroRatedSales;
  }
  return true;
}

/**
 * Turns the flat list of open questions into ordered groups.
 * Order: by what is at stake (tax first, cents last), then by the order in the config.
 * Any question type the config does not know lands in "Other questions" rather than disappearing.
 */
export function groupDecisions(idx: Indexed, cfg: CustomerConfig): DecisionGroup[] {
  const buckets = new Map<string, Decision[]>();
  const configs = [...cfg.decisionGroups];
  for (const d of idx.decisions) {
    const g = configs.find((g) => matches(g, d, idx, cfg)) ?? OTHER_GROUP;
    if (g === OTHER_GROUP && !configs.includes(OTHER_GROUP)) configs.push(OTHER_GROUP);
    (buckets.get(g.id) ?? buckets.set(g.id, []).get(g.id)!).push(d);
  }
  const order = (g: DecisionGroupConfig) => STAKE_ORDER.indexOf(g.stake) * 1000 + configs.indexOf(g);

  return configs
    .filter((g) => buckets.has(g.id))
    .sort((a, b) => order(a) - order(b))
    .map((g) => {
      let ds = buckets.get(g.id)!;
      if (g.sortBy === 'amount_desc') ds = [...ds].sort((a, b) => (amountOf(b) > amountOf(a) ? 1 : amountOf(b) < amountOf(a) ? -1 : 0));
      const clusters = cluster(g, ds, idx);
      return { config: g, decisions: ds, clusters, amounts: totalsByCurrency(ds, idx) };
    });
}

function cluster(g: DecisionGroupConfig, ds: Decision[], idx: Indexed) {
  if (!g.groupBy) return [{ key: 'all', label: '', decisions: ds, amount: sum(ds.map(amountOf)) }];
  const m = new Map<string, Decision[]>();
  for (const d of ds) {
    const inv = invoiceOf(d, idx);
    const key = g.groupBy === 'description' ? inv?.description ?? '—' : inv?.partner_name ?? '—';
    (m.get(key) ?? m.set(key, []).get(key)!).push(d);
  }
  return [...m.entries()]
    .map(([key, decisions]) => ({ key, label: key, decisions, amount: sum(decisions.map(amountOf)) }))
    .sort((a, b) => (b.amount > a.amount ? 1 : b.amount < a.amount ? -1 : 0));
}

export interface Progress {
  total: number;
  /** Any answer, including deferrals. */
  answered: number;
  required: number;
  requiredSettled: number;
  /** Required questions not settled (open or deferred): these block sign-off. */
  blockingOpen: number;
  /** Required questions answered with a deferral: they still block. */
  requiredDeferred: number;
  optional: number;
  optionalAnswered: number;
}

export function progress(groups: DecisionGroup[], answers: Answers): Progress {
  const p: Progress = { total: 0, answered: 0, required: 0, requiredSettled: 0, blockingOpen: 0, requiredDeferred: 0, optional: 0, optionalAnswered: 0 };
  for (const g of groups) for (const d of g.decisions) {
    const a = answers[d.id];
    p.total++;
    if (a) p.answered++;
    if (g.config.blocksSignOff) {
      p.required++;
      if (isSettled(a)) p.requiredSettled++;
      else { p.blockingOpen++; if (a) p.requiredDeferred++; }
    } else {
      p.optional++;
      if (a) p.optionalAnswered++;
    }
  }
  return p;
}

/**
 * The amount a question is about, in the currency of the records it refers to.
 * The engine labels a few USD amounts as EUR; the referenced transaction or invoice is the better witness.
 */
export function moneyOf(d: Decision, idx: Indexed): { value: Cents; currency: string; engineCurrency: string; mismatch: boolean } | null {
  if (!d.amount_affected) return null;
  const engineCurrency = d.amount_affected.currency;
  let recordCurrency: string | undefined;
  for (const r of d.references) {
    if ('transaction' in r) recordCurrency ??= idx.txById.get(r.transaction)?.currency;
    if ('invoice' in r) recordCurrency ??= idx.invoiceById.get(r.invoice)?.original.gross.currency;
  }
  const currency = recordCurrency ?? engineCurrency;
  return { value: abs(toCents(d.amount_affected.amount)), currency, engineCurrency, mismatch: currency !== engineCurrency };
}

/** Sum of amounts per currency, never mixing currencies. */
export function totalsByCurrency(ds: Decision[], idx: Indexed): Map<string, Cents> {
  const m = new Map<string, Cents>();
  for (const d of ds) { const x = moneyOf(d, idx); if (x) m.set(x.currency, (m.get(x.currency) ?? 0n) + x.value); }
  return m;
}

/** One line of change to an account, in EUR cents. Positive = debit increases. */
export interface EffectLine { account: string; delta: Cents }

export interface Effect {
  /** Machine-computed change to the books, when we can compute it from the data. */
  lines: EffectLine[];
  /** The engine's own description of the effect. */
  text: string;
}

/**
 * What choosing an option would do to the books.
 * We only compute changes we can derive exactly from the data; otherwise we show the engine's text.
 */
export function previewEffect(d: Decision, optionId: string, idx: Indexed): Effect {
  const opt = d.options.find((o) => o.id === optionId);
  const text = opt?.effect ?? '';
  const inv = invoiceOf(d, idx);
  if (d.type === 'uncertain_classification' && inv) {
    const from = inv.classification.account;
    if (from === optionId) return { lines: [], text: 'No change: this is how it is booked now.' };
    // The expense posting is the line on the currently classified account.
    const net = sum(inv.postings.filter((p) => p.account === from).map((p) => toCents(p.debit) - toCents(p.credit)));
    return { lines: [{ account: from, delta: -net }, { account: optionId, delta: net }], text };
  }
  if (d.type === 'rounding_difference' && optionId === 'use_export_gross' && d.amount_affected) {
    return { lines: [], text: `${text} (to a rounding account not included in this export)` };
  }
  return { lines: [], text };
}

export function nowIso(): string { return new Date().toISOString(); }
