import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { previewEffect } from '../domain/decisions';
import { postingsAfter, trialBalance } from '../domain/ledger';
import { agreesWithEngine, type MetricId, type TraceTarget } from '../domain/metrics';
import { abs, sum, toCents, type Cents } from '../domain/money';
import type { Indexed, Invoice } from '../domain/types';
import { STATUS_TEXT } from '../pages/Checks';
import { optionLabel, PROTOTYPE_NOTE } from '../pages/decisions/shared';
import { ACCOUNT_PLAIN, Amount, Count, DateText, Personal, Ref, Status, decidedByLabel, pct, useFocusTrap } from './components';
import { href } from './router';
import { useApp, useDerived } from './state';

const KIND_LABEL: Record<TraceTarget['kind'], string> = {
  metric: 'Total', invoice: 'Invoice', tx: 'Bank transaction', partner: 'Partner',
  account: 'Account', decision: 'Question', load: 'Load', check: 'Check',
};

export function matchLabel(kind?: string) {
  return ({ full: 'Paid in full', partial: 'Part payment', combined: 'One payment for several invoices', overpayment: 'Paid too much', bank_fee: 'Bank fee' } as Record<string, string>)[kind ?? ''] ?? 'Not matched';
}
export function statusLabel(s: string) {
  return ({ paid: 'Paid', open: 'Open', overdue: 'Overdue', partially_paid: 'Partly paid', overpaid: 'Paid too much', open_credit: 'Credit not yet settled' } as Record<string, string>)[s] ?? s;
}

/** Record panel: modal, keeps focus inside, returns it to the opener, keeps a trail of what was opened. */
export function TracePanel() {
  const { trace, closeTrace, popTrace, data, derived } = useApp();
  const ref = useRef<HTMLElement>(null);
  const top = trace[trace.length - 1];
  const open = !!top && !!data.idx && !!derived;
  useFocusTrap(ref, open, closeTrace);
  useEffect(() => {
    if (open) ref.current?.querySelector<HTMLElement>('[data-panel-title]')?.focus();
  }, [open, top]);
  if (!open) return null;
  return (
    <>
      <div className="scrim" onClick={closeTrace} aria-hidden />
      <aside ref={ref} className="drawer" role="dialog" aria-modal="true" aria-labelledby="panel-title">
        <header>
          <nav className="crumbs" aria-label="Opened records">
            {trace.map((t, i) => (
              <span key={i}>
                {i > 0 && <span aria-hidden> › </span>}
                {i < trace.length - 1
                  ? <button type="button" onClick={() => popTrace(i)}>{KIND_LABEL[t.kind]}{t.kind !== 'metric' && t.kind !== 'check' ? ` ${t.id}` : ''}</button>
                  : <span aria-current="location">{KIND_LABEL[t.kind]}</span>}
              </span>
            ))}
          </nav>
          {trace.length > 1 && <button type="button" className="btn small" onClick={() => popTrace(trace.length - 2)}>Back</button>}
          <button type="button" className="btn small" onClick={closeTrace}>Close</button>
        </header>
        <div className="content">
          <Body t={top} />
        </div>
      </aside>
    </>
  );
}

function Body({ t }: { t: TraceTarget }) {
  switch (t.kind) {
    case 'metric': return <MetricView id={t.id} />;
    case 'invoice': return <InvoiceView id={t.id} />;
    case 'tx': return <TxView id={t.id} />;
    case 'partner': return <PartnerView id={t.id} />;
    case 'account': return <AccountView id={t.id} />;
    case 'decision': return <DecisionView id={t.id} />;
    case 'load': return <LoadView id={t.id} />;
    case 'check': return <CheckView id={t.id} />;
  }
}

function Title({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return (
    <div className="stack-2">
      <h2 id="panel-title" data-panel-title tabIndex={-1}>{children}</h2>
      {sub && <div className="muted">{sub}</div>}
    </div>
  );
}

function NotFound({ what }: { what: string }) {
  return <p className="muted">{what} is not in this customer's data.</p>;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return <section><h3 style={{ marginBottom: 8 }}>{title}</h3>{children}</section>;
}

/** Long lists grow in steps; the count is always stated. */
function Paged<T>({ items, render, step = 50, noun }: { items: T[]; render: (x: T) => ReactNode; step?: number; noun: string }) {
  const [n, setN] = useState(step);
  return (
    <>
      {items.slice(0, n).map(render)}
      {items.length > n && (
        <tr><td colSpan={4}>
          <span className="muted">Showing {n} of {items.length} {noun}. </span>
          <button type="button" className="link" onClick={() => setN(n + step * 2)}>Show {Math.min(step * 2, items.length - n)} more</button>
        </td></tr>
      )}
    </>
  );
}

function InvoiceRows({ ids, idx, value, valueHead = 'Amount', currency }: { ids: string[]; idx: Indexed; value?: (i: Invoice) => Cents; valueHead?: string; currency?: (i: Invoice) => string }) {
  const invs = ids.map((id) => idx.invoiceById.get(id)!).filter(Boolean);
  const v = value ?? ((i: Invoice) => toCents(i.original.gross.amount));
  const c = currency ?? ((i: Invoice) => i.original.gross.currency);
  const sorted = [...invs].sort((a, b) => (abs(v(b)) > abs(v(a)) ? 1 : -1));
  return (
    <table className="table">
      <thead><tr><th scope="col">Invoice</th><th scope="col">Partner</th><th scope="col" className="r">{valueHead}</th></tr></thead>
      <tbody>
        <Paged items={sorted} noun="invoices" render={(i) => (
          <tr key={i.id}><td><Ref target={{ kind: 'invoice', id: i.id }} /></td><td>{i.partner_name}</td><td className="r"><Amount value={v(i)} currency={c(i)} /></td></tr>
        )} />
      </tbody>
    </table>
  );
}

function MetricView({ id }: { id: MetricId }) {
  const { metrics, idx } = useDerived();
  const { role, cfg } = useApp();
  const m = metrics[id];
  if (!m) return <NotFound what="This total" />;
  const agree = agreesWithEngine(m);
  const advisor = role === 'tax_advisor';
  const fig = (v: Cents | number) => (m.kind === 'money' ? <Amount value={v as Cents} currency={m.currency!} /> : <Count n={Number(v)} />);
  return (
    <>
      <Title sub={advisor ? m.definition : m.explain}>{m.label}</Title>
      <p style={{ fontSize: 'var(--t-figure)', lineHeight: 'var(--lh-figure)', fontWeight: 600 }}>{fig(m.value)}</p>
      {!advisor && <p className="cap muted">Definition: {m.definition}</p>}
      {agree === true && <Status kind="settled">Recomputed from the records: matches the engine</Status>}
      {agree === false && <Status kind="blocking">The engine reports {String(m.engineValue)}; the records add up differently</Status>}
      {m.parts.length > 0 && (
        <Section title="How it adds up">
          <table className="table">
            <tbody>{m.parts.map((p) => <tr key={p.label}><td>{p.label} <span className="muted">({p.count.toLocaleString(cfg.numberLocale)})</span></td><td className="r">{m.kind === 'money' ? <Amount value={p.value} currency={m.currency!} /> : <Count n={p.count} />}</td></tr>)}</tbody>
            {m.parts.length > 1 && <tfoot><tr><td>Total</td><td className="r">{fig(m.value)}</td></tr></tfoot>}
          </table>
        </Section>
      )}
      {m.parts.map((p) => p.items.length > 0 && (
        <Section key={p.label} title={p.label}>
          {p.itemKind === 'invoice'
            ? <InvoiceRows ids={p.items} idx={idx} valueHead={m.id.includes('open') || m.id.startsWith('net') ? 'Open' : 'Gross'} value={m.id.includes('open') || m.id.startsWith('net') ? (i) => toCents(i.payment.open.amount) : undefined} />
            : <table className="table"><tbody><Paged items={p.items} noun="transactions" render={(txid) => { const t = idx.txById.get(txid)!; return <tr key={txid}><td><Ref target={{ kind: 'tx', id: txid }} /></td><td>{t.counterparty_name}</td><td className="r"><Amount value={toCents(t.amount.amount)} currency={t.amount.currency} /></td></tr>; }} /></tbody></table>}
        </Section>
      ))}
    </>
  );
}

function plainPostings(i: Invoice): string {
  const taxFree = i.original.vat_rate_percent === 0;
  if (i.type === 'credit_note') return taxFree ? 'In plain words: the credit note reduces what this customer owes you and reduces your tax-free sales. No VAT is involved.' : 'In plain words: the credit note reduces what this customer owes you, your sales and the VAT you owe.';
  if (i.direction === 'receivable') return taxFree ? 'In plain words: the customer owes you the full amount and it is all sales. No German VAT was charged, because the sale was booked as tax-free.' : 'In plain words: the customer owes you the gross amount; the net is sales, the VAT is owed to the tax office.';
  return 'In plain words: you owe the supplier the gross amount; the net is a cost, the VAT can be reclaimed.';
}

function InvoiceView({ id }: { id: string }) {
  const { idx } = useDerived();
  const { cfg, work, role } = useApp();
  const i = idx.invoiceById.get(id);
  if (!i) return <NotFound what={`Invoice ${id}`} />;
  const kind = i.type === 'credit_note' ? cfg.words.creditNote : i.direction === 'receivable' ? cfg.words.salesInvoice : cfg.words.supplierInvoice;
  const txs = idx.txByInvoice.get(i.id) ?? [];
  const questions = [...new Set([...i.decision_ids, ...txs.flatMap((t) => t.decision_ids ?? [])])].map((d) => idx.decisionById.get(d)!).filter(Boolean);
  const postings = postingsAfter(i.id, idx, work.answers);
  const c = i.classification;
  const advisor = role === 'tax_advisor';
  const load = idx.loadById.get(i.source.load);
  return (
    <>
      <Title sub={<>{kind} {i.direction === 'receivable' ? 'to' : 'from'} <Ref target={{ kind: 'partner', id: i.partner_id }}>{i.partner_name}</Ref> · <DateText iso={i.date} /> · “{i.description}”</>}>
        <span className="code">{i.id}</span>
      </Title>
      <p><Status kind={['paid'].includes(i.payment.status) ? 'settled' : ['overdue', 'overpaid'].includes(i.payment.status) ? 'open' : 'neutral'}>{statusLabel(i.payment.status)}</Status></p>
      <Section title="Amounts">
        <dl className="kv">
          <dt>Net</dt><dd><Amount value={toCents(i.original.net.amount)} currency={i.original.net.currency} /></dd>
          <dt>VAT {i.original.vat_rate_percent} %</dt><dd><Amount value={toCents(i.original.vat.amount)} currency={i.original.vat.currency} /></dd>
          <dt>Gross</dt><dd><strong><Amount value={toCents(i.original.gross.amount)} currency={i.original.gross.currency} /></strong></dd>
          {i.fx && <><dt>Booked in EUR</dt><dd><Amount value={toCents(i.booked.gross.amount)} currency="EUR" /> <span className="muted">at {i.fx.rate_usd_per_eur} USD per EUR, rate of <DateText iso={i.fx.rate_date} />{i.flags.includes('fx_rate_from_previous_business_day') && ' (previous business day: no rate on the invoice date)'}</span></dd></>}
          <dt>Paid</dt><dd><Amount value={toCents(i.payment.paid.amount)} currency={i.payment.paid.currency} /></dd>
          <dt>Open</dt><dd><Amount value={toCents(i.payment.open.amount)} currency={i.payment.open.currency} />{i.type === 'credit_note' && i.payment.status === 'open_credit' && <span className="muted"> owed to the customer</span>}</dd>
          <dt>Due</dt><dd><DateText iso={i.due_date} /></dd>
        </dl>
      </Section>
      <Section title="How it was booked">
        <p>
          {advisor ? <>Account <Ref target={{ kind: 'account', id: c.account }}>{c.account}</Ref> <span lang="de">{c.account_name}</span></> : <>On <Ref target={{ kind: 'account', id: c.account }}>{c.account}</Ref> {ACCOUNT_PLAIN[c.account] ?? c.account_name}</>}
          {' '}· decided by {decidedByLabel(c.decided_by)}{c.decided_by !== 'rule' && `, ${pct(c.confidence)} sure`}
          {c.needs_review && <> · <span className="tag attention">waiting for review</span></>}
        </p>
        {c.rule && <p className="cap muted">Rule: {c.rule}</p>}
        {c.model_input && <p className="cap muted">What the model saw: {c.model_input}.</p>}
        <table className="table" style={{ marginTop: 8 }}>
          <thead><tr><th scope="col">Account</th><th scope="col" className="r">Debit</th><th scope="col" className="r">Credit</th></tr></thead>
          <tbody>
            {postings.map((p, k) => (
              <tr key={k}>
                <td><Ref target={{ kind: 'account', id: p.account }} /> <span className="muted">{advisor ? <span lang="de">{idx.accountById.get(p.account)?.name}</span> : ACCOUNT_PLAIN[p.account]}</span></td>
                <td className="r"><Amount value={toCents(p.debit)} currency="EUR" /></td>
                <td className="r"><Amount value={toCents(p.credit)} currency="EUR" /></td>
              </tr>
            ))}
          </tbody>
        </table>
        {postings !== i.postings && <p className="cap" style={{ marginTop: 6 }}><Status kind="info">Includes your answer</Status> Originally booked to {c.account}.</p>}
        {!advisor && <p className="cap muted" style={{ marginTop: 6 }}>{plainPostings(i)}</p>}
      </Section>
      <Section title="Where it came from">
        <ol className="lineage">
          {i.history.map((h, k) => (
            <li key={k}>
              <div><span className="code">{h.file}</span>, row {h.row} · <Ref target={{ kind: 'load', id: h.load }}>{h.load}</Ref></div>
              <div className="cap muted">
                The export said: {h.status_in_export}, gross <Amount value={toCents(h.gross_in_export.amount)} currency={h.gross_in_export.currency} />
                {k < i.history.length - 1 ? ' · replaced by the next version' : i.history.length > 1 ? ' · this version is in your books' : ''}
              </div>
            </li>
          ))}
          {i.flags.includes('gross_differs_from_net_plus_vat') && <li><div className="cap">The old system's gross did not equal net plus VAT. Booked as net plus VAT.</div></li>}
          {load && <li><div className="cap muted">Loaded <DateText iso={load.finished_at} time /></div></li>}
        </ol>
      </Section>
      <Section title={`Bank payments (${txs.length})`}>
        {txs.length === 0 ? <p className="muted">No bank payment is linked to this invoice.</p> : (
          <table className="table"><tbody>
            {txs.map((t) => <tr key={t.id}><td><Ref target={{ kind: 'tx', id: t.id }} /></td><td><DateText iso={t.booking_date} /></td><td>{matchLabel(t.match?.kind)}</td><td className="r"><Amount value={toCents(t.amount.amount)} currency={t.amount.currency} /></td></tr>)}
          </tbody></table>
        )}
      </Section>
      {questions.length > 0 && (
        <Section title="Questions about this invoice">
          {questions.map((d) => <p key={d.id}><Ref target={{ kind: 'decision', id: d.id }} /> {d.title} {work.answers[d.id] && <Status kind="settled">Answered</Status>}</p>)}
        </Section>
      )}
    </>
  );
}

function TxView({ id }: { id: string }) {
  const { idx } = useDerived();
  const t = idx.txById.get(id);
  if (!t) return <NotFound what={`Transaction ${id}`} />;
  const amt = toCents(t.amount.amount);
  return (
    <>
      <Title sub={<>{amt > 0n ? 'Money in' : 'Money out'} · booked <DateText iso={t.booking_date} />, value date <DateText iso={t.value_date} /></>}><span className="code">{t.id}</span></Title>
      <p style={{ fontSize: 'var(--t-figure)', lineHeight: 'var(--lh-figure)', fontWeight: 600 }}><Amount value={amt} currency={t.amount.currency} signed /></p>
      <Section title="On the bank statement">
        <dl className="kv">
          <dt>Counterparty</dt><dd>{t.counterparty_name}</dd>
          <dt>IBAN</dt><dd><Personal kind="iban" value={t.counterparty_iban} /></dd>
          <dt>Reference</dt><dd className="code">{t.reference || '—'}</dd>
          <dt>Source</dt><dd><span className="code">{t.source.file}</span> · <Ref target={{ kind: 'load', id: t.source.load }}>{t.source.load}</Ref></dd>
        </dl>
      </Section>
      <Section title="Matched to">
        {t.match ? (
          <div className="stack-2">
            <p>{matchLabel(t.match.kind)} · {decidedByLabel(t.match.decided_by)} · {pct(t.match.confidence)} sure</p>
            {t.match.account && <p>Booked to <Ref target={{ kind: 'account', id: t.match.account }} /> {ACCOUNT_PLAIN[t.match.account]}</p>}
            {t.match.invoices.length > 0 && <InvoiceRows ids={t.match.invoices} idx={idx} />}
          </div>
        ) : <p className="muted">Not matched. It stays unassigned until someone says what it was.</p>}
      </Section>
      {t.decision_ids?.length ? <Section title="Questions">{t.decision_ids.map((d) => <p key={d}><Ref target={{ kind: 'decision', id: d }} /> {idx.decisionById.get(d)?.title}</p>)}</Section> : null}
    </>
  );
}

function PartnerView({ id }: { id: string }) {
  const { idx } = useDerived();
  const { cfg } = useApp();
  const p = idx.partnerById.get(id);
  if (!p) return <NotFound what={`Partner ${id}`} />;
  const invs = idx.invoicesByPartner.get(id) ?? [];
  const ds = idx.decisionsByPartner.get(id) ?? [];
  return (
    <>
      <Title sub={<>{p.type === 'customer' ? cfg.words.customer : cfg.words.supplier} {p.id}{p.flags.length ? ` · ${p.flags.map((f) => f.replace(/_/g, ' ')).join(', ')}` : ''}</>}>{p.name}</Title>
      <Section title="Record">
        <dl className="kv">
          <dt>Country</dt><dd>{p.country ?? <span className="tag attention">missing</span>}</dd>
          <dt>City</dt><dd>{p.city || <span className="muted">not in the export</span>}</dd>
          <dt>VAT ID</dt><dd className="code">{p.vat_id}</dd>
          <dt>Contact</dt><dd><Personal kind="name" value={p.contact_person} /></dd>
          <dt>E-mail</dt><dd><Personal kind="email" value={p.email} /></dd>
          <dt>IBAN</dt><dd><Personal kind="iban" value={p.iban} /></dd>
          <dt>Source</dt><dd><span className="code">{p.source.file}</span>, row {p.source.row}</dd>
        </dl>
      </Section>
      {ds.length > 0 && <Section title="Questions">{ds.map((d) => <p key={d.id}><Ref target={{ kind: 'decision', id: d.id }} /> {d.title}</p>)}</Section>}
      <Section title={`Invoices (${invs.length})`}>{invs.length ? <InvoiceRows ids={invs.map((i) => i.id)} idx={idx} /> : <p className="muted">No invoices.</p>}</Section>
    </>
  );
}

/** The amount each invoice actually posted to this account, so the list adds up to the balance. */
function AccountView({ id }: { id: string }) {
  const { idx } = useDerived();
  const { work, role } = useApp();
  const row = useMemo(() => trialBalance(idx, work.answers).find((r) => r.account === id), [idx, work.answers, id]);
  const a = idx.accountById.get(id);
  if (!row && !a) return <NotFound what={`Account ${id}`} />;
  const posted = (i: Invoice) => sum(postingsAfter(i.id, idx, work.answers).filter((p) => p.account === id).map((p) => toCents(p.debit) - toCents(p.credit)));
  return (
    <>
      <Title sub={<>{a?.type} account · SKR04{role !== 'tax_advisor' && ACCOUNT_PLAIN[id] ? ` · ${ACCOUNT_PLAIN[id]}` : ''}</>}><span className="code">{id}</span> <span lang="de">{a?.name}</span></Title>
      {row && (
        <Section title="Totals from invoice postings">
          <dl className="kv">
            <dt>Debits</dt><dd><Amount value={row.debit} currency="EUR" /></dd>
            <dt>Credits</dt><dd><Amount value={row.credit} currency="EUR" /></dd>
            <dt>Balance</dt><dd><strong><Amount value={row.balance} currency="EUR" /></strong></dd>
            {row.balanceAfter !== row.balance && <><dt>After your answers</dt><dd><Amount value={row.balanceAfter} currency="EUR" /></dd></>}
          </dl>
        </Section>
      )}
      {row && <Section title={`Postings to this account (${row.invoiceIds.length} invoices)`}><InvoiceRows ids={row.invoiceIds} idx={idx} valueHead="Posted (debit − credit)" value={posted} currency={() => 'EUR'} /></Section>}
    </>
  );
}

function DecisionView({ id }: { id: string }) {
  const { idx } = useDerived();
  const { work, cfg, role, closeTrace } = useApp();
  const d = idx.decisionById.get(id);
  if (!d) return <NotFound what={`Question ${id}`} />;
  const ans = work.answers[id];
  const group = cfg.decisionGroups.find((g) => g.match.type === d.type);
  return (
    <>
      <Title sub={<>{d.title} · question {d.id}</>}>{d.question}</Title>
      <p>{ans ? <Status kind="settled">Answered: {optionLabel(d, ans.optionId)}</Status> : <Status kind="open">Open</Status>}</p>
      <Section title="Options">
        {d.options.map((o) => (
          <div key={o.id} style={{ marginBottom: 8 }}>
            <strong>{o.label}</strong> {d.suggested_option === o.id && <span className="tag">Engine suggestion</span>}
            <div className="cap muted">{previewEffect(d, o.id, idx).text}{PROTOTYPE_NOTE[o.id] && <> {PROTOTYPE_NOTE[o.id]}</>}</div>
          </div>
        ))}
        {d.why_suggested && <p className="cap muted">Why suggested: {d.why_suggested}</p>}
      </Section>
      <Section title="Evidence">
        {d.references.map((r, k) => (
          <p key={k}>
            {'invoice' in r && <><Ref target={{ kind: 'invoice', id: r.invoice }} />{r.file && <span className="cap muted"> · {r.file}, row {r.row}</span>}</>}
            {'transaction' in r && <Ref target={{ kind: 'tx', id: r.transaction }} />}
            {'partner' in r && <Ref target={{ kind: 'partner', id: r.partner }}>{idx.partnerById.get(r.partner)?.name ?? r.partner}</Ref>}
          </p>
        ))}
      </Section>
      {group && cfg.roles[role].pages.includes('decisions') && <a className="btn primary" href={href('decisions', group.id)} onClick={closeTrace}>Open in decisions</a>}
    </>
  );
}

function LoadView({ id }: { id: string }) {
  const { idx } = useDerived();
  const l = idx.loadById.get(id);
  if (!l) return <NotFound what={`Load ${id}`} />;
  const retry = idx.summary.loads.find((x) => x.retry_of === id);
  return (
    <>
      <Title sub={<span className="code">{l.file}</span>}>{l.kind.replace(/_/g, ' ')} <span className="code muted">{l.id}</span></Title>
      <p>{l.status === 'succeeded' ? <Status kind="settled">Loaded</Status> : <Status kind="blocking">Failed</Status>}</p>
      <dl className="kv">
        <dt>Started</dt><dd><DateText iso={l.started_at} time /></dd>
        <dt>Finished</dt><dd><DateText iso={l.finished_at} time /></dd>
        {l.failed_step && <><dt>Failed at</dt><dd>{l.failed_step}</dd></>}
        {l.rows_processed_before_failure !== undefined && <><dt>Rows before failure</dt><dd>{l.rows_processed_before_failure}</dd></>}
        {l.retry_of && <><dt>Retry of</dt><dd><Ref target={{ kind: 'load', id: l.retry_of }} /></dd></>}
      </dl>
      {l.error && <p>{l.error}</p>}
      {retry && <p>Retried as <Ref target={{ kind: 'load', id: retry.id }} />, which {retry.status}.</p>}
    </>
  );
}

function CheckView({ id }: { id: string }) {
  const { findings, status } = useDerived();
  const { closeTrace } = useApp();
  const f = findings.find((x) => x.id === id);
  if (!f) return <NotFound what="This check" />;
  const [k, t] = STATUS_TEXT[status(f)];
  return (
    <>
      <Title sub={<Status kind={k}>{t}</Status>}>{f.title}</Title>
      <p>{f.detail}</p>
      <a className="btn primary" href={href('checks', f.id)} onClick={closeTrace}>Open in checks</a>
    </>
  );
}
