import type { CustomerConfig } from './config';
import { isSettled, moneyOf, type Answers } from './decisions';
import { agreesWithEngine, computeMetrics, type TraceTarget } from './metrics';
import { abs, sum, toCents, type Cents } from './money';
import type { Indexed, Invoice } from './types';

// Checks the front end runs over the engine's output. They never change a number.
// Two kinds:
//  - verifications: something we recomputed and confirmed (or could not confirm);
//  - findings: something in the result a person should know about before signing off.

export type CheckKind = 'verification' | 'finding';

/**
 * Status of a check for this customer, right now.
 *  passed       – a verification that holds
 *  failed       – a verification that does not hold
 *  open         – a finding nobody has dealt with
 *  acknowledged – read and accepted as an open item; the underlying problem is NOT fixed
 *  resolved     – the questions that settle it have been answered
 *  info         – context only; nothing to do
 */
export type CheckStatus = 'passed' | 'failed' | 'open' | 'acknowledged' | 'resolved' | 'info';

export interface Finding {
  id: string;
  kind: CheckKind;
  /** Only findings with this set must be resolved or acknowledged before sign-off. */
  needsAttention: boolean;
  title: string;
  /** What is wrong, in one or two sentences. */
  detail: string;
  /** Why it matters to this person. */
  why?: string;
  /** The single next step. */
  next?: string;
  amount?: { value: Cents; currency: string; label: string };
  affected?: { count: number; noun: string };
  items: TraceTarget[];
  /** Questions whose settled answers resolve this finding. */
  decisionIds?: string[];
  /** Decision group to open from this finding. */
  groupId?: string;
  /** Extra condition on the answers: settling the question is not always the same as fixing the problem. */
  resolved?: (answers: Answers) => boolean;
  /** Shown when the questions are settled but the problem is not fixed. */
  followUp?: string;
}

export interface Acknowledgement { at: string; by: string }

export function checkStatus(f: Finding, answers: Answers, acks: Record<string, Acknowledgement | string> | undefined): CheckStatus {
  if (f.kind === 'verification') return f.needsAttention ? 'failed' : 'passed';
  if (!f.needsAttention) return 'info';
  if (f.decisionIds?.length && f.decisionIds.every((id) => isSettled(answers[id])) && (f.resolved ? f.resolved(answers) : true)) return 'resolved';
  if (acks?.[f.id]) return 'acknowledged';
  return 'open';
}

/** A finding can be carried as an open item when no question settles it, or its questions are settled and it still stands. */
export function canAcknowledge(f: Finding, answers: Answers): boolean {
  return !f.decisionIds?.length || f.decisionIds.every((id) => isSettled(answers[id]));
}

/** Findings that still stand between the finance lead and sign-off. */
export function blockingFindings(fs: Finding[], answers: Answers, acks: Record<string, Acknowledgement | string> | undefined) {
  return fs.filter((f) => ['open', 'failed'].includes(checkStatus(f, answers, acks)));
}

export function runChecks(idx: Indexed, cfg: CustomerConfig): Finding[] {
  const on = (k: string) => cfg.checks[k] !== false;
  const out: Finding[] = [];
  const inv = idx.invoices;
  const groupOf = (type: string) => cfg.decisionGroups.find((g) => g.match.type === type)?.id;

  // --- Verifications -------------------------------------------------------------------------
  if (on('summaryReconciles')) {
    const ms = computeMetrics(idx);
    const compared = Object.values(ms).filter((m) => m.engineValue !== undefined);
    const bad = compared.filter((m) => agreesWithEngine(m) === false);
    out.push({
      id: 'summary_reconciles', kind: 'verification', needsAttention: bad.length > 0,
      title: bad.length ? `${bad.length} engine totals differ from the records` : `${compared.length} engine totals match the records`,
      detail: bad.length
        ? `Recomputed from the individual records, these come out differently: ${bad.map((m) => m.label).join(', ')}.`
        : 'Counts, gross amounts per currency, open items, and journal debits and credits were recomputed from the individual records. Each agrees to the cent with the engine.',
      items: (bad.length ? bad : compared).map((m) => ({ kind: 'metric', id: m.id })),
    });
    const s = idx.summary.balance_check;
    const eachBalances = inv.every((i) => sum(i.postings.map((p) => toCents(p.debit))) === sum(i.postings.map((p) => toCents(p.credit))));
    const ok = eachBalances && s.balanced && s.debits_eur === s.credits_eur && agreesWithEngine(ms.debits) !== false && agreesWithEngine(ms.credits) !== false;
    out.push({
      id: 'balanced', kind: 'verification', needsAttention: !ok,
      title: ok ? 'Journal debits equal credits' : 'Journal debits and credits differ',
      detail: 'Every invoice was booked with equal debits and credits, and the totals agree. This covers invoice bookings; bank payments are matched to invoices, not booked, in this export.',
      items: [{ kind: 'metric', id: 'debits' }, { kind: 'metric', id: 'credits' }],
    });
    const f = loadFunnel(idx);
    out.push({
      id: 'rows_accounted', kind: 'verification', needsAttention: !f.reconciles,
      title: f.reconciles ? `All ${f.rowsRead.toLocaleString(cfg.numberLocale)} export rows are accounted for` : 'Some export rows are not accounted for',
      detail: `${f.rowsRead.toLocaleString(cfg.numberLocale)} rows read, ${f.duplicates} exact duplicates removed, ${f.superseded} replaced by a later version, ${f.rejected} rejected: ${f.loaded.toLocaleString(cfg.numberLocale)} invoices.`,
      items: [{ kind: 'metric', id: 'invoices_loaded' }],
    });
  }

  // --- Findings that need the finance lead ---------------------------------------------------
  if (on('zeroRatedWithoutValidVatId')) {
    for (const p of idx.partners.filter((p) => p.flags.includes('malformed_vat_id'))) {
      const xs = (idx.invoicesByPartner.get(p.id) ?? []).filter(
        (i) => i.direction === 'receivable' && cfg.zeroRatedAccounts.includes(i.classification.account),
      );
      if (!xs.length) continue;
      const cn = xs.filter((i) => i.type === 'credit_note').length;
      out.push({
        id: `zero_rated_no_vat_id:${p.id}`, kind: 'finding', needsAttention: true,
        title: `Tax-free EU sales to ${p.name}, whose VAT ID is "${p.vat_id}"`,
        detail: `${xs.length - cn} invoices${cn ? ` and ${cn} credit note` : ''} to this ${p.country ?? ''} customer were booked as tax-free intra-EU supplies. The engine's own rule for that requires a valid VAT ID.`,
        why: 'Without a valid VAT ID these sales may be taxable in Germany. Your tax advisor will check this before the first VAT return.',
        next: 'Enter the customer\'s VAT ID in the decision for this customer.',
        amount: { value: sumNet(xs), currency: 'EUR', label: 'net booked tax-free' },
        affected: { count: xs.length, noun: cn ? 'invoices and credit notes' : 'invoices' },
        items: [{ kind: 'partner', id: p.id }, ...xs.map((i) => ({ kind: 'invoice', id: i.id }) as TraceTarget)],
        decisionIds: (idx.decisionsByPartner.get(p.id) ?? []).map((d) => d.id),
        groupId: cfg.decisionGroups.find((g) => g.match.type === 'malformed_vat_id' && g.match.partnerHasZeroRatedSales)?.id,
        // This prototype checks the format only. Until the ID is verified, the finding is not resolved.
        resolved: () => false,
        followUp: 'The VAT ID you entered has the right format, but it has not been verified with the EU VIES service: this prototype does not call it. Acknowledge this to carry the verification as an open item for your tax advisor.',
      });
    }
  }

  if (on('domesticVatOnForeignCurrency')) {
    for (const p of idx.partners.filter((p) => !p.country)) {
      const xs = (idx.invoicesByPartner.get(p.id) ?? []).filter((i) => i.original.gross.currency !== 'EUR' && i.original.vat_rate_percent > 0);
      if (!xs.length) continue;
      out.push({
        id: `foreign_currency_with_de_vat:${p.id}`, kind: 'finding', needsAttention: true,
        title: `German VAT on ${xs.length} USD invoices to ${p.name}, who has no country`,
        detail: `${xs.length} of this customer's invoices are in US dollars and carry ${xs[0].original.vat_rate_percent} % German VAT. The customer record has no country.`,
        why: 'If the customer is outside Germany, German VAT may not apply to these invoices.',
        next: 'Set the customer\'s country in the decision for this customer.',
        amount: { value: sum(xs.map((i) => toCents(i.booked.vat.amount))), currency: 'EUR', label: 'German VAT booked' },
        affected: { count: xs.length, noun: 'invoices' },
        items: [{ kind: 'partner', id: p.id }, ...xs.map((i) => ({ kind: 'invoice', id: i.id }) as TraceTarget)],
        decisionIds: (idx.decisionsByPartner.get(p.id) ?? []).map((d) => d.id),
        groupId: groupOf('missing_country'),
        // Answering "another country" settles the question but not the VAT: the invoices may need re-booking.
        resolved: (a) => (idx.decisionsByPartner.get(p.id) ?? []).every((d) => a[d.id]?.optionId !== 'other'),
        followUp: 'You answered that this customer is outside Germany. The engine says these invoices may need re-booking, and that has not happened here. Acknowledge it to carry it as an open item for your tax advisor.',
      });
    }
  }

  if (on('inconsistentSuggestions')) {
    const byInput = new Map<string, { accounts: Set<string>; ids: string[]; decs: string[] }>();
    for (const d of idx.decisions.filter((d) => d.type === 'uncertain_classification' && d.suggested_option)) {
      const ref = d.references.find((r) => 'invoice' in r) as { invoice: string } | undefined;
      const i = ref && idx.invoiceById.get(ref.invoice);
      if (!i) continue;
      const k = `${i.partner_id}|${i.description}`;
      const e = byInput.get(k) ?? byInput.set(k, { accounts: new Set(), ids: [], decs: [] }).get(k)!;
      e.accounts.add(d.suggested_option!); e.ids.push(i.id); e.decs.push(d.id);
    }
    const bad = [...byInput.values()].filter((v) => v.accounts.size > 1);
    if (bad.length) {
      const n = bad.reduce((t, v) => t + v.ids.length, 0);
      out.push({
        id: 'inconsistent_suggestions', kind: 'finding', needsAttention: true,
        title: 'The model suggested different accounts for identical inputs',
        detail: `The model sees only an invoice's description and the supplier category. For ${bad.length} of ${byInput.size} supplier-and-description pairs it still suggested more than one account. ${n} invoices are affected and are booked on those suggestions until you decide.`,
        why: 'Accepting the suggestions one by one would book the same kind of cost from the same supplier to different lines of your profit and loss.',
        next: 'Decide once per description which account it is, and book them together.',
        affected: { count: n, noun: 'invoices' },
        items: bad.flatMap((v) => v.ids.map((id) => ({ kind: 'invoice', id }) as TraceTarget)),
        decisionIds: bad.flatMap((v) => v.decs),
        groupId: groupOf('uncertain_classification'),
        // Resolved only when identical inputs end up on one account.
        resolved: (a) => bad.every((v) => new Set(v.decs.map((id) => a[id]?.optionId)).size === 1),
        followUp: 'Invoices with the same supplier and description are still booked to different accounts. Book them the same way, or acknowledge the difference as an open item.',
      });
    }
  }

  if (on('overpaidWithoutDecision')) {
    const overpaid = inv.filter((i) => i.payment.status === 'overpaid');
    const xs = overpaid.filter((i) => {
      const txs = idx.txByInvoice.get(i.id) ?? [];
      return !i.decision_ids.length && !txs.some((t) => t.decision_ids?.length);
    });
    if (xs.length) {
      const extra = sum(xs.map((i) => toCents(i.payment.paid.amount) - toCents(i.original.gross.amount)));
      const corrected = xs.filter((i) => i.history.length > 1 && toCents(i.history[0].gross_in_export.amount) === toCents(i.payment.paid.amount));
      out.push({
        id: 'overpaid_without_decision', kind: 'finding', needsAttention: true,
        title: `${xs.length} invoices were lowered after the customer had paid them`,
        detail: corrected.length === xs.length
          ? `Each customer paid the first version of the invoice in full. A later export corrected the invoice to a lower amount, so the books now show more paid than owed. The engine raised no question for these, unlike the other ${overpaid.length - xs.length} overpayments.`
          : `These invoices show more paid than owed, and the engine raised no question for them, unlike the other ${overpaid.length - xs.length} overpayments.`,
        why: 'The difference is money these customers are owed back, or a credit against their next invoice.',
        next: 'Decide with each customer whether to refund the difference or keep it as credit. There is no question in the product for this yet.',
        amount: { value: extra, currency: 'EUR', label: 'paid above the corrected invoices' },
        affected: { count: xs.length, noun: 'invoices' },
        items: xs.map((i) => ({ kind: 'invoice', id: i.id })),
      });
    }
  }

  if (on('creditNotesInOpenItems')) {
    const ms = computeMetrics(idx);
    const cn = ms.open_credit_notes_eur;
    const settled = inv.filter((i) => i.type === 'credit_note' && i.payment.status !== 'open_credit');
    if (cn.parts[0]?.count) {
      out.push({
        id: 'credit_notes_in_open_items', kind: 'finding', needsAttention: true,
        title: `Open receivables leave out ${cn.parts[0].count} open credit notes`,
        detail: `The engine's open receivables count sales invoices only. ${cn.parts[0].count} credit notes are open as well${settled.length ? '' : '; none has been refunded or set against an invoice'}. That is money you owe these customers.`,
        why: 'What customers owe you, net of credit notes, is lower than the open receivables figure suggests.',
        next: 'Use the net figure when you report what customers owe. Settling the credit notes happens after the migration.',
        amount: { value: cn.value as Cents, currency: 'EUR', label: 'owed back on credit notes' },
        affected: { count: cn.parts[0].count, noun: 'credit notes' },
        items: [{ kind: 'metric', id: 'net_receivables_eur' }, { kind: 'metric', id: 'open_credit_notes_eur' }],
      });
    }
  }

  // --- Context only --------------------------------------------------------------------------
  const mislabelled = idx.decisions.filter((d) => moneyOf(d, idx)?.mismatch);
  if (mislabelled.length) {
    out.push({
      id: 'decision_currency', kind: 'finding', needsAttention: false,
      title: `${mislabelled.length} questions carry the wrong currency in the engine's data`,
      detail: `The engine labels these amounts EUR, but the records they refer to are in ${[...new Set(mislabelled.map((d) => moneyOf(d, idx)!.currency))].join(', ')}. They are shown in the records' currency and are never added to euro totals.`,
      items: mislabelled.map((d) => ({ kind: 'decision', id: d.id })),
    });
  }

  if (on('fxRounding')) {
    const fx = inv.filter((i) => i.fx);
    const oneCent = fx.filter((i) => abs(convertCents(i) - toCents(i.booked.gross.amount)) === 1n);
    const weekend = inv.filter((i) => i.flags.includes('fx_rate_from_previous_business_day'));
    const ids = [...new Set([...weekend, ...oneCent].map((i) => i.id))];
    out.push({
      id: 'fx', kind: 'finding', needsAttention: false,
      title: `${fx.length} USD invoices converted to euros`,
      detail: `Each used the reference rate of its invoice date. ${weekend.length} fell on a day without a published rate and used the previous business day's rate.${oneCent.length ? ` ${oneCent.length} differ by one cent from a straight division, from rounding.` : ''}`,
      items: ids.map((id) => ({ kind: 'invoice', id })),
    });
  }

  const order = (f: Finding) => (f.kind === 'finding' && f.needsAttention ? 0 : f.kind === 'verification' ? 1 : 2);
  return out.sort((a, b) => order(a) - order(b));
}

/** Exact conversion gross / rate, rounded half-up to cents, without floating point. */
function convertCents(i: Invoice): bigint {
  const [w, f = ''] = i.fx!.rate_usd_per_eur.split('.');
  const scale = 10n ** BigInt(f.length);
  const rate = BigInt(w + f);
  const gross = toCents(i.original.gross.amount);
  return (gross * scale * 2n + rate) / (2n * rate);
}

function sumNet(xs: Invoice[]): Cents { return sum(xs.map((i) => toCents(i.booked.net.amount))); }

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
