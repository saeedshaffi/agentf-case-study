import { invoiceOf, previewEffect, type Answers } from './decisions';
import { sum, toCents, type Cents } from './money';
import type { Indexed } from './types';

export interface LedgerRow {
  account: string;
  name: string;
  type: string;
  debit: Cents;
  credit: Cents;
  balance: Cents;
  /** Balance after the finance lead's answers that we can compute exactly. */
  balanceAfter: Cents;
  invoiceIds: string[];
}

/** Trial balance over all invoice postings, plus the effect of answered decisions. */
export function trialBalance(idx: Indexed, answers: Answers): LedgerRow[] {
  const rows = new Map<string, LedgerRow>();
  const row = (acc: string) => {
    let r = rows.get(acc);
    if (!r) {
      const a = idx.accountById.get(acc);
      r = { account: acc, name: a?.name ?? 'Unknown account', type: a?.type ?? '?', debit: 0n, credit: 0n, balance: 0n, balanceAfter: 0n, invoiceIds: [] };
      rows.set(acc, r);
    }
    return r;
  };
  for (const inv of idx.invoices) {
    for (const p of inv.postings) {
      const r = row(p.account);
      r.debit += toCents(p.debit);
      r.credit += toCents(p.credit);
      if (r.invoiceIds[r.invoiceIds.length - 1] !== inv.id) r.invoiceIds.push(inv.id);
    }
  }
  for (const r of rows.values()) { r.balance = r.debit - r.credit; r.balanceAfter = r.balance; }
  for (const [decisionId, a] of Object.entries(answers)) {
    const d = idx.decisionById.get(decisionId);
    if (!d) continue;
    for (const line of previewEffect(d, a.optionId, idx).lines) row(line.account).balanceAfter += line.delta;
  }
  return [...rows.values()].sort((a, b) => a.account.localeCompare(b.account));
}

/** Postings of an invoice after the answers, for the trace panel. */
export function postingsAfter(invoiceId: string, idx: Indexed, answers: Answers) {
  const inv = idx.invoiceById.get(invoiceId);
  if (!inv) return [];
  const moved = (inv.decision_ids ?? [])
    .map((id) => idx.decisionById.get(id))
    .filter((d) => d && answers[d.id] && invoiceOf(d, idx)?.id === invoiceId)
    .flatMap((d) => previewEffect(d!, answers[d!.id].optionId, idx).lines);
  if (!moved.length) return inv.postings;
  const from = moved.find((l) => l.delta < 0n)?.account;
  const to = moved.find((l) => l.delta > 0n)?.account;
  return inv.postings.map((p) => (p.account === from && to ? { ...p, account: to } : p));
}

export function totalOf(rows: LedgerRow[], k: 'debit' | 'credit'): Cents { return sum(rows.map((r) => r[k])); }
