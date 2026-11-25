// Shapes of the engine's API responses (engine-output/*.json).
// Only fields the front end relies on are typed; everything else passes through.

export interface Money { amount: string; currency: string }

export interface SourceRef { file: string; row?: number; id?: string; load: string }

export interface Load {
  id: string;
  kind: 'initial_export' | 'delta_export' | 'bank_statement' | string;
  file: string;
  started_at: string;
  finished_at: string;
  status: 'succeeded' | 'failed' | 'running' | string;
  failed_step?: string;
  error?: string;
  rows_processed_before_failure?: number;
  retry_of?: string;
}

export interface Summary {
  customer: {
    name: string;
    chart_of_accounts: string;
    base_currency: string;
    migration_started: string;
    users: { name: string; role: string; can_see: string }[];
  };
  loads: Load[];
  counts: Record<string, number | Record<string, number>> & {
    invoice_rows_read: number;
    duplicate_rows_removed: number;
    invoices_loaded: number;
    invoices_corrected_in_later_export: number;
    partners_loaded: number;
    bank_transactions_loaded: number;
    bank_transactions_matched: number;
    rows_rejected: number;
    open_decisions: number;
    open_decisions_by_type: Record<string, number>;
  };
  totals_by_currency_original: Record<string, string>;
  balance_check: { debits_eur: string; credits_eur: string; balanced: boolean };
  open_items_eur_only: { receivables: string; payables: string; note?: string };
}

export interface Posting { account: string; debit: string; credit: string }

export interface HistoryEntry {
  load: string; file: string; row: number;
  status_in_export: string; gross_in_export: Money;
}

export interface Invoice {
  id: string;
  direction: 'receivable' | 'payable';
  type: 'invoice' | 'credit_note';
  partner_id: string;
  partner_name: string;
  date: string;
  due_date: string;
  description: string;
  original: { net: Money; vat_rate_percent: number; vat: Money; gross: Money };
  booked: { net: Money; vat: Money; gross: Money };
  fx?: { rate_usd_per_eur: string; rate_date: string; rule: string };
  flags: string[];
  decision_ids: string[];
  source: SourceRef;
  history: HistoryEntry[];
  classification: {
    account: string; account_name: string;
    decided_by: 'rule' | 'model' | 'fuzzy_reference' | 'person';
    confidence: number; rule?: string; model_input?: string; needs_review?: boolean;
  };
  postings: Posting[];
  payment: { status: string; paid: Money; open: Money };
}

export interface BankTransaction {
  id: string;
  booking_date: string;
  value_date: string;
  amount: Money;
  currency: string;
  counterparty_name: string;
  counterparty_iban: string;
  reference: string;
  source: SourceRef;
  match: null | {
    invoices: string[]; kind: string; decided_by: string; confidence: number; account?: string;
  };
  decision_ids?: string[];
}

export interface DecisionOption { id: string; label: string; effect: string }

export type DecisionRef =
  | { invoice: string; file?: string; row?: number }
  | { transaction: string }
  | { partner: string };

export interface Decision {
  id: string;
  type: string;
  status: 'open' | string;
  title: string;
  question: string;
  options: DecisionOption[];
  suggested_option: string | null;
  amount_affected: Money | null;
  references: DecisionRef[];
  confidence?: number;
  why_suggested?: string;
}

export interface Partner {
  id: string;
  type: 'customer' | 'supplier';
  name: string;
  country: string | null;
  vat_id: string;
  iban: string;
  email: string;
  contact_person: string;
  city: string;
  flags: string[];
  source: SourceRef;
}

export interface Account { account: string; name: string; type: string }

export interface EngineData {
  summary: Summary;
  invoices: Invoice[];
  bank: BankTransaction[];
  decisions: Decision[];
  partners: Partner[];
  accounts: Account[];
}

/** Indexed view over EngineData, built once. */
export interface Indexed extends EngineData {
  invoiceById: Map<string, Invoice>;
  txById: Map<string, BankTransaction>;
  partnerById: Map<string, Partner>;
  decisionById: Map<string, Decision>;
  accountById: Map<string, Account>;
  loadById: Map<string, Load>;
  txByInvoice: Map<string, BankTransaction[]>;
  decisionsByInvoice: Map<string, Decision[]>;
  decisionsByPartner: Map<string, Decision[]>;
  invoicesByPartner: Map<string, Invoice[]>;
}
