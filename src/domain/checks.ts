import type { CustomerConfig } from './config';
import { agreesWithEngine, computeMetrics, type TraceTarget } from './metrics';
import { abs, sum, toCents, type Cents } from './money';
import type { Indexed, Invoice } from './types';

// Checks the front end runs over the engine's output before showing it to a customer.
// They do not change any number. They make sure the customer hears about a problem from us
// before their tax advisor finds it.

export type Severity = 'attention' | 'info' | 'passed';

export interface Finding {
  id: string;
  severity: Severity;
  title: string;
  detail: string;
  /** Who should act, in plain words. */
  next?: string;
  amount?: { value: Cents; currency: string };
  items: TraceTarget[];
  /** Questions whose answers settle this finding. Empty: it needs reading, not answering. */
  decisionIds?: string[];
}

/** Options that record a choice but leave the underlying problem open. */
export const KEEPS_OPEN = ['ask_customer', 'leave_open'];

export function isResolved(f: Finding, answers: Record<string, { optionId: string }>): boolean {
  if (!f.decisionIds?.length) return false;
  return f.decisionIds.every((id) => answers[id] && !KEEPS_OPEN.includes(answers[id].optionId));
}

export function runChecks(idx: Indexed, cfg: CustomerConfig): Finding[] {
  const on = (k: string) => cfg.checks[k] !== false;
  const out: Finding[] = [];
  const inv = idx.invoices;

  if (on('overpaidWithoutDecision')) {
    const xs = inv.filter((i) => i.payment.status === 'overpaid').filter((i) => {
      const txs = idx.txByInvoice.get(i.id) ?? [];
      return !i.decision_ids.length && !txs.some((t) => t.decision_ids?.length);
    });
    if (xs.length) {
      const extra = sum(xs.map((i) => toCents(i.payment.paid.amount) - toCents(i.original.gross.amount)));
      out.push({
        id: 'overpaid_without_decision', severity: 'attention',
        title: `${xs.length} overpayments have no question attached`,
        detail: `These invoices are marked "overpaid", but the bank payment was matched as a normal full payment and no question was raised. The other ${inv.filter((i) => i.payment.status === 'overpaid').length - xs.length} overpayments each have one. Together they are`,
        next: 'Open each one and decide like the other overpayments: keep as credit, refund, or book as income. What customers owe you is not affected; this is about the extra money they paid.',
        amount: { value: extra, currency: 'EUR' },
        items: xs.map((i) => ({ kind: 'invoice', id: i.id })),
      });
    }
  }

  if (on('inconsistentSuggestions')) {
    // Same description + same supplier = same model input. Different suggestions for the same input mean the
    // suggestions should not be accepted one by one.
    const byInput = new Map<string, Set<string>>();
    const ids = new Map<string, string[]>();
    const decs = new Map<string, string[]>();
    for (const d of idx.decisions.filter((d) => d.type === 'uncertain_classification' && d.suggested_option)) {
      const ref = d.references.find((r) => 'invoice' in r) as { invoice: string } | undefined;
      const i = ref && idx.invoiceById.get(ref.invoice);
      if (!i) continue;
      const k = `${i.partner_id}|${i.description}`;
      (byInput.get(k) ?? byInput.set(k, new Set()).get(k)!).add(d.suggested_option!);
      (ids.get(k) ?? ids.set(k, []).get(k)!).push(i.id);
      (decs.get(k) ?? decs.set(k, []).get(k)!).push(d.id);
    }
    const bad = [...byInput.entries()].filter(([, v]) => v.size > 1);
    if (bad.length) {
      const n = bad.reduce((t, [k]) => t + ids.get(k)!.length, 0);
      out.push({
        id: 'inconsistent_suggestions', severity: 'attention',
        title: 'The model gave different answers to the same question',
        detail: `For ${bad.length} combinations of supplier and description, the model suggested more than one expense account, although that is all it sees. This affects ${n} invoices. All of them are currently booked on the suggestion, pending your review.`,
        next: 'Decide once per description what this cost is, and book them all the same way. The questions page offers this.',
        items: bad.flatMap(([k]) => ids.get(k)!.map((id) => ({ kind: 'invoice', id }) as TraceTarget)),
        decisionIds: bad.flatMap(([k]) => decs.get(k)!),
      });
    }
  }

  if (on('zeroRatedWithoutValidVatId')) {
    for (const p of idx.partners.filter((p) => p.flags.includes('malformed_vat_id'))) {
      const xs = (idx.invoicesByPartner.get(p.id) ?? []).filter(
        (i) => i.direction === 'receivable' && cfg.zeroRatedAccounts.includes(i.classification.account),
      );
      if (!xs.length) continue;
      const net = sumBooked(xs);
      const cn = xs.filter((i) => i.type === 'credit_note').length;
      out.push({
        id: `zero_rated_no_vat_id:${p.id}`, severity: 'attention',
        title: `${xs.length} tax-free EU sales to a customer without a valid VAT ID`,
        detail: `${p.name} (${p.country ?? 'no country'}) has VAT ID "${p.vat_id}". ${xs.length - cn} invoices${cn ? ` and ${cn} credit note${cn > 1 ? 's' : ''}` : ''} were booked as tax-free intra-EU supplies, which requires a valid VAT ID. Net amount booked tax-free:`,
        next: 'Answer the VAT ID question first. Your tax advisor will ask about this before the VAT return.',
        amount: { value: net, currency: 'EUR' },
        items: [{ kind: 'partner', id: p.id }, ...xs.map((i) => ({ kind: 'invoice', id: i.id }) as TraceTarget)],
        decisionIds: (idx.decisionsByPartner.get(p.id) ?? []).map((d) => d.id),
      });
    }
  }

  if (on('domesticVatOnForeignCurrency')) {
    for (const p of idx.partners.filter((p) => !p.country)) {
      const xs = (idx.invoicesByPartner.get(p.id) ?? []).filter((i) => i.original.gross.currency !== 'EUR' && i.original.vat_rate_percent > 0);
      if (!xs.length) continue;
      out.push({
        id: `foreign_currency_with_de_vat:${p.id}`, severity: 'attention',
        title: `German VAT charged on ${xs.length} USD invoices to a customer with no country`,
        detail: `${p.name} has no country on record. ${xs.length} of their invoices are in USD and carry ${xs[0].original.vat_rate_percent} % German VAT. If they are outside Germany, these may need re-booking. VAT booked on them:`,
        next: 'Answer the country question in your decisions. If the customer is abroad, the engine says these invoices may need re-booking.',
        amount: { value: sum(xs.map((i) => toCents(i.booked.vat.amount))), currency: 'EUR' },
        items: [{ kind: 'partner', id: p.id }, ...xs.map((i) => ({ kind: 'invoice', id: i.id }) as TraceTarget)],
        decisionIds: (idx.decisionsByPartner.get(p.id) ?? []).map((d) => d.id),
      });
    }
  }

  if (on('creditNotesInOpenItems')) {
    const ms = computeMetrics(idx);
    const cn = ms.open_credit_notes_eur;
    const settled = inv.filter((i) => i.type === 'credit_note' && i.payment.status !== 'open_credit');
    if (cn.parts[0]?.count) {
      out.push({
        id: 'credit_notes_in_open_items', severity: 'attention',
        title: `Open receivables leave out ${cn.parts[0].count} open credit notes`,
        detail: `The engine's open receivables count sales invoices only. ${cn.parts[0].count} credit notes are also open${settled.length ? '' : ' (none of them has been refunded or set against an invoice yet)'}, which means you owe these customers money back. What customers owe you, net of credit notes, is lower by`,
        next: 'Check the refunds without a credit note: some of them probably settle these.',
        amount: { value: cn.value as Cents, currency: 'EUR' },
        items: [{ kind: 'metric', id: 'net_receivables_eur' }, { kind: 'metric', id: 'open_credit_notes_eur' }],
      });
    }
  }

  if (on('fxRounding')) {
    const xs = inv.filter((i) => i.fx).filter((i) => {
      const r = Number(i.fx!.rate_usd_per_eur);
      const expect = Math.round((Number(i.original.gross.amount) / r) * 100);
      return abs(BigInt(expect) - toCents(i.booked.gross.amount)) === 1n;
    });
    const weekend = inv.filter((i) => i.flags.includes('fx_rate_from_previous_business_day'));
    out.push({
      id: 'fx', severity: 'info',
      title: 'Currency conversion',
      detail: `${inv.filter((i) => i.fx).length} USD invoices were converted at the reference rate of the invoice date. ${weekend.length} fell on a day without a published rate and used the previous business day. ${xs.length ? `${xs.length} differ by one cent from a straight division, which is normal rounding.` : ''}`,
      items: [...weekend, ...xs].map((i) => ({ kind: 'invoice', id: i.id })),
    });
  }

  if (on('summaryReconciles')) {
    const ms = computeMetrics(idx);
    const compared = Object.values(ms).filter((m) => m.engineValue !== undefined);
    const bad = compared.filter((m) => agreesWithEngine(m) === false);
    out.push({
      id: 'summary_reconciles', severity: bad.length ? 'attention' : 'passed',
      title: bad.length ? `${bad.length} engine totals do not match the underlying records` : `All ${compared.length} engine totals match the underlying records`,
      detail: bad.length
        ? `We recomputed these from the individual records and got a different figure: ${bad.map((m) => m.label).join(', ')}.`
        : 'We recomputed every total the engine reports (counts, gross by currency, open items, debits and credits) from the individual records. They agree to the cent.',
      items: (bad.length ? bad : compared).map((m) => ({ kind: 'metric', id: m.id })),
    });
    const s = idx.summary.balance_check;
    out.push({
      id: 'balanced', severity: s.balanced && s.debits_eur === s.credits_eur ? 'passed' : 'attention',
      title: s.balanced ? 'The books balance' : 'The books do not balance',
      detail: 'Every invoice posting has equal debits and credits, and so does the total.',
      items: [{ kind: 'metric', id: 'debits' }, { kind: 'metric', id: 'credits' }],
    });
  }

  const order: Record<Severity, number> = { attention: 0, info: 1, passed: 2 };
  return out.sort((a, b) => order[a.severity] - order[b.severity]);
}

function sumBooked(xs: Invoice[]): Cents { return sum(xs.map((i) => toCents(i.booked.net.amount))); }

/** How rows from the old system became invoices. Every step is a number from the data. */
export function loadFunnel(idx: Indexed) {
  const c = idx.summary.counts;
  const multi = idx.invoices.filter((i) => i.history.length > 1);
  const superseded = sum(multi.map((i) => BigInt(i.history.length - 1)));
  const corrected = multi.filter((i) => {
    const h = i.history;
    return h.some((e) => e.status_in_export === 'corrected') || new Set(h.map((e) => e.gross_in_export.amount)).size > 1;
  });
  const repeats = multi.filter((i) => !corrected.includes(i));
  return {
    rowsRead: c.invoice_rows_read,
    duplicates: c.duplicate_rows_removed,
    superseded: Number(superseded),
    corrected,
    repeats,
    rejected: c.rows_rejected,
    loaded: idx.invoices.length,
    reconciles: c.invoice_rows_read - c.duplicate_rows_removed - Number(superseded) - c.rows_rejected === idx.invoices.length,
  };
}
