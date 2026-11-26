import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import type { Endpoint } from '../domain/load';
import type { TraceTarget } from '../domain/metrics';
import { formatCount, formatMoney, type Cents } from '../domain/money';
import { maskEmail, maskIban, maskName } from '../domain/privacy';
import { useApp } from './state';

/** A money amount. With `trace`, it is a button that opens where it came from; its name keeps the value. */
export function Amount({ value, currency, trace, signed, label }: {
  value: Cents; currency: string; trace?: TraceTarget; signed?: boolean; label?: string;
}) {
  const { cfg, openTrace } = useApp();
  const text = formatMoney(value, currency, cfg.numberLocale, { signed });
  if (!trace) return <span className="num">{text}</span>;
  return (
    <button type="button" className="fig" onClick={() => openTrace(trace)} aria-label={`${text}${label ? `, ${label}` : ''}. Show source`}>
      {text}
    </button>
  );
}

export function Count({ n, trace, label }: { n: number; trace?: TraceTarget; label?: string }) {
  const { cfg, openTrace } = useApp();
  const text = formatCount(n, cfg.numberLocale);
  if (!trace) return <span className="num">{text}</span>;
  return (
    <button type="button" className="fig" onClick={() => openTrace(trace)} aria-label={`${text}${label ? ` ${label}` : ''}. Show source`}>
      {text}
    </button>
  );
}

/** A record reference that opens in the record panel. */
export function Ref({ target, children }: { target: TraceTarget; children?: ReactNode }) {
  const { openTrace } = useApp();
  return <button type="button" className="link code" onClick={() => openTrace(target)}>{children ?? target.id}</button>;
}

/** Personal data, masked unless the current role may see it. */
export function Personal({ kind, value }: { kind: 'iban' | 'email' | 'name'; value: string }) {
  const { cfg, role } = useApp();
  if (cfg.roles[role].seesPersonalData) return <span className={kind === 'iban' ? 'code' : undefined}>{value || '—'}</span>;
  const masked = kind === 'iban' ? maskIban(value) : kind === 'email' ? maskEmail(value) : maskName(value);
  return <span className={kind === 'iban' ? 'code' : undefined} title="Hidden for your role">{masked}</span>;
}

export function DateText({ iso, time }: { iso: string; time?: boolean }) {
  const { cfg } = useApp();
  const d = new Date(iso);
  if (isNaN(+d)) return <span>{iso}</span>;
  const opts: Intl.DateTimeFormatOptions = time
    ? { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }
    : { day: 'numeric', month: 'short', year: 'numeric' };
  return <time dateTime={iso}>{new Intl.DateTimeFormat(cfg.dateLocale, opts).format(d)}</time>;
}

export type StatusKind = 'settled' | 'open' | 'blocking' | 'neutral' | 'info';
export function Status({ kind, children }: { kind: StatusKind; children: ReactNode }) {
  return <span className={`status ${kind}`}>{children}</span>;
}

export function Notice({ tone, title, children, role }: { tone: 'attention' | 'blocking' | 'settled' | 'info' | 'plain'; title?: ReactNode; children?: ReactNode; role?: 'alert' | 'status' }) {
  return (
    <div className={`notice ${tone === 'plain' ? '' : tone}`} role={role}>
      <div className="stack-2">
        {title && <p className="strong">{title}</p>}
        {children}
      </div>
    </div>
  );
}

export function PageHead({ title, children, aside }: { title: string; children?: ReactNode; aside?: ReactNode }) {
  return (
    <header className="page-head">
      <div>
        <h1 tabIndex={-1} id="page-title">{title}</h1>
        {children && <p>{children}</p>}
      </div>
      {aside}
    </header>
  );
}

const ENDPOINT_LABEL: Record<Endpoint, string> = {
  summary: 'migration summary', invoices: 'invoices', bank_transactions: 'bank transactions',
  decisions: 'open questions', partners: 'customers and suppliers', accounts: 'chart of accounts',
};

/** Renders children only when the data they need is loaded; never a partial total. */
export function Needs({ eps, children }: { eps: Endpoint[]; children: () => ReactNode }) {
  const { data } = useApp();
  const failed = eps.filter((e) => data.endpoints[e].status === 'error');
  const loading = eps.filter((e) => data.endpoints[e].status === 'loading');
  if (failed.length) {
    return (
      <Notice tone="blocking" role="alert" title={`The ${failed.map((e) => ENDPOINT_LABEL[e]).join(' and ')} could not be loaded`}>
        <p>This part of the page is hidden until it loads, so you never see a total built from incomplete data.</p>
        <div className="row">
          {failed.map((e) => <button key={e} type="button" className="btn small" onClick={() => data.retry(e)}>Try loading {ENDPOINT_LABEL[e]} again</button>)}
        </div>
      </Notice>
    );
  }
  if (loading.length || (!data.idx && eps.some((e) => e !== 'summary'))) {
    return (
      <div className="panel panel-pad stack-2" aria-busy="true">
        <p className="muted cap" role="status">Loading {loading.map((e) => ENDPOINT_LABEL[e]).join(', ') || 'your books'}…</p>
        <div className="skeleton" style={{ width: '60%' }} />
        <div className="skeleton" style={{ width: '85%' }} />
        <div className="skeleton" style={{ width: '40%' }} />
      </div>
    );
  }
  return <>{children()}</>;
}

/** Keeps Tab inside `ref` while active, closes on Escape, and returns focus to where it came from. */
export function useFocusTrap(ref: RefObject<HTMLElement>, active: boolean, onEscape: () => void) {
  const escRef = useRef(onEscape);
  escRef.current = onEscape;
  useEffect(() => {
    if (!active) return;
    const opener = document.activeElement as HTMLElement | null;
    const el = ref.current;
    const focusables = () => [...(el?.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea, [tabindex]:not([tabindex="-1"])') ?? [])].filter((x) => x.offsetParent !== null || x === document.activeElement);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); escRef.current(); return; }
      if (e.key !== 'Tab' || !el) return;
      const f = focusables();
      if (!f.length) return;
      // Move focus ourselves, so it never leaves, even from a heading that is only programmatically focusable.
      e.preventDefault();
      const active = document.activeElement as HTMLElement | null;
      let i = active ? f.indexOf(active) : -1;
      if (i === -1 && active && el.contains(active)) {
        // Position of a non-tabbable element: the first tabbable that follows it.
        const after = f.findIndex((x) => active.compareDocumentPosition(x) & Node.DOCUMENT_POSITION_FOLLOWING);
        i = after === -1 ? f.length : after;
        (e.shiftKey ? f[(i - 1 + f.length) % f.length] : f[i % f.length]).focus();
        return;
      }
      if (i === -1) { (e.shiftKey ? f[f.length - 1] : f[0]).focus(); return; }
      f[(i + (e.shiftKey ? -1 : 1) + f.length) % f.length].focus();
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      if (opener && document.contains(opener)) opener.focus();
    };
  }, [active, ref]);
}

export function ConfirmDialog({ title, children, confirmLabel, onConfirm, onCancel, tone = 'primary' }: {
  title: string; children: ReactNode; confirmLabel: string; onConfirm: () => void; onCancel: () => void; tone?: 'primary' | 'danger';
}) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref, true, onCancel);
  useEffect(() => { ref.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus(); }, []);
  return (
    <>
      <div className="scrim" style={{ zIndex: 39 }} onClick={onCancel} aria-hidden />
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title">
        <div className="box" ref={ref}>
          <header><h2 id="dialog-title">{title}</h2></header>
          <div className="body stack">{children}</div>
          <footer>
            <button type="button" className="btn" onClick={onCancel} data-autofocus>Cancel</button>
            <button type="button" className={`btn ${tone === 'danger' ? 'danger' : 'primary'}`} onClick={onConfirm}>{confirmLabel}</button>
          </footer>
        </div>
      </div>
    </>
  );
}

/** Stays 10 s, pauses while hovered or focused, can be dismissed. Undo is also always available on the item itself. */
export function Toast() {
  const { toast, showToast } = useApp();
  const [paused, setPaused] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  // A new toast starts unpaused, even if the previous one was dismissed while hovered or focused.
  useEffect(() => { setPaused(false); }, [toast]);
  // Focus must never sit underneath the toast (WCAG 2.4.11): scroll the focused control clear of it,
  // and if the page cannot scroll further, dismiss the toast. Undo stays available on the item itself.
  useEffect(() => {
    if (!toast) return;
    const onFocus = (e: FocusEvent) => {
      const el = e.target as HTMLElement | null;
      const t = box.current;
      // Sections and headings that receive focus programmatically are not controls the toast can hide.
      if (!el || !t || t.contains(el) || el.getAttribute('tabindex') === '-1') return;
      const hidden = () => { const a = el.getBoundingClientRect(), b = t.getBoundingClientRect(); return a.bottom > b.top && a.top < b.bottom && a.right > b.left && a.left < b.right; };
      if (!hidden()) return;
      // The toast sits at the top: scroll up so the control moves below it.
      window.scrollBy(0, -(t.getBoundingClientRect().bottom - el.getBoundingClientRect().top + 16));
      requestAnimationFrame(() => { if (hidden()) showToast(null); });
    };
    document.addEventListener('focusin', onFocus);
    return () => document.removeEventListener('focusin', onFocus);
  }, [toast, showToast]);
  useEffect(() => {
    if (!toast || paused) return;
    const t = setTimeout(() => showToast(null), 10000);
    return () => clearTimeout(t);
  }, [toast, paused, showToast]);
  if (!toast) return null;
  return (
    <div ref={box} className="toast" role="status" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)} onFocus={() => setPaused(true)} onBlur={() => setPaused(false)}>
      <span>{toast.text}</span>
      {toast.undo && <button type="button" onClick={() => { toast.undo!(); showToast(null); }}>{toast.undoLabel ?? 'Undo'}</button>}
      <button type="button" className="dismiss" aria-label="Dismiss" onClick={() => showToast(null)}>✕</button>
    </div>
  );
}

export function decidedByLabel(by: string): string {
  return ({ rule: 'Fixed rule', model: 'Model', fuzzy_reference: 'Similar reference', person: 'A person' } as Record<string, string>)[by] ?? by;
}

export function pct(n: number) { return `${Math.round(n * 100)} %`; }

/** Plain-language meaning of SKR04 accounts used in this chart, for people who are not accountants. */
export const ACCOUNT_PLAIN: Record<string, string> = {
  '1200': 'What customers owe you',
  '1800': 'Bank',
  '1406': 'VAT you can reclaim (19 %)',
  '3300': 'What you owe suppliers',
  '3806': 'VAT you owe (19 %)',
  '3801': 'VAT you owe (7 %)',
  '4400': 'Sales with 19 % VAT',
  '4300': 'Sales with 7 % VAT',
  '4125': 'Tax-free sales to EU businesses',
  '4120': 'Tax-free sales outside the EU',
  '5400': 'Goods bought for resale',
  '6310': 'Rent',
  '6320': 'Heating and utilities',
  '6520': 'Vehicle insurance',
  '6530': 'Vehicle running costs',
  '6600': 'Advertising',
  '6640': 'Business entertaining',
  '6805': 'Telephone',
  '6815': 'Office supplies',
  '6825': 'Legal and consulting fees',
  '6827': 'Accounting and audit fees',
  '6835': 'Rented equipment',
  '6837': 'Software licences',
  '6855': 'Bank charges',
  '6300': 'Other operating costs',
};
