import { abs, toCents } from './money';
import type { Decision, Indexed } from './types';

// Some answers need one more piece of information: which credit note, which invoice, which VAT ID.
// The engine's options say *what* to do; this says what to ask for, and offers the likeliest candidates first.

export type ValueSpec =
  | { kind: 'select'; label: string; options: { value: string; label: string; hint?: string }[]; empty: string }
  | { kind: 'text'; label: string; placeholder: string; validate: (v: string) => string | null };

const norm = (s: string) => s.toLowerCase().replace(/[^a-zäöüß0-9]/g, '');

export function valueSpecFor(d: Decision, optionId: string, idx: Indexed): ValueSpec | null {
  const txRef = d.references.find((r) => 'transaction' in r) as { transaction: string } | undefined;
  const tx = txRef ? idx.txById.get(txRef.transaction) : undefined;
  const partnerRef = d.references.find((r) => 'partner' in r) as { partner: string } | undefined;
  const partner = partnerRef ? idx.partnerById.get(partnerRef.partner) : undefined;

  if (d.type === 'unexplained_refund' && optionId === 'pick_credit_note' && tx) {
    const amt = abs(toCents(tx.amount.amount));
    const cands = idx.invoices
      .filter((i) => i.type === 'credit_note' && i.payment.status === 'open_credit')
      .map((i) => ({ i, same: norm(i.partner_name) === norm(tx.counterparty_name), diff: abs(toCents(i.payment.open.amount) - amt) }))
      .sort((a, b) => Number(b.same) - Number(a.same) || (a.diff < b.diff ? -1 : a.diff > b.diff ? 1 : 0))
      .slice(0, 15);
    return {
      kind: 'select', label: 'Which credit note?',
      empty: 'No open credit notes to choose from.',
      options: cands.map(({ i, same, diff }) => ({
        value: i.id,
        label: `${i.id} · ${i.partner_name} · ${i.payment.open.amount} ${i.payment.open.currency}`,
        hint: [same ? 'same customer' : null, diff === 0n ? 'same amount' : null].filter(Boolean).join(', ') || undefined,
      })),
    };
  }
  if (d.type === 'unmatched_receipt' && optionId === 'assign_invoice' && tx) {
    const amt = abs(toCents(tx.amount.amount));
    const cands = idx.invoices
      .filter((i) => i.direction === 'receivable' && i.type === 'invoice' && toCents(i.payment.open.amount) > 0n && i.payment.open.currency === tx.currency)
      .map((i) => ({ i, same: norm(i.partner_name).startsWith(norm(tx.counterparty_name).slice(0, 8)), diff: abs(toCents(i.payment.open.amount) - amt) }))
      .sort((a, b) => Number(b.same) - Number(a.same) || (a.diff < b.diff ? -1 : a.diff > b.diff ? 1 : 0))
      .slice(0, 15);
    return {
      kind: 'select', label: 'Which invoice did they pay?',
      empty: 'No open invoices in this currency.',
      options: cands.map(({ i, same, diff }) => ({
        value: i.id,
        label: `${i.id} · ${i.partner_name} · open ${i.payment.open.amount} ${i.payment.open.currency}`,
        hint: [same ? 'similar name' : null, diff === 0n ? 'same amount' : null].filter(Boolean).join(', ') || undefined,
      })),
    };
  }
  if (d.type === 'malformed_vat_id' && optionId === 'enter') {
    const cc = partner?.country ?? '';
    return {
      kind: 'text', label: 'Correct VAT ID', placeholder: cc ? `${cc === 'GR' ? 'EL' : cc}…` : 'e.g. FR12345678901',
      validate: (v) => {
        const s = v.replace(/\s+/g, '').toUpperCase();
        if (!/^[A-Z]{2}[A-Z0-9]{2,12}$/.test(s)) return 'A VAT ID starts with two letters for the country, followed by 2 to 12 letters or digits.';
        if (cc && s.slice(0, 2) !== (cc === 'GR' ? 'EL' : cc)) return `This customer is in ${cc}; their VAT ID should start with ${cc}.`;
        return null;
      },
    };
  }
  if (d.type === 'missing_country' && optionId === 'other') {
    return {
      kind: 'text', label: 'Country (two-letter code)', placeholder: 'e.g. US, CH, AT',
      validate: (v) => (/^[A-Za-z]{2}$/.test(v.trim()) ? (v.trim().toUpperCase() === 'DE' ? 'For Germany, choose "Germany" above.' : null) : 'Use the two-letter country code, e.g. US.'),
    };
  }
  return null;
}
