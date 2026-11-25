import type { ReactNode } from 'react';
import type { Endpoint } from '../domain/load';
import type { TraceTarget } from '../domain/metrics';
import { formatCount, formatMoney, type Cents } from '../domain/money';
import { maskEmail, maskIban, maskName } from '../domain/privacy';
import { useApp } from './state';

/** A money amount. Pass `trace` and it becomes a button that opens where it came from. */
export function Amount({ value, currency, trace, signed, label }: {
  value: Cents; currency: string; trace?: TraceTarget; signed?: boolean; label?: string;
}) {
  const { cfg, openTrace } = useApp();
  const text = formatMoney(value, currency, cfg.numberLocale, { signed });
  if (!trace) return <span className="num">{text}</span>;
  return (
    <button className="trace" onClick={() => openTrace(trace)} aria-label={`${label ?? text}: show where this comes from`} title="Show where this comes from">
      {text}
    </button>
  );
}

export function Count({ n, trace, label }: { n: number; trace?: TraceTarget; label?: string }) {
  const { cfg, openTrace } = useApp();
  const text = formatCount(n, cfg.numberLocale);
  if (!trace) return <span className="num">{text}</span>;
  return (
    <button className="trace" onClick={() => openTrace(trace)} aria-label={`${label ?? text}: show where this comes from`} title="Show where this comes from">
      {text}
    </button>
  );
}

/** A record id that opens in the trace panel. */
export function Ref({ target, children }: { target: TraceTarget; children?: ReactNode }) {
  const { openTrace } = useApp();
  return (
    <button className="link mono" onClick={() => openTrace(target)}>{children ?? target.id}</button>
  );
}

/** Personal data, masked unless the current role may see it. */
export function Personal({ kind, value }: { kind: 'iban' | 'email' | 'name'; value: string }) {
  const { cfg, role } = useApp();
  if (cfg.roles[role].seesPersonalData) return <span className={kind === 'iban' ? 'mono' : undefined}>{value || '—'}</span>;
  const masked = kind === 'iban' ? maskIban(value) : kind === 'email' ? maskEmail(value) : maskName(value);
  return <span className={kind === 'iban' ? 'mono' : undefined} title="Hidden for your role">{masked}</span>;
}

export function DateText({ iso, time }: { iso: string; time?: boolean }) {
  const { cfg } = useApp();
  const d = new Date(iso);
  if (isNaN(+d)) return <span>{iso}</span>;
  const opts: Intl.DateTimeFormatOptions = time
    ? { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }
    : { day: '2-digit', month: 'short', year: 'numeric' };
  return <time dateTime={iso}>{new Intl.DateTimeFormat(cfg.dateLocale, opts).format(d)}</time>;
}

export function Badge({ tone, children }: { tone: 'good' | 'warn' | 'bad' | 'info' | 'neutral' | 'accent'; children: ReactNode }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

export function Callout({ tone, title, children, icon }: { tone: 'attention' | 'bad' | 'info' | 'good'; title?: ReactNode; children?: ReactNode; icon?: string }) {
  const sym = icon ?? (tone === 'good' ? '✓' : tone === 'info' ? 'i' : '!');
  return (
    <div className={`callout ${tone}`} role={tone === 'bad' ? 'alert' : undefined}>
      <span className="icon" aria-hidden>{sym}</span>
      <div className="stack-sm">
        {title && <strong>{title}</strong>}
        {children}
      </div>
    </div>
  );
}

export function PageHead({ title, children, aside }: { title: string; children?: ReactNode; aside?: ReactNode }) {
  return (
    <header className="page-head spread">
      <div>
        <h1>{title}</h1>
        {children && <p>{children}</p>}
      </div>
      {aside}
    </header>
  );
}

const ENDPOINT_LABEL: Record<Endpoint, string> = {
  summary: 'Migration summary', invoices: 'Invoices', bank_transactions: 'Bank transactions',
  decisions: 'Open questions', partners: 'Customers and suppliers', accounts: 'Chart of accounts',
};

/**
 * Renders children only when the endpoints they need are loaded.
 * While loading: a skeleton naming what is being loaded. On error: what failed and a retry.
 * Never a partial total.
 */
export function Needs({ eps, children }: { eps: Endpoint[]; children: () => ReactNode }) {
  const { data } = useApp();
  const failed = eps.filter((e) => data.endpoints[e].status === 'error');
  const loading = eps.filter((e) => data.endpoints[e].status === 'loading');
  if (failed.length) {
    return (
      <Callout tone="bad" title="Part of your data did not load">
        <p>
          {failed.map((e) => ENDPOINT_LABEL[e]).join(', ')} could not be loaded
          ({failed.map((e) => (data.endpoints[e] as { message: string }).message).join('; ')}).
          Nothing has changed in your books. Numbers that depend on this are not shown, rather than shown incomplete.
        </p>
        <div className="row">
          {failed.map((e) => <button key={e} className="btn small" onClick={() => data.retry(e)}>Retry {ENDPOINT_LABEL[e].toLowerCase()}</button>)}
        </div>
      </Callout>
    );
  }
  if (loading.length || !data.idx && eps.some((e) => e !== 'summary')) {
    return (
      <div className="card stack-sm" aria-busy="true" aria-live="polite">
        <p className="muted small">Loading {loading.map((e) => ENDPOINT_LABEL[e].toLowerCase()).join(', ') || 'your books'}…</p>
        <div className="skeleton" style={{ width: '60%' }} />
        <div className="skeleton" style={{ width: '85%' }} />
        <div className="skeleton" style={{ width: '40%' }} />
      </div>
    );
  }
  return <>{children()}</>;
}

export function Stat({ label, children, foot }: { label: string; children: ReactNode; foot?: ReactNode }) {
  return (
    <div className="card tight stat">
      <div className="label">{label}</div>
      <div className="value">{children}</div>
      {foot && <div className="foot">{foot}</div>}
    </div>
  );
}

export function decidedByLabel(by: string): string {
  return { rule: 'Fixed rule', model: 'Model', fuzzy_reference: 'Similar reference', person: 'A person' }[by] ?? by;
}

export function pct(n: number) { return `${Math.round(n * 100)} %`; }
