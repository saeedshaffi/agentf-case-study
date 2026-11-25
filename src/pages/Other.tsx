import { useMemo, useState } from 'react';
import { isResolved, runChecks, type Finding } from '../domain/checks';
import { groupDecisions, previewEffect, progress } from '../domain/decisions';
import { totalOf, trialBalance } from '../domain/ledger';
import { computeMetrics } from '../domain/metrics';
import { toCents, type Cents } from '../domain/money';
import { Amount, Badge, Callout, Count, DateText, Needs, PageHead, Ref, decidedByLabel } from '../ui/components';
import { matchLabel } from '../ui/TracePanel';
import { useApp } from '../ui/state';

const ALL = ['summary', 'invoices', 'bank_transactions', 'decisions', 'partners', 'accounts'] as const;

// ---------------- Checks ----------------

export function Checks() {
  return <Needs eps={[...ALL]}>{() => <ChecksInner />}</Needs>;
}

function ChecksInner() {
  const { data, cfg } = useApp();
  const findings = useMemo(() => runChecks(data.idx!, cfg), [data.idx, cfg]);
  const att = findings.filter((f) => f.severity === 'attention');
  return (
    <div className="stack">
      <PageHead title="What we checked">
        Before showing you the result, we recomputed every total from the individual records and looked for things no question covers.
        {att.length > 0 ? ` ${att.length} need your attention. Better you hear it from us than from your tax advisor.` : ' Nothing needs your attention.'}
      </PageHead>
      {findings.map((f) => <FindingCard key={f.id} f={f} />)}
    </div>
  );
}

function FindingCard({ f }: { f: Finding }) {
  const { openTrace, persisted } = useApp();
  const resolved = isResolved(f, persisted.answers);
  const tone = resolved ? 'good' : f.severity === 'attention' ? 'attention' : f.severity === 'passed' ? 'good' : 'info';
  return (
    <Callout tone={tone} title={<>{f.title}{resolved && <> <Badge tone="good">settled by your answers</Badge></>}</>}>
      <p>{f.detail} {f.amount && <strong><Amount value={f.amount.value} currency={f.amount.currency} /></strong>}</p>
      {f.next && <p><strong>What to do:</strong> {f.next}</p>}
      {f.items.length > 0 && <p><button className="link" onClick={() => openTrace({ kind: 'check', id: f.id })}>Show the {f.items.length} records behind this →</button></p>}
    </Callout>
  );
}

// ---------------- Books ----------------

export function Books() {
  return <Needs eps={[...ALL]}>{() => <BooksInner />}</Needs>;
}

type Tab = 'tb' | 'inv' | 'bank';

function BooksInner() {
  const { role } = useApp();
  const [tab, setTab] = useState<Tab>('tb');
  return (
    <div className="stack">
      <PageHead title={role === 'tax_advisor' ? 'Books' : 'Your books'}>
        {role === 'tax_advisor'
          ? 'Read-only. Every figure opens to its postings, source row and versions. Personal contact data is masked for your role.'
          : 'Everything that was booked. Click any number to see where it came from.'}
      </PageHead>
      <div className="filters" role="tablist">
        {([['tb', 'Accounts'], ['inv', 'Invoices'], ['bank', 'Bank']] as [Tab, string][]).map(([k, l]) => (
          <button key={k} role="tab" className="chip" aria-pressed={tab === k} aria-selected={tab === k} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>
      {tab === 'tb' && <TrialBalance />}
      {tab === 'inv' && <InvoiceTable />}
      {tab === 'bank' && <BankTable />}
    </div>
  );
}

function TrialBalance() {
  const { data, persisted, role } = useApp();
  const idx = data.idx!;
  const rows = useMemo(() => trialBalance(idx, persisted.answers), [idx, persisted.answers]);
  const m = useMemo(() => computeMetrics(idx), [idx]);
  const changed = rows.some((r) => r.balanceAfter !== r.balance);
  return (
    <div className="stack">
      <div className="grid c4">
        <MetricStat id="open_receivables_eur" m={m} />
        <MetricStat id="open_credit_notes_eur" m={m} />
        <MetricStat id="open_payables_eur" m={m} />
        <MetricStat id="open_receivables_usd" m={m} />
      </div>
      <section className="card">
        <div className="spread" style={{ marginBottom: 8 }}>
          <h2>{role === 'tax_advisor' ? 'Trial balance (SKR04), invoice postings' : 'Accounts'}</h2>
          <span className="small muted">Payments are matched, not posted, in this export; bank postings are not included.</span>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table className="t">
            <thead><tr><th>Account</th><th>Name</th><th className="r">Debit</th><th className="r">Credit</th><th className="r">Balance</th>{changed && <th className="r">After your answers</th>}</tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.account}>
                  <td><Ref target={{ kind: 'account', id: r.account }} /></td>
                  <td>{r.name} <span className="muted small">{r.type}</span></td>
                  <td className="r"><Amount value={r.debit} currency="EUR" /></td>
                  <td className="r"><Amount value={r.credit} currency="EUR" /></td>
                  <td className="r"><Amount value={r.balance} currency="EUR" trace={{ kind: 'account', id: r.account }} label={`Balance of ${r.account}`} /></td>
                  {changed && <td className="r">{r.balanceAfter !== r.balance ? <strong><Amount value={r.balanceAfter} currency="EUR" /></strong> : <span className="muted">—</span>}</td>}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr><td colSpan={2}>Total</td>
                <td className="r"><Amount value={totalOf(rows, 'debit')} currency="EUR" trace={{ kind: 'metric', id: 'debits' }} label="Total debits" /></td>
                <td className="r"><Amount value={totalOf(rows, 'credit')} currency="EUR" trace={{ kind: 'metric', id: 'credits' }} label="Total credits" /></td>
                <td className="r"><Amount value={totalOf(rows, 'debit') - totalOf(rows, 'credit')} currency="EUR" /></td>
                {changed && <td />}
              </tr>
            </tfoot>
          </table>
        </div>
      </section>
    </div>
  );
}

function MetricStat({ id, m }: { id: keyof ReturnType<typeof computeMetrics>; m: ReturnType<typeof computeMetrics> }) {
  const x = m[id];
  return (
    <div className="card tight stat">
      <div className="label">{x.label}</div>
      <div className="value" style={{ fontSize: 20 }}><Amount value={x.value as Cents} currency={x.currency!} trace={{ kind: 'metric', id }} label={x.label} /></div>
    </div>
  );
}

const PAGE = 50;

function InvoiceTable() {
  const { data, cfg } = useApp();
  const idx = data.idx!;
  const [q, setQ] = useState('');
  const [dir, setDir] = useState('all');
  const [status, setStatus] = useState('all');
  const [review, setReview] = useState(false);
  const [n, setN] = useState(PAGE);
  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return idx.invoices.filter((i) =>
      (dir === 'all' || i.direction === dir) &&
      (status === 'all' || i.payment.status === status) &&
      (!review || i.classification.needs_review || i.decision_ids.length > 0) &&
      (!s || i.id.toLowerCase().includes(s) || i.partner_name.toLowerCase().includes(s) || i.description.toLowerCase().includes(s)));
  }, [idx, q, dir, status, review]);
  const statuses = [...new Set(idx.invoices.map((i) => i.payment.status))];
  return (
    <section className="card">
      <div className="filters">
        <input type="search" placeholder="Search number, partner, description" value={q} onChange={(e) => { setQ(e.target.value); setN(PAGE); }} aria-label="Search invoices" style={{ minWidth: 260 }} />
        <select value={dir} onChange={(e) => setDir(e.target.value)} aria-label="Direction">
          <option value="all">All directions</option><option value="receivable">Sales ({cfg.words.customers})</option><option value="payable">Purchases ({cfg.words.suppliers})</option>
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Payment status">
          <option value="all">Any payment status</option>{statuses.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
        </select>
        <button className="chip" aria-pressed={review} onClick={() => setReview(!review)}>With open questions</button>
        <span className="small muted" style={{ alignSelf: 'center' }}>{rows.length.toLocaleString(cfg.numberLocale)} invoices</span>
      </div>
      {rows.length === 0 ? <p className="empty">No invoices match these filters.</p> : (
        <div style={{ overflowX: 'auto' }}>
          <table className="t">
            <thead><tr><th>Number</th><th>Date</th><th>Partner</th><th>Account</th><th>Booked by</th><th>Status</th><th className="r">Gross</th></tr></thead>
            <tbody>
              {rows.slice(0, n).map((i) => (
                <tr key={i.id}>
                  <td><Ref target={{ kind: 'invoice', id: i.id }} /></td>
                  <td><DateText iso={i.date} /></td>
                  <td>{i.partner_name}</td>
                  <td><span className="mono">{i.classification.account}</span></td>
                  <td>{decidedByLabel(i.classification.decided_by)}{i.classification.needs_review && <> <Badge tone="warn">review</Badge></>}</td>
                  <td className="small">{i.payment.status.replace(/_/g, ' ')}</td>
                  <td className="r"><Amount value={toCents(i.original.gross.amount)} currency={i.original.gross.currency} trace={{ kind: 'invoice', id: i.id }} label={`Gross of ${i.id}`} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {rows.length > n && <p className="small muted" style={{ marginTop: 8 }}>Showing {n} of {rows.length}. <button className="link" onClick={() => setN(n + PAGE * 4)}>Show more</button></p>}
    </section>
  );
}

function BankTable() {
  const { data, cfg } = useApp();
  const idx = data.idx!;
  const [kind, setKind] = useState('all');
  const [n, setN] = useState(PAGE);
  const kinds = [...new Set(idx.bank.map((t) => t.match?.kind ?? 'none'))];
  const rows = idx.bank.filter((t) => kind === 'all' || (t.match?.kind ?? 'none') === kind);
  return (
    <section className="card">
      <div className="filters">
        {['all', ...kinds].map((k) => (
          <button key={k} className="chip" aria-pressed={kind === k} onClick={() => { setKind(k); setN(PAGE); }}>
            {k === 'all' ? 'All' : k === 'none' ? 'Not matched' : matchLabel(k)} ({(k === 'all' ? idx.bank : idx.bank.filter((t) => (t.match?.kind ?? 'none') === k)).length.toLocaleString(cfg.numberLocale)})
          </button>
        ))}
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table className="t">
          <thead><tr><th>Transaction</th><th>Date</th><th>Counterparty</th><th>Reference</th><th>Matched</th><th className="r">Amount</th></tr></thead>
          <tbody>
            {rows.slice(0, n).map((t) => (
              <tr key={t.id}>
                <td><Ref target={{ kind: 'tx', id: t.id }} /></td>
                <td><DateText iso={t.booking_date} /></td>
                <td>{t.counterparty_name}</td>
                <td className="mono small">{t.reference}</td>
                <td className="small">{t.match ? <>{matchLabel(t.match.kind)}{t.match.invoices.length > 0 && <> · {t.match.invoices.map((i) => <Ref key={i} target={{ kind: 'invoice', id: i }} />)}</>}</> : <Badge tone="warn">waiting for you</Badge>}</td>
                <td className="r"><Amount value={toCents(t.amount.amount)} currency={t.amount.currency} signed trace={{ kind: 'tx', id: t.id }} label={`Amount of ${t.id}`} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > n && <p className="small muted" style={{ marginTop: 8 }}>Showing {n} of {rows.length}. <button className="link" onClick={() => setN(n + PAGE * 4)}>Show more</button></p>}
    </section>
  );
}

// ---------------- Hand-over ----------------

export function Handover() {
  return <Needs eps={[...ALL]}>{() => <HandoverInner />}</Needs>;
}

function HandoverInner() {
  const { data, cfg, persisted, dispatch, role, go, setRole } = useApp();
  const idx = data.idx!;
  const groups = useMemo(() => groupDecisions(idx, cfg), [idx, cfg]);
  const findings = useMemo(() => runChecks(idx, cfg), [idx, cfg]);
  const p = progress(groups, persisted.answers);
  const ack = persisted.acknowledged ?? {};
  const attention = findings.filter((f) => f.severity === 'attention');
  const isAck = (id: string) => ack[id] || isResolved(findings.find((f) => f.id === id)!, persisted.answers);
  const balanced = findings.find((f) => f.id === 'balanced')?.severity === 'passed';
  const reconciles = findings.find((f) => f.id === 'summary_reconciles')?.severity === 'passed';
  const allAck = attention.every((f) => isAck(f.id));
  const nonBlockingOpen = p.total - p.answered - p.blockingOpen;
  const ready = p.blockingOpen === 0 && allAck && balanced && reconciles;
  const signed = persisted.signedOff;

  return (
    <div className="stack">
      <PageHead title="Hand over to your tax advisor">
        When everything below is ticked, sign off. Your tax advisor then gets read-only access to the books, every source row and a log of every answer you gave.
      </PageHead>

      {signed && (
        <Callout tone="good" title={<>Signed off by {cfg.people[signed.by].displayName.toLowerCase()} on <DateText iso={signed.at} time /></>}>
          <p>Answers are locked. {persisted.advisorInvited ? 'Your tax advisor has access.' : 'Invite your tax advisor below.'}</p>
          <div className="row">
            <button className="btn small" onClick={() => setRole('tax_advisor')}>See what your advisor sees</button>
            {cfg.roles[role].canSignOff && <button className="btn small ghost" onClick={() => dispatch({ t: 'reopen', by: role })}>Reopen</button>}
          </div>
        </Callout>
      )}

      <section className="card">
        <h2 style={{ marginBottom: 8 }}>Before you sign off</h2>
        <ul className="checklist">
          <Check ok={balanced} title="The books balance" detail="Debits equal credits, to the cent." />
          <Check ok={reconciles} title="Every total matches the records" detail="We recomputed each total the engine reports from the individual records." />
          <Check ok={p.blockingOpen === 0} title="The questions that change your books are answered"
            detail={p.blockingOpen === 0 ? 'All answered.' : `${p.blockingOpen} still open.`}
            action={p.blockingOpen > 0 ? <button className="btn small" onClick={() => go('decisions')}>Answer them</button> : undefined} />
          {attention.map((f) => (
            <li key={f.id}>
              <span className={`tick ${isAck(f.id) ? 'yes' : 'warn'}`} aria-hidden>{isAck(f.id) ? '✓' : '!'}</span>
              <div>
                <strong>{f.title}</strong>
                <div className="small muted">{isResolved(f, persisted.answers) ? 'Settled by your answers.' : f.next}</div>
              </div>
              {isResolved(f, persisted.answers) ? <span /> : (
                <label className="small row" style={{ gap: 6 }}>
                  <input type="checkbox" checked={!!ack[f.id] || !!signed} disabled={!!signed} onChange={(e) => dispatch({ t: 'ack', id: f.id, on: e.target.checked })} />
                  I have read this
                </label>
              )}
            </li>
          ))}
          <li>
            <span className="tick yes" aria-hidden>i</span>
            <div><strong>{nonBlockingOpen} questions can stay open</strong><div className="small muted">Unmatched payments, refunds and overpayments stay visible in the bank clearing account. Your advisor sees them.</div></div>
            <span />
          </li>
        </ul>
        {cfg.roles[role].canSignOff && !signed && (
          <div className="row" style={{ marginTop: 16 }}>
            <button className="btn primary" disabled={!ready} onClick={() => dispatch({ t: 'signOff', by: role })}>Sign off the migration</button>
            {!ready && <span className="small muted">Tick everything above first.</span>}
          </div>
        )}
      </section>

      <section className="card stack-sm">
        <h2>Your tax advisor's access</h2>
        <p>They will see: the books and every posting, source rows and versions, the checks above, and your answers with dates. They will <strong>not</strong> see customers' and suppliers' e-mail addresses, contact names or IBANs, and cannot change anything.</p>
        <div className="row">
          {persisted.advisorInvited
            ? <Badge tone="good">Invitation prepared <DateText iso={persisted.advisorInvited} time /></Badge>
            : <button className="btn" disabled={!signed} onClick={() => dispatch({ t: 'invite', at: new Date().toISOString() })}>Invite tax advisor (read-only)</button>}
          <button className="btn ghost" onClick={() => setRole('tax_advisor')}>Preview their view</button>
        </div>
        {!signed && <p className="small muted">Invite after sign-off, so they review the final state.</p>}
        <p className="small muted">In this prototype the invitation is recorded, not sent.</p>
      </section>
    </div>
  );
}

function Check({ ok, title, detail, action }: { ok: boolean; title: string; detail: string; action?: React.ReactNode }) {
  return (
    <li>
      <span className={`tick ${ok ? 'yes' : 'no'}`} aria-hidden>{ok ? '✓' : ''}</span>
      <div><strong>{title}</strong><div className="small muted">{detail}</div></div>
      {action ?? <span className="sr-only">{ok ? 'done' : 'not done'}</span>}
    </li>
  );
}

// ---------------- Decision log (advisor) ----------------

export function DecisionLog() {
  return <Needs eps={[...ALL]}>{() => <DecisionLogInner />}</Needs>;
}

function DecisionLogInner() {
  const { data, cfg, persisted } = useApp();
  const idx = data.idx!;
  const groups = useMemo(() => groupDecisions(idx, cfg), [idx, cfg]);
  const p = progress(groups, persisted.answers);
  const log = [...persisted.log].reverse();
  return (
    <div className="stack">
      <PageHead title="Decisions and their effect">
        Every answer the finance lead gave, when, and what it changed. {p.answered} of {p.total} questions answered
        {persisted.signedOff ? <>; signed off <DateText iso={persisted.signedOff.at} time />.</> : '; not yet signed off.'}
      </PageHead>
      <section className="card">
        {log.length === 0 ? <p className="empty">No answers yet.</p> : (
          <div style={{ overflowX: 'auto' }}>
            <table className="t">
              <thead><tr><th>When</th><th>Who</th><th>Question</th><th>Answer</th><th>Effect on the books</th></tr></thead>
              <tbody>
                {log.slice(0, 300).map((e, k) => {
                  const d = idx.decisionById.get(e.decisionId);
                  const opt = d?.options.find((o) => o.id === e.optionId);
                  const eff = d && e.optionId ? previewEffect(d, e.optionId, idx) : null;
                  return (
                    <tr key={k}>
                      <td className="small"><DateText iso={e.at} time /></td>
                      <td className="small">{cfg.people[e.by].displayName}</td>
                      <td><Ref target={{ kind: 'decision', id: e.decisionId }} /> <span className="small">{d?.title}</span></td>
                      <td className="small">{e.action === 'undone' ? <Badge tone="neutral">undone</Badge> : <>{opt?.label}{e.value && <> · <span className="mono">{e.value}</span></>}{e.bulk && <> <Badge tone="info">in bulk</Badge></>}</>}</td>
                      <td className="small">{e.action === 'undone' ? '—' : eff?.lines.length ? eff.lines.map((l, j) => <span key={j}>{j > 0 && ' · '}<span className="mono">{l.account}</span> <Amount value={l.delta} currency="EUR" signed /></span>) : <span className="muted">{eff?.text}</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

// ---------------- Overview (managing director) ----------------

export function Overview() {
  const { data, cfg } = useApp();
  return (
    <div className="stack">
      <PageHead title={`Did the move to Agent F work?`}>
        A one-screen answer for {cfg.company}. Totals only; no customer or supplier details.
      </PageHead>
      <Needs eps={[...ALL]}>{() => <OverviewInner />}</Needs>
      {!data.idx && null}
    </div>
  );
}

function OverviewInner() {
  const { data, cfg, persisted } = useApp();
  const idx = data.idx!;
  const groups = useMemo(() => groupDecisions(idx, cfg), [idx, cfg]);
  const findings = useMemo(() => runChecks(idx, cfg), [idx, cfg]);
  const m = useMemo(() => computeMetrics(idx), [idx]);
  const p = progress(groups, persisted.answers);
  const tax = findings.filter((f) => f.severity === 'attention' && (f.id.startsWith('zero_rated') || f.id.startsWith('foreign_currency')));
  const signed = persisted.signedOff;
  return (
    <>
      <Callout tone={signed ? 'good' : 'info'} title={signed ? 'Yes. The migration is signed off.' : 'Yes, the books are in. The finance lead is working through the last questions.'}>
        <p>
          <Count n={idx.invoices.length} /> invoices and <Count n={idx.bank.length} /> bank transactions loaded; the books balance.
          {' '}{p.answered} of {p.total} questions answered{signed ? '' : `, ${p.blockingOpen} still needed before sign-off`}.
        </p>
      </Callout>
      <div className="grid c3">
        <div className="card tight stat"><div className="label">Customers owe you (net of credit notes)</div><div className="value"><Amount value={m.net_receivables_eur.value as Cents} currency="EUR" trace={{ kind: 'metric', id: 'net_receivables_eur' }} label="Net receivables" /></div><div className="foot">plus <Amount value={m.open_receivables_usd.value as Cents} currency="USD" /> in USD</div></div>
        <div className="card tight stat"><div className="label">You owe suppliers</div><div className="value"><Amount value={m.open_payables_eur.value as Cents} currency="EUR" trace={{ kind: 'metric', id: 'open_payables_eur' }} label="Open payables" /></div></div>
        <div className="card tight stat"><div className="label">Questions left</div><div className="value">{p.total - p.answered}</div><div className="foot">{p.blockingOpen} block sign-off</div></div>
      </div>
      <section className="card stack-sm">
        <h2>Does anything need you?</h2>
        {tax.length === 0 ? <p>No. Nothing waits on you.</p> : (
          <>
            <p>Not to act on, but worth knowing: <strong>{tax.length} VAT points</strong> your tax advisor will look at before the first VAT return.</p>
            <ul>{tax.map((f) => <li key={f.id}>{f.title}{f.amount && <> (<Amount value={f.amount.value} currency={f.amount.currency} />)</>}</li>)}</ul>
            <p className="small muted">The finance lead has the details.</p>
          </>
        )}
      </section>
    </>
  );
}
