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
      validate: (v) => vatIdProblem(v, cc),
    };
  }
  if (d.type === 'missing_country' && optionId === 'other') {
    return {
      kind: 'text', label: 'Country (two-letter code)', placeholder: 'e.g. US, CH, AT',
      validate: (v) => {
        const c = v.trim().toUpperCase();
        if (!/^[A-Z]{2}$/.test(c)) return 'Use the two-letter country code, for example US.';
        if (c === 'DE') return 'For Germany, choose "Germany" above.';
        if (!COUNTRIES.has(c)) return `"${c}" is not a country code.`;
        return null;
      },
    };
  }
  return null;
}

/** ISO 3166-1 alpha-2 codes. */
export const COUNTRIES = new Set(('AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW').split(' '));

/** Shape of EU VAT IDs after the two-letter prefix (format only; existence needs VIES). */
const VAT_FORMAT: Record<string, RegExp> = {
  AT: /^U\d{8}$/, BE: /^[01]\d{9}$/, BG: /^\d{9,10}$/, CY: /^\d{8}[A-Z]$/, CZ: /^\d{8,10}$/, DE: /^\d{9}$/, DK: /^\d{8}$/,
  EE: /^\d{9}$/, EL: /^\d{9}$/, ES: /^[A-Z0-9]\d{7}[A-Z0-9]$/, FI: /^\d{8}$/, FR: /^[A-Z0-9]{2}\d{9}$/, HR: /^\d{11}$/,
  HU: /^\d{8}$/, IE: /^\d{7}[A-Z]{1,2}$|^\d[A-Z]\d{5}[A-Z]$/, IT: /^\d{11}$/, LT: /^(\d{9}|\d{12})$/, LU: /^\d{8}$/, LV: /^\d{11}$/,
  MT: /^\d{8}$/, NL: /^\d{9}B\d{2}$/, PL: /^\d{10}$/, PT: /^\d{9}$/, RO: /^\d{2,10}$/, SE: /^\d{12}$/, SI: /^\d{8}$/, SK: /^\d{10}$/,
};

/** Normalised (spaces removed, upper case) and checked against the country's format. Null when it looks valid. */
export function vatIdProblem(raw: string, country?: string | null): string | null {
  const s = raw.replace(/[\s.-]+/g, '').toUpperCase();
  const prefix = country === 'GR' ? 'EL' : country ?? '';
  if (!/^[A-Z]{2}/.test(s)) return 'A VAT ID starts with the two-letter country prefix, for example FR.';
  if (prefix && s.slice(0, 2) !== prefix) return `This customer is in ${country}; their VAT ID starts with ${prefix}.`;
  const fmt = VAT_FORMAT[s.slice(0, 2)];
  if (!fmt) return `${s.slice(0, 2)} is not an EU VAT prefix.`;
  if (!fmt.test(s.slice(2))) return `This does not have the format of a ${s.slice(0, 2)} VAT ID.`;
  return null;
}
