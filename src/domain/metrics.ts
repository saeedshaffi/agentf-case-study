import { sum, toCents, toDecimalString, type Cents } from './money';
import { moneyOf } from './decisions';
import type { Indexed, Invoice } from './types';

/** Anything on screen that can be opened. */
export type TraceTarget =
  | { kind: 'metric'; id: MetricId }
  | { kind: 'invoice'; id: string }
  | { kind: 'tx'; id: string }
  | { kind: 'partner'; id: string }
  | { kind: 'account'; id: string }
  | { kind: 'decision'; id: string }
  | { kind: 'load'; id: string }
  | { kind: 'check'; id: string };

export type MetricId =
  | 'invoices_loaded' | 'open_receivables_eur' | 'open_credit_notes_eur' | 'net_receivables_eur'
  | 'open_payables_eur' | 'open_receivables_usd'
  | 'debits' | 'credits' | 'bank_matched' | 'bank_unmatched' | 'decision_amount'
  | 'sales_eur' | 'sales_usd' | 'purchases_eur' | 'credit_notes_eur';

export interface MetricPart { label: string; value: Cents; count: number; items: string[]; itemKind: 'invoice' | 'tx' }

export interface Metric {
  id: MetricId;
  label: string;
  /** Plain-language explanation for the finance lead. */
  explain: string;
  /** Accountant's definition for the tax advisor. */
  definition: string;
  kind: 'money' | 'count';
  value: Cents | number;
  currency?: string;
  parts: MetricPart[];
  /** The engine's own figure for the same metric, where it reports one. */
  engineValue?: string | number;
}

const openOf = (i: Invoice) => toCents(i.payment.open.amount);
const cur = (i: Invoice) => i.original.gross.currency;

function part(label: string, invoices: Invoice[], value: (i: Invoice) => Cents): MetricPart {
  return { label, value: sum(invoices.map(value)), count: invoices.length, items: invoices.map((i) => i.id), itemKind: 'invoice' };
}

export function computeMetrics(idx: Indexed): Record<MetricId, Metric> {
  const inv = idx.invoices;
  const rec = inv.filter((i) => i.direction === 'receivable');
  const recInvEur = rec.filter((i) => i.type === 'invoice' && cur(i) === 'EUR' && openOf(i) !== 0n);
  // Credit notes carry a positive open amount meaning "we owe the customer this"; it reduces receivables.
  const cnEur = rec.filter((i) => i.type === 'credit_note' && cur(i) === 'EUR' && openOf(i) !== 0n);
  const payEur = inv.filter((i) => i.direction === 'payable' && cur(i) === 'EUR' && openOf(i) !== 0n);
  const recUsd = rec.filter((i) => cur(i) === 'USD' && openOf(i) !== 0n);
  const allPostings = inv.flatMap((i) => i.postings.map((p) => ({ i, p })));
  const matched = idx.bank.filter((t) => t.match);
  const unmatched = idx.bank.filter((t) => !t.match);

  const recOpen = part('Open sales invoices', recInvEur, openOf);
  const cnOpen = { ...part('minus open credit notes', cnEur, openOf) };
  cnOpen.value = -cnOpen.value;

  const grossPart = (label: string, xs: Invoice[]) => part(label, xs, (i) => toCents(i.original.gross.amount));
  const s = idx.summary;
  const tot = s.totals_by_currency_original;

  const m: Record<MetricId, Metric> = {
    invoices_loaded: {
      id: 'invoices_loaded', label: 'Invoices loaded', kind: 'count', value: inv.length,
      explain: 'Every sales invoice, supplier invoice and credit note that is now in your books.',
      definition: 'Unique invoice records after removing duplicate rows and replacing superseded versions.',
      parts: [
        grossPart('Sales invoices', inv.filter((i) => i.direction === 'receivable' && i.type === 'invoice')),
        grossPart('Credit notes', inv.filter((i) => i.type === 'credit_note')),
        grossPart('Supplier invoices', inv.filter((i) => i.direction === 'payable')),
      ].map((p) => ({ ...p, value: BigInt(p.count) })),
      engineValue: s.counts.invoices_loaded,
    },
    open_receivables_eur: {
      id: 'open_receivables_eur', label: 'Open receivables (EUR)', kind: 'money', currency: 'EUR',
      value: recOpen.value,
      explain: 'What your customers still owe you on sales invoices in euros. Credit notes you owe them are shown separately.',
      definition: 'Sum of open amounts on EUR sales invoices. Excludes credit notes and USD items (engine definition).',
      parts: [recOpen],
      engineValue: s.open_items_eur_only.receivables,
    },
    open_credit_notes_eur: {
      id: 'open_credit_notes_eur', label: 'Open credit notes (EUR)', kind: 'money', currency: 'EUR',
      value: -cnOpen.value,
      explain: 'Credit notes you issued to customers that have not been refunded or set against an invoice yet. This is money you owe them.',
      definition: 'Open amounts on EUR credit notes (status open_credit). Not included in the engine\'s open receivables.',
      parts: [{ ...cnOpen, value: -cnOpen.value, label: 'Open credit notes' }],
    },
    net_receivables_eur: {
      id: 'net_receivables_eur', label: 'Net open receivables (EUR)', kind: 'money', currency: 'EUR',
      value: recOpen.value + cnOpen.value,
      explain: 'What customers owe you, minus what you owe them back on credit notes.',
      definition: 'Open amounts on EUR sales invoices less open amounts on EUR credit notes. Not an account balance: account 1200 also carries settled invoices, because payments are matched but not booked in this export.',
      parts: [recOpen, cnOpen],
    },
    open_payables_eur: {
      id: 'open_payables_eur', label: 'Open payables (EUR)', kind: 'money', currency: 'EUR',
      value: sum(payEur.map(openOf)),
      explain: 'What you still owe your suppliers.',
      definition: 'Sum of open amounts on supplier invoices (all EUR).',
      parts: [part('Open supplier invoices', payEur, openOf)],
      engineValue: s.open_items_eur_only.payables,
    },
    open_receivables_usd: {
      id: 'open_receivables_usd', label: 'Open receivables (USD)', kind: 'money', currency: 'USD',
      value: sum(recUsd.map(openOf)),
      explain: 'Invoices in US dollars that are still open. Kept in dollars and never added to a euro total, because the rate on the day they are paid is not known yet.',
      definition: 'Open amounts in original currency on USD sales invoices.',
      parts: [part('Open USD invoices', recUsd, openOf)],
    },
    debits: {
      id: 'debits', label: 'Journal debits', kind: 'money', currency: 'EUR',
      value: sum(allPostings.map(({ p }) => toCents(p.debit))),
      explain: 'The sum of the debit side of every invoice booking. It must equal the credit side. It is a measure of volume, not a balance or an amount of money you hold.',
      definition: 'Sum of debit amounts over all invoice postings, EUR.',
      parts: [], engineValue: s.balance_check.debits_eur,
    },
    credits: {
      id: 'credits', label: 'Journal credits', kind: 'money', currency: 'EUR',
      value: sum(allPostings.map(({ p }) => toCents(p.credit))),
      explain: 'The other side of every booking.',
      definition: 'Sum of credit amounts over all invoice postings, EUR.',
      parts: [], engineValue: s.balance_check.credits_eur,
    },
    bank_matched: {
      id: 'bank_matched', label: 'Bank transactions explained', kind: 'count', value: matched.length,
      explain: 'Payments in and out that we linked to an invoice or recognised as a bank fee.',
      definition: 'Bank transactions with a match (full, partial, combined, overpayment or bank fee).',
      parts: (['rule', 'fuzzy_reference'] as const).map((by) => {
        const xs = matched.filter((t) => t.match!.decided_by === by);
        return { label: by === 'rule' ? 'Matched by exact reference' : 'Matched by similar reference', value: BigInt(xs.length), count: xs.length, items: xs.map((t) => t.id), itemKind: 'tx' as const };
      }),
      engineValue: s.counts.bank_transactions_matched,
    },
    bank_unmatched: {
      id: 'bank_unmatched', label: 'Bank transactions not yet explained', kind: 'count', value: unmatched.length,
      explain: 'Payments that wait for you to say what they were.',
      definition: 'Bank transactions without a match; each has an open question.',
      parts: [true, false].map((incoming) => {
        const xs = unmatched.filter((t) => (toCents(t.amount.amount) > 0n) === incoming);
        return { label: incoming ? 'Money in' : 'Money out', value: BigInt(xs.length), count: xs.length, items: xs.map((t) => t.id), itemKind: 'tx' as const };
      }),
      engineValue: s.counts.bank_transactions_loaded - s.counts.bank_transactions_matched,
    },
    decision_amount: {
      id: 'decision_amount', label: 'Amount affected by open questions', kind: 'money', currency: 'EUR',
      value: idx.decisions.reduce((t, d) => { const x = moneyOf(d, idx); return x && x.currency === 'EUR' ? t + x.value : t; }, 0n),
      explain: 'The euros that depend on your answers. Most of it is expense accounts; the rest is cents and small payments.',
      definition: 'Sum of |amount_affected| over open questions whose records are in EUR. USD questions are excluded.',
      parts: [],
    },
    sales_eur: {
      id: 'sales_eur', label: 'Sales invoices (EUR, gross)', kind: 'money', currency: 'EUR',
      value: sum(rec.filter((i) => i.type === 'invoice' && cur(i) === 'EUR').map((i) => toCents(i.original.gross.amount))),
      explain: 'Everything you invoiced in euros, including VAT.', definition: 'Gross of EUR sales invoices, original currency.',
      parts: [], engineValue: tot['receivable:invoice:EUR'],
    },
    sales_usd: {
      id: 'sales_usd', label: 'Sales invoices (USD, gross)', kind: 'money', currency: 'USD',
      value: sum(rec.filter((i) => cur(i) === 'USD').map((i) => toCents(i.original.gross.amount))),
      explain: 'Everything you invoiced in dollars.', definition: 'Gross of USD sales invoices, original currency.',
      parts: [], engineValue: tot['receivable:invoice:USD'],
    },
    purchases_eur: {
      id: 'purchases_eur', label: 'Supplier invoices (EUR, gross)', kind: 'money', currency: 'EUR',
      value: sum(inv.filter((i) => i.direction === 'payable').map((i) => toCents(i.original.gross.amount))),
      explain: 'Everything your suppliers invoiced you.', definition: 'Gross of supplier invoices.',
      parts: [], engineValue: tot['payable:invoice:EUR'],
    },
    credit_notes_eur: {
      id: 'credit_notes_eur', label: 'Credit notes (EUR, gross)', kind: 'money', currency: 'EUR',
      value: sum(inv.filter((i) => i.type === 'credit_note').map((i) => toCents(i.original.gross.amount))),
      explain: 'Credit notes you issued to customers.', definition: 'Gross of credit notes (negative).',
      parts: [], engineValue: tot['receivable:credit_note:EUR'],
    },
  };
  return m;
}

/** Does our recomputation agree with the engine's own figure? */
export function agreesWithEngine(m: Metric): boolean | null {
  if (m.engineValue === undefined) return null;
  if (m.kind === 'count') return Number(m.value) === Number(m.engineValue);
  return toDecimalString(m.value as Cents) === toDecimalString(toCents(String(m.engineValue)));
}
