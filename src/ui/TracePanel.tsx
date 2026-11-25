import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { runChecks } from '../domain/checks';
import { previewEffect } from '../domain/decisions';
import { postingsAfter, trialBalance } from '../domain/ledger';
import { agreesWithEngine, computeMetrics, type TraceTarget } from '../domain/metrics';
import { abs, toCents, type Cents } from '../domain/money';
import type { Indexed, Invoice } from '../domain/types';
import { Amount, Badge, Count, DateText, Personal, Ref, decidedByLabel, pct } from './components';
import { useApp } from './state';

const KIND_LABEL: Record<TraceTarget['kind'], string> = {
  metric: 'Total', invoice: 'Invoice', tx: 'Bank transaction', partner: 'Partner',
  account: 'Account', decision: 'Question', load: 'Load', check: 'Check',
};

export function TracePanel() {
  const { trace, closeTrace, popTrace, data } = useApp();
  const closeRef = useRef<HTMLButtonElement>(null);
  const top = trace[trace.length - 1];

  useEffect(() => {
    if (!top) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeTrace(); };
    window.addEventListener('keydown', onKey);
    closeRef.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [top, closeTrace]);

  if (!top || !data.idx) return null;
  return (
    <>
      <div className="scrim" onClick={closeTrace} aria-hidden />
      <aside className="panel" role="dialog" aria-modal="true" aria-label={`${KIND_LABEL[top.kind]} ${top.id}`}>
        <header>
          <nav className="crumbs" aria-label="Trace path">
            {trace.map((t, i) => (
              <span key={i}>
                {i > 0 && <span aria-hidden> › </span>}
                {i < trace.length - 1
                  ? <button onClick={() => popTrace(i)}>{KIND_LABEL[t.kind]} {short(t)}</button>
                  : <strong style={{ color: 'var(--ink)' }}>{KIND_LABEL[t.kind]} {short(t)}</strong>}
              </span>
            ))}
          </nav>
          {trace.length > 1 && <button className="btn small ghost" onClick={() => popTrace(trace.length - 2)}>← Back</button>}
          <button ref={closeRef} className="btn small" onClick={closeTrace} aria-label="Close">Close</button>
        </header>
        <div className="content">
          <TraceBody t={top} idx={data.idx} />
        </div>
      </aside>
    </>
  );
}

function short(t: TraceTarget) {
  if (t.kind === 'metric') return '';
  if (t.kind === 'check') return '';
  return t.id;
}

function TraceBody({ t, idx }: { t: TraceTarget; idx: Indexed }) {
  switch (t.kind) {
    case 'metric': return <MetricView id={t.id} idx={idx} />;
    case 'invoice': return <InvoiceView id={t.id} idx={idx} />;
    case 'tx': return <TxView id={t.id} idx={idx} />;
    case 'partner': return <PartnerView id={t.id} idx={idx} />;
    case 'account': return <AccountView id={t.id} idx={idx} />;
    case 'decision': return <DecisionView id={t.id} idx={idx} />;
    case 'load': return <LoadView id={t.id} idx={idx} />;
    case 'check': return <CheckView id={t.id} idx={idx} />;
  }
}

function NotFound({ what }: { what: string }) {
  return <p className="muted">{what} is not in this customer's data. It may have been removed in a later load.</p>;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return <section><div className="section-title">{title}</div>{children}</section>;
}

/** Long lists are capped; the cap is stated, never silent. */
function Capped<T>({ items, render, cap = 25, noun }: { items: T[]; render: (x: T) => ReactNode; cap?: number; noun: string }) {
  const [all, setAll] = useState(false);
  const shown = all ? items : items.slice(0, cap);
  return (
    <>
      {shown.map(render)}
      {items.length > cap && (
        <p className="small muted" style={{ marginTop: 8 }}>
          Showing {shown.length} of {items.length} {noun}.{' '}
          <button className="link" onClick={() => setAll(!all)}>{all ? 'Show fewer' : `Show all ${items.length}`}</button>
        </p>
      )}
    </>
  );
}

function InvoiceRows({ ids, idx, value }: { ids: string[]; idx: Indexed; value?: (i: Invoice) => Cents }) {
  const invs = ids.map((id) => idx.invoiceById.get(id)!).filter(Boolean);
  const v = value ?? ((i: Invoice) => toCents(i.original.gross.amount));
  const sorted = [...invs].sort((a, b) => (abs(v(b)) > abs(v(a)) ? 1 : -1));
  return (
    <table className="t">
      <thead><tr><th>Invoice</th><th>Partner</th><th className="r">Amount</th></tr></thead>
      <tbody>
        <Capped items={sorted} noun="invoices" render={(i) => (
          <tr key={i.id}>
            <td><Ref target={{ kind: 'invoice', id: i.id }} /></td>
            <td>{i.partner_name}</td>
            <td className="r"><Amount value={v(i)} currency={i.original.gross.currency} /></td>
          </tr>
        )} />
      </tbody>
    </table>
  );
}

function MetricView({ id, idx }: { id: string; idx: Indexed }) {
  const { cfg, role } = useApp();
  const m = useMemo(() => computeMetrics(idx), [idx])[id as keyof ReturnType<typeof computeMetrics>];
  if (!m) return <NotFound what="This total" />;
  const agree = agreesWithEngine(m);
  const accountant = role === 'tax_advisor';
  return (
    <>
      <div className="stack-sm">
        <h2>{m.label}</h2>
        <div style={{ fontSize: 28, fontWeight: 650 }}>
          {m.kind === 'money' ? <Amount value={m.value as Cents} currency={m.currency!} /> : <Count n={Number(m.value)} />}
        </div>
        <p>{accountant ? m.definition : m.explain}</p>
        {!accountant && <p className="small muted">Definition: {m.definition}</p>}
        {agree === true && <Badge tone="good">✓ Recomputed from the records; matches the engine's figure</Badge>}
        {agree === false && <Badge tone="bad">Engine reports {String(m.engineValue)}; the records add up differently</Badge>}
      </div>
      {m.parts.length > 0 && (
        <Section title="How it adds up">
          <table className="t">
            <tbody>
              {m.parts.map((p) => (
                <tr key={p.label}>
                  <td>{p.label} <span className="muted small">({p.count.toLocaleString(cfg.numberLocale)})</span></td>
                  <td className="r">{m.kind === 'money' ? <Amount value={p.value} currency={m.currency!} /> : <Count n={p.count} />}</td>
                </tr>
              ))}
            </tbody>
            {m.parts.length > 1 && (
              <tfoot><tr><td>Total</td><td className="r">{m.kind === 'money' ? <Amount value={m.value as Cents} currency={m.currency!} /> : <Count n={Number(m.value)} />}</td></tr></tfoot>
            )}
          </table>
        </Section>
      )}
      {m.parts.map((p) => p.itemKind === 'invoice' && p.items.length > 0 && (
        <Section key={p.label} title={p.label}>
          <InvoiceRows ids={p.items} idx={idx} value={m.id.startsWith('open') || m.id.startsWith('net') ? (i) => toCents(i.payment.open.amount) : undefined} />
        </Section>
      ))}
      {m.parts.map((p) => p.itemKind === 'tx' && p.items.length > 0 && (
        <Section key={p.label} title={p.label}>
          <table className="t"><tbody>
            <Capped items={p.items} noun="transactions" render={(id) => {
              const t = idx.txById.get(id)!;
              return (
                <tr key={id}><td><Ref target={{ kind: 'tx', id }} /></td><td>{t.counterparty_name}</td>
                  <td className="r"><Amount value={toCents(t.amount.amount)} currency={t.amount.currency} /></td></tr>
              );
            }} />
          </tbody></table>
        </Section>
      ))}
    </>
  );
}

function InvoiceView({ id, idx }: { id: string; idx: Indexed }) {
  const { cfg, persisted, role } = useApp();
  const i = idx.invoiceById.get(id);
  if (!i) return <NotFound what={`Invoice ${id}`} />;
  const kind = i.type === 'credit_note' ? cfg.words.creditNote : i.direction === 'receivable' ? cfg.words.salesInvoice : cfg.words.supplierInvoice;
  const txs = idx.txByInvoice.get(i.id) ?? [];
  const decisions = [...new Set([...i.decision_ids, ...txs.flatMap((t) => t.decision_ids ?? [])])].map((d) => idx.decisionById.get(d)).filter(Boolean);
  const postings = postingsAfter(i.id, idx, persisted.answers);
  const changed = postings !== i.postings;
  const c = i.classification;
  const accountant = role === 'tax_advisor';
  const load = idx.loadById.get(i.source.load);
  return (
    <>
      <div className="stack-sm">
        <div className="row"><h2 className="mono">{i.id}</h2><Badge tone="neutral">{kind}</Badge><PaymentBadge status={i.payment.status} /></div>
        <p>
          {i.direction === 'receivable' ? 'To ' : 'From '}
          <Ref target={{ kind: 'partner', id: i.partner_id }}>{i.partner_name}</Ref> · <DateText iso={i.date} /> · “{i.description}”
        </p>
      </div>

      <Section title="Amounts">
        <dl className="kv">
          <dt>Net</dt><dd><Amount value={toCents(i.original.net.amount)} currency={i.original.net.currency} /></dd>
          <dt>VAT {i.original.vat_rate_percent} %</dt><dd><Amount value={toCents(i.original.vat.amount)} currency={i.original.vat.currency} /></dd>
          <dt>Gross</dt><dd><strong><Amount value={toCents(i.original.gross.amount)} currency={i.original.gross.currency} /></strong></dd>
          {i.fx && (<>
            <dt>Booked in EUR</dt>
            <dd><Amount value={toCents(i.booked.gross.amount)} currency="EUR" /> <span className="muted small">at {i.fx.rate_usd_per_eur} USD per EUR, rate of <DateText iso={i.fx.rate_date} />{i.flags.includes('fx_rate_from_previous_business_day') && ' (previous business day: no rate published on the invoice date)'}</span></dd>
          </>)}
          <dt>Paid</dt><dd><Amount value={toCents(i.payment.paid.amount)} currency={i.payment.paid.currency} /></dd>
          <dt>Open</dt><dd><Amount value={toCents(i.payment.open.amount)} currency={i.payment.open.currency} />{i.type === 'credit_note' && i.payment.status === 'open_credit' && <span className="muted small"> owed to the customer</span>}</dd>
          <dt>Due</dt><dd><DateText iso={i.due_date} /></dd>
        </dl>
      </Section>

      <Section title="How it was booked">
        <p style={{ marginBottom: 8 }}>
          {accountant ? <>Account <Ref target={{ kind: 'account', id: c.account }}>{c.account}</Ref> {c.account_name}</> : <>On <Ref target={{ kind: 'account', id: c.account }}>{c.account_name}</Ref> <span className="muted">({c.account})</span></>}
          {' '}· decided by <strong>{decidedByLabel(c.decided_by)}</strong>
          {c.decided_by !== 'rule' && <>, confidence {pct(c.confidence)}</>}
          {c.needs_review && <> · <Badge tone="warn">waiting for you</Badge></>}
        </p>
        {c.rule && <p className="small muted">Rule: {c.rule}</p>}
        {c.model_input && <p className="small muted">What the model saw: {c.model_input}.</p>}
        <table className="t" style={{ marginTop: 8 }}>
          <thead><tr><th>Account</th><th className="r">Debit</th><th className="r">Credit</th></tr></thead>
          <tbody>
            {postings.map((p, k) => (
              <tr key={k}>
                <td><Ref target={{ kind: 'account', id: p.account }}>{p.account}</Ref> <span className="muted small">{idx.accountById.get(p.account)?.name}</span></td>
                <td className="r"><Amount value={toCents(p.debit)} currency="EUR" /></td>
                <td className="r"><Amount value={toCents(p.credit)} currency="EUR" /></td>
              </tr>
            ))}
          </tbody>
        </table>
        {changed && <p className="small" style={{ marginTop: 6 }}><Badge tone="info">Includes your answer</Badge> Originally booked to {c.account}.</p>}
        {!accountant && <p className="small muted" style={{ marginTop: 6 }}>{plainPostings(i)}</p>}
      </Section>

      <Section title="Where it came from">
        <ol className="lineage">
          {i.history.map((h, k) => (
            <li key={k}>
              <div><span className="mono">{h.file}</span>, row {h.row} · <Ref target={{ kind: 'load', id: h.load }}>{h.load}</Ref></div>
              <div className="small muted">
                Export said: {h.status_in_export}, gross <Amount value={toCents(h.gross_in_export.amount)} currency={h.gross_in_export.currency} />
                {k < i.history.length - 1 && ' · replaced by the next version'}
                {k === i.history.length - 1 && i.history.length > 1 && ' · this version is in your books'}
              </div>
            </li>
          ))}
          {i.flags.includes('gross_differs_from_net_plus_vat') && (
            <li><div className="small">The old system's gross did not equal net + VAT. Booked as net + VAT.</div></li>
          )}
          {load && <li><div className="small muted">Loaded <DateText iso={load.finished_at} time /></div></li>}
        </ol>
      </Section>

      <Section title={`Bank payments (${txs.length})`}>
        {txs.length === 0 ? <p className="muted small">No bank payment is linked to this invoice.</p> : (
          <table className="t"><tbody>
            {txs.map((t) => (
              <tr key={t.id}>
                <td><Ref target={{ kind: 'tx', id: t.id }} /></td>
                <td><DateText iso={t.booking_date} /></td>
                <td>{matchLabel(t.match?.kind)} · {decidedByLabel(t.match?.decided_by ?? '')}</td>
                <td className="r"><Amount value={toCents(t.amount.amount)} currency={t.amount.currency} /></td>
              </tr>
            ))}
          </tbody></table>
        )}
      </Section>

      {decisions.length > 0 && (
        <Section title="Open questions about this invoice">
          {decisions.map((d) => <p key={d!.id}><Ref target={{ kind: 'decision', id: d!.id }} /> {d!.title}</p>)}
        </Section>
      )}
    </>
  );
}

function plainPostings(i: Invoice): string {
  if (i.type === 'credit_note') return 'In plain words: the credit note reduces what this customer owes you, and reduces your revenue and VAT accordingly.';
  if (i.direction === 'receivable' && i.original.vat_rate_percent === 0) return 'In plain words: the customer owes you the full amount and it is all revenue. No German VAT was charged, because the sale was booked as tax-free.';
  if (i.direction === 'receivable') return 'In plain words: the customer owes you the gross amount; the net is revenue, the VAT is owed to the tax office.';
  return 'In plain words: you owe the supplier the gross amount; the net is a cost, the VAT can be reclaimed.';
}

export function matchLabel(kind?: string) {
  return ({ full: 'Pays in full', partial: 'Part payment', combined: 'One payment for several invoices', overpayment: 'Paid too much', bank_fee: 'Bank fee' } as Record<string, string>)[kind ?? ''] ?? 'Not matched';
}

function PaymentBadge({ status }: { status: string }) {
  const map: Record<string, ['good' | 'warn' | 'bad' | 'info' | 'neutral', string]> = {
    paid: ['good', 'Paid'], open: ['neutral', 'Open'], overdue: ['warn', 'Overdue'], partially_paid: ['info', 'Partly paid'],
    overpaid: ['warn', 'Overpaid'], open_credit: ['info', 'Credit not yet settled'],
  };
  const [tone, label] = map[status] ?? ['neutral', status];
  return <Badge tone={tone}>{label}</Badge>;
}

function TxView({ id, idx }: { id: string; idx: Indexed }) {
  const t = idx.txById.get(id);
  if (!t) return <NotFound what={`Transaction ${id}`} />;
  const amt = toCents(t.amount.amount);
  return (
    <>
      <div className="stack-sm">
        <div className="row"><h2 className="mono">{t.id}</h2><Badge tone={t.match ? 'good' : 'warn'}>{matchLabel(t.match?.kind)}</Badge></div>
        <div style={{ fontSize: 24, fontWeight: 650 }}><Amount value={amt} currency={t.amount.currency} signed /></div>
        <p className="muted">{amt > 0n ? 'Money in' : 'Money out'} · booked <DateText iso={t.booking_date} />, value date <DateText iso={t.value_date} /></p>
      </div>
      <Section title="On the bank statement">
        <dl className="kv">
          <dt>Counterparty</dt><dd>{t.counterparty_name}</dd>
          <dt>IBAN</dt><dd><Personal kind="iban" value={t.counterparty_iban} /></dd>
          <dt>Reference</dt><dd className="mono">{t.reference || '—'}</dd>
          <dt>Source</dt><dd><span className="mono">{t.source.file}</span> · <Ref target={{ kind: 'load', id: t.source.load }}>{t.source.load}</Ref></dd>
        </dl>
      </Section>
      <Section title="What it was matched to">
        {t.match ? (
          <div className="stack-sm">
            <p>{matchLabel(t.match.kind)} · {decidedByLabel(t.match.decided_by)} · confidence {pct(t.match.confidence)}</p>
            {t.match.account && <p>Booked to <Ref target={{ kind: 'account', id: t.match.account }} /> {idx.accountById.get(t.match.account)?.name}</p>}
            {t.match.invoices.length > 0 && <InvoiceRows ids={t.match.invoices} idx={idx} />}
          </div>
        ) : <p className="muted">Not matched. It waits in the bank clearing account until you say what it was.</p>}
      </Section>
      {t.decision_ids?.length ? (
        <Section title="Open questions">
          {t.decision_ids.map((d) => <p key={d}><Ref target={{ kind: 'decision', id: d }} /> {idx.decisionById.get(d)?.title}</p>)}
        </Section>
      ) : null}
    </>
  );
}

function PartnerView({ id, idx }: { id: string; idx: Indexed }) {
  const { cfg } = useApp();
  const p = idx.partnerById.get(id);
  if (!p) return <NotFound what={`Partner ${id}`} />;
  const invs = idx.invoicesByPartner.get(id) ?? [];
  const ds = idx.decisionsByPartner.get(id) ?? [];
  return (
    <>
      <div className="stack-sm">
        <div className="row"><h2>{p.name}</h2><Badge tone="neutral">{p.type === 'customer' ? cfg.words.customer : cfg.words.supplier} {p.id}</Badge></div>
        {p.flags.map((f) => <Badge key={f} tone="warn">{f.replace(/_/g, ' ')}</Badge>)}
      </div>
      <Section title="Record">
        <dl className="kv">
          <dt>Country</dt><dd>{p.country ?? <Badge tone="warn">missing</Badge>}</dd>
          <dt>City</dt><dd>{p.city}</dd>
          <dt>VAT ID</dt><dd className="mono">{p.vat_id}</dd>
          <dt>Contact</dt><dd><Personal kind="name" value={p.contact_person} /></dd>
          <dt>E-mail</dt><dd><Personal kind="email" value={p.email} /></dd>
          <dt>IBAN</dt><dd><Personal kind="iban" value={p.iban} /></dd>
          <dt>Source</dt><dd><span className="mono">{p.source.file}</span>, row {p.source.row}</dd>
        </dl>
      </Section>
      {ds.length > 0 && <Section title="Open questions">{ds.map((d) => <p key={d.id}><Ref target={{ kind: 'decision', id: d.id }} /> {d.title}</p>)}</Section>}
      <Section title={`Invoices (${invs.length})`}>
        {invs.length ? <InvoiceRows ids={invs.map((i) => i.id)} idx={idx} /> : <p className="muted small">No invoices.</p>}
      </Section>
    </>
  );
}

function AccountView({ id, idx }: { id: string; idx: Indexed }) {
  const { persisted } = useApp();
  const row = useMemo(() => trialBalance(idx, persisted.answers).find((r) => r.account === id), [idx, persisted.answers, id]);
  const a = idx.accountById.get(id);
  if (!row && !a) return <NotFound what={`Account ${id}`} />;
  return (
    <>
      <div className="stack-sm">
        <h2><span className="mono">{id}</span> {a?.name}</h2>
        <p className="muted">{a?.type} account · SKR04</p>
      </div>
      {row && (
        <Section title="Totals from invoice postings">
          <dl className="kv">
            <dt>Debits</dt><dd><Amount value={row.debit} currency="EUR" /></dd>
            <dt>Credits</dt><dd><Amount value={row.credit} currency="EUR" /></dd>
            <dt>Balance</dt><dd><strong><Amount value={row.balance} currency="EUR" /></strong></dd>
            {row.balanceAfter !== row.balance && (<><dt>After your answers</dt><dd><Amount value={row.balanceAfter} currency="EUR" /></dd></>)}
          </dl>
        </Section>
      )}
      {row && <Section title={`Invoices posted here (${row.invoiceIds.length})`}><InvoiceRows ids={row.invoiceIds} idx={idx} /></Section>}
    </>
  );
}

function DecisionView({ id, idx }: { id: string; idx: Indexed }) {
  const { persisted, go, closeTrace, cfg, role } = useApp();
  const d = idx.decisionById.get(id);
  if (!d) return <NotFound what={`Question ${id}`} />;
  const ans = persisted.answers[id];
  return (
    <>
      <div className="stack-sm">
        <div className="row"><h2 className="mono">{d.id}</h2>{ans ? <Badge tone="good">Answered</Badge> : <Badge tone="warn">Open</Badge>}</div>
        <p><strong>{d.title}</strong></p>
        <p>{d.question}</p>
      </div>
      <Section title="Options">
        {d.options.map((o) => (
          <div key={o.id} style={{ marginBottom: 8 }}>
            <strong>{o.label}</strong> {d.suggested_option === o.id && <Badge tone="accent">suggested</Badge>} {ans?.optionId === o.id && <Badge tone="good">chosen</Badge>}
            <div className="small muted">{previewEffect(d, o.id, idx).text}</div>
          </div>
        ))}
        {d.why_suggested && <p className="small muted">Why suggested: {d.why_suggested}</p>}
      </Section>
      <Section title="Evidence">
        {d.references.map((r, k) => (
          <p key={k}>
            {'invoice' in r && <><Ref target={{ kind: 'invoice', id: r.invoice }} />{r.file && <span className="small muted"> · {r.file}, row {r.row}</span>}</>}
            {'transaction' in r && <Ref target={{ kind: 'tx', id: r.transaction }} />}
            {'partner' in r && <Ref target={{ kind: 'partner', id: r.partner }}>{idx.partnerById.get(r.partner)?.name ?? r.partner}</Ref>}
          </p>
        ))}
      </Section>
      {cfg.roles[role].pages.includes('decisions') && (
        <button className="btn primary" onClick={() => { closeTrace(); go('decisions'); setTimeout(() => document.getElementById(`d-${id}`)?.scrollIntoView({ block: 'center' }), 50); }}>
          Go to this question
        </button>
      )}
    </>
  );
}

function LoadView({ id, idx }: { id: string; idx: Indexed }) {
  const l = idx.loadById.get(id);
  if (!l) return <NotFound what={`Load ${id}`} />;
  const retry = idx.summary.loads.find((x) => x.retry_of === id);
  return (
    <>
      <div className="row"><h2 className="mono">{l.id}</h2><Badge tone={l.status === 'succeeded' ? 'good' : 'bad'}>{l.status}</Badge></div>
      <dl className="kv">
        <dt>What</dt><dd>{l.kind.replace(/_/g, ' ')}</dd>
        <dt>File</dt><dd className="mono">{l.file}</dd>
        <dt>Started</dt><dd><DateText iso={l.started_at} time /></dd>
        <dt>Finished</dt><dd><DateText iso={l.finished_at} time /></dd>
        {l.failed_step && (<><dt>Failed at</dt><dd>{l.failed_step}</dd></>)}
        {l.rows_processed_before_failure !== undefined && (<><dt>Rows before failure</dt><dd>{l.rows_processed_before_failure}</dd></>)}
        {l.retry_of && (<><dt>Retry of</dt><dd><Ref target={{ kind: 'load', id: l.retry_of }} /></dd></>)}
      </dl>
      {l.error && <p>{l.error}</p>}
      {retry && <p>Retried as <Ref target={{ kind: 'load', id: retry.id }} />, which {retry.status}.</p>}
    </>
  );
}

function CheckView({ id, idx }: { id: string; idx: Indexed }) {
  const { cfg } = useApp();
  const f = useMemo(() => runChecks(idx, cfg), [idx, cfg]).find((x) => x.id === id);
  if (!f) return <NotFound what="This check" />;
  return (
    <>
      <h2>{f.title}</h2>
      <p>{f.detail} {f.amount && <strong><Amount value={f.amount.value} currency={f.amount.currency} /></strong>}</p>
      {f.next && <p><strong>Next:</strong> {f.next}</p>}
      <Section title="Evidence">
        <Capped items={f.items} noun="items" render={(t) => (
          <p key={`${t.kind}${t.id}`}><Ref target={t}>{t.kind === 'metric' ? computeMetrics(idx)[t.id].label : undefined}</Ref>
            {t.kind === 'invoice' && <span className="muted small"> {idx.invoiceById.get(t.id)?.partner_name}</span>}
            {t.kind === 'partner' && <span className="muted small"> {idx.partnerById.get(t.id)?.name}</span>}
          </p>
        )} />
      </Section>
    </>
  );
}
