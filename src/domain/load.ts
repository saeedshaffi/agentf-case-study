import { parseConfig, type CustomerConfig } from './config';
import type { EngineData, Indexed } from './types';

// Each engine-output file is one API endpoint. We fetch them independently so that
// one slow or failing endpoint never blanks the whole screen.
export const ENDPOINTS = ['summary', 'invoices', 'bank_transactions', 'decisions', 'partners', 'accounts'] as const;
export type Endpoint = (typeof ENDPOINTS)[number];

export type EndpointState =
  | { status: 'loading' }
  | { status: 'ready'; data: unknown }
  | { status: 'error'; message: string };

export async function fetchConfig(customerId: string): Promise<CustomerConfig> {
  const res = await fetch(`${import.meta.env.BASE_URL}${encodeURIComponent(customerId)}/config.json`);
  if (!res.ok) throw new Error(`No configuration found for customer "${customerId}" (HTTP ${res.status}).`);
  return parseConfig(await res.json());
}

export async function fetchEndpoint(cfg: CustomerConfig, ep: Endpoint, delayMs = 0): Promise<unknown> {
  if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
  const res = await fetch(`${import.meta.env.BASE_URL}${encodeURIComponent(cfg.id)}/${cfg.dataPath}/${ep}.json`);
  if (!res.ok) throw new Error(`${ep}: HTTP ${res.status}`);
  try {
    return await res.json();
  } catch {
    throw new Error(`${ep}: the response is not valid JSON`);
  }
}

export function buildIndex(d: EngineData): Indexed {
  const by = <T, K>(xs: T[], k: (x: T) => K) => new Map(xs.map((x) => [k(x), x] as const));
  const multi = <T>(pairs: [string, T][]) => {
    const m = new Map<string, T[]>();
    for (const [k, v] of pairs) (m.get(k) ?? m.set(k, []).get(k)!).push(v);
    return m;
  };
  return {
    ...d,
    invoiceById: by(d.invoices, (x) => x.id),
    txById: by(d.bank, (x) => x.id),
    partnerById: by(d.partners, (x) => x.id),
    decisionById: by(d.decisions, (x) => x.id),
    accountById: by(d.accounts, (x) => x.account),
    loadById: by(d.summary.loads, (x) => x.id),
    txByInvoice: multi(d.bank.flatMap((t) => (t.match?.invoices ?? []).map((i) => [i, t] as [string, typeof t]))),
    decisionsByInvoice: multi(
      d.decisions.flatMap((dec) =>
        dec.references.flatMap((r) => ('invoice' in r ? [[r.invoice, dec] as [string, typeof dec]] : [])),
      ),
    ),
    decisionsByPartner: multi(
      d.decisions.flatMap((dec) =>
        dec.references.flatMap((r) => ('partner' in r ? [[r.partner, dec] as [string, typeof dec]] : [])),
      ),
    ),
    invoicesByPartner: multi(d.invoices.map((i) => [i.partner_id, i] as [string, typeof i])),
  };
}
