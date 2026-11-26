// A customer's version of the product is data, not code.
// customers/<id>/config.json is validated here; anything missing falls back to defaults.

export type RoleId = 'finance_lead' | 'tax_advisor' | 'owner';
export type PageId = 'arrival' | 'decisions' | 'checks' | 'books' | 'handover' | 'decisionLog' | 'overview';
export type Stake = 'tax' | 'who_owes_what' | 'money' | 'cash' | 'records' | 'trivial';

export interface RoleConfig {
  pages: PageId[];
  canDecide: boolean;
  canSignOff: boolean;
  seesPersonalData: boolean;
}

export interface DecisionGroupConfig {
  id: string;
  title: string;
  why: string;
  match: { type: string; partnerHasZeroRatedSales?: boolean };
  stake: Stake;
  groupBy?: 'description' | 'partner';
  sortBy?: 'amount_desc';
  bulkAcceptSuggestion?: boolean;
  blocksSignOff: boolean;
}

export interface CustomerConfig {
  id: string;
  company: string;
  shortName: string;
  industry: string;
  numberLocale: string;
  dateLocale: string;
  dataPath: string;
  words: Record<string, string>;
  people: Record<RoleId, { displayName: string; greeting: string; inSentence?: string }>;
  roles: Record<RoleId, RoleConfig>;
  decisionGroups: DecisionGroupConfig[];
  checks: Record<string, boolean>;
  zeroRatedAccounts: string[];
  reviewThreshold: number;
}

export const DEFAULT_WORDS: Record<string, string> = {
  customer: 'customer', customers: 'customers',
  supplier: 'supplier', suppliers: 'suppliers',
  salesInvoice: 'sales invoice', supplierInvoice: 'supplier invoice',
  creditNote: 'credit note', oldSystem: 'your old accounting system',
};

export const STAKE_ORDER: Stake[] = ['tax', 'who_owes_what', 'money', 'cash', 'records', 'trivial'];

export const STAKE_LABEL: Record<Stake, string> = {
  tax: 'Affects VAT',
  who_owes_what: 'Affects balances',
  money: 'Affects profit and loss',
  cash: 'Unexplained bank movement',
  records: 'Record correction',
  trivial: 'One cent each',
};

const ROLES: RoleId[] = ['finance_lead', 'tax_advisor', 'owner'];
const PAGES: PageId[] = ['arrival', 'decisions', 'checks', 'books', 'handover', 'decisionLog', 'overview'];

export class ConfigError extends Error {}

/** Validates a parsed config.json. Throws ConfigError with every problem listed, not just the first. */
export function parseConfig(raw: unknown): CustomerConfig {
  const problems: string[] = [];
  const c = (raw ?? {}) as Record<string, any>;
  const req = (k: string) => { if (typeof c[k] !== 'string' || !c[k]) problems.push(`"${k}" is required`); };
  ['id', 'company'].forEach(req);

  const roles = c.roles ?? {};
  for (const r of ROLES) {
    const rc = roles[r];
    if (!rc) { problems.push(`roles.${r} is missing`); continue; }
    for (const p of rc.pages ?? []) if (!PAGES.includes(p)) problems.push(`roles.${r}.pages: unknown page "${p}"`);
  }
  const groups: any[] = Array.isArray(c.decisionGroups) ? c.decisionGroups : [];
  if (!groups.length) problems.push('decisionGroups must list at least one group');
  const ids = new Set<string>();
  for (const g of groups) {
    if (!g.id) problems.push('a decision group has no id');
    if (ids.has(g.id)) problems.push(`decision group "${g.id}" appears twice`);
    ids.add(g.id);
    if (!g.match?.type) problems.push(`decision group "${g.id}" has no match.type`);
    if (!STAKE_ORDER.includes(g.stake)) problems.push(`decision group "${g.id}": unknown stake "${g.stake}"`);
  }
  if (problems.length) throw new ConfigError(`Customer config is invalid:\n- ${problems.join('\n- ')}`);

  return {
    id: c.id,
    company: c.company,
    shortName: c.shortName ?? c.company,
    industry: c.industry ?? '',
    numberLocale: c.numberLocale ?? 'de-DE',
    dateLocale: c.dateLocale ?? c.numberLocale ?? 'de-DE',
    dataPath: c.dataPath ?? 'engine-output',
    words: { ...DEFAULT_WORDS, ...(c.words ?? {}) },
    people: c.people,
    roles: c.roles,
    decisionGroups: groups,
    checks: c.checks ?? {},
    zeroRatedAccounts: c.zeroRatedAccounts ?? [],
    reviewThreshold: typeof c.reviewThreshold === 'number' ? c.reviewThreshold : 0.8,
  };
}

/** How a role is named mid-sentence: "your tax advisor", "the finance lead". */
export function who(cfg: CustomerConfig, role: RoleId): string {
  const p = cfg.people[role];
  return p.inSentence ?? p.displayName.charAt(0).toLowerCase() + p.displayName.slice(1);
}
