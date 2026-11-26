import { useMemo, useState } from 'react';
import { trialBalance, totalOf } from '../domain/ledger';
import type { MetricId } from '../domain/metrics';
import { toCents, type Cents } from '../domain/money';
import { ACCOUNT_PLAIN, Amount, DateText, Needs, PageHead, Ref, decidedByLabel } from '../ui/components';
import { href } from '../ui/router';
import { useApp, useDerived } from '../ui/state';
import { matchLabel, statusLabel } from '../ui/TracePanel';

const ALL = ['summary', 'invoices', 'bank_transactions', 'decisions', 'partners', 'accounts'] as const;
const TABS = [['accounts', 'Accounts'], ['invoices', 'Invoices'], ['bank', 'Bank']] as const;
const PAGE = 50;

export function Records({ tab }: { tab?: string }) {
  const { role } = useApp();
  const t = TABS.some(([k]) => k === tab) ? tab! : 'accounts';
  return (
    <div className="stack">
      <PageHead title="Records">
        {role === 'tax_advisor'
          ? 'Read-only. Every figure opens to its postings, source row and versions. Customer and supplier contact details are masked for your role.'
          : 'Everything that was booked. Select any figure or number to see where it came from.'}
      </PageHead>
      <nav className="segmented" aria-label="Record type">
        {TABS.map(([k, l]) => <a key={k} href={href('books', k)} aria-current={t === k ? 'page' : undefined}>{l}</a>)}
      </nav>
      <Needs eps={[...ALL]}>{() => (t === 'invoices' ? <InvoiceTable /> : t === 'bank' ? <BankTable /> : <Accounts />)}</Needs>
    </div>
  );
}

function Accounts() {
  const { idx, metrics } = useDerived();
  const { work, role } = useApp();
  const rows = useMemo(() => trialBalance(idx, work.answers), [idx, work.answers]);
  const changed = rows.some((r) => r.balanceAfter !== r.balance);
  const advisor = role === 'tax_advisor';
  const tiles: MetricId[] = ['open_receivables_eur', 'open_credit_notes_eur', 'open_payables_eur', 'open_receivables_usd'];
  return (
    <div className="stack">
      <div className="panel facts">
        {tiles.map((id) => (
          <div className="fact" key={id}>
            <div className="label">{metrics[id].label}</div>
            <div className="value" style={{ fontSize: 20 }}><Amount value={metrics[id].value as Cents} currency={metrics[id].currency!} trace={{ kind: 'metric', id }} label={metrics[id].label} /></div>
          </div>
        ))}
      </div>
      <section className="panel" aria-labelledby="tb">
        <header className="panel-head">
          <h2 id="tb">{advisor ? 'Trial balance (SKR04), invoice postings' : 'Accounts'}</h2>
          <span className="cap muted measure">Covers invoice postings. Payments are matched to invoices, not posted, in this export. Credit notes are posted by the engine as negative debits.</span>
        </header>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th scope="col">Account</th><th scope="col">Name</th><th scope="col" className="r">Debit</th><th scope="col" className="r">Credit</th><th scope="col" className="r">Balance</th>{changed && <th scope="col" className="r">After your answers</th>}</tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.account}>
                  <td><Ref target={{ kind: 'account', id: r.account }} /></td>
                  <td>{advisor ? <span lang="de">{r.name}</span> : <>{ACCOUNT_PLAIN[r.account] ?? r.name}<div className="cap muted" lang="de">{r.name}</div></>}</td>
                  <td className="r"><Amount value={r.debit} currency="EUR" /></td>
                  <td className="r"><Amount value={r.credit} currency="EUR" /></td>
                  <td className="r"><Amount value={r.balance} currency="EUR" trace={{ kind: 'account', id: r.account }} label={`balance of account ${r.account}`} /></td>
                  {changed && <td className="r">{r.balanceAfter !== r.balance ? <strong><Amount value={r.balanceAfter} currency="EUR" /></strong> : <span className="muted">unchanged</span>}</td>}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr><td colSpan={2}>Total</td>
                <td className="r"><Amount value={totalOf(rows, 'debit')} currency="EUR" trace={{ kind: 'metric', id: 'debits' }} label="journal debits" /></td>
                <td className="r"><Amount value={totalOf(rows, 'credit')} currency="EUR" trace={{ kind: 'metric', id: 'credits' }} label="journal credits" /></td>
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

function InvoiceTable() {
  const { idx } = useDerived();
  const { cfg } = useApp();
  const [q, setQ] = useState('');
  const [dir, setDir] = useState('all');
  const [status, setStatus] = useState('all');
  const [questions, setQuestions] = useState(false);
  const [n, setN] = useState(PAGE);
  const withQuestions = useMemo(() => new Set(idx.invoices.filter((i) => i.decision_ids.length || (idx.txByInvoice.get(i.id) ?? []).some((t) => t.decision_ids?.length)).map((i) => i.id)), [idx]);
  const fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss');
  const rows = useMemo(() => {
    const s = fold(q.trim());
    return idx.invoices.filter((i) => (dir === 'all' || i.direction === dir) && (status === 'all' || i.payment.status === status) && (!questions || withQuestions.has(i.id)) &&
      (!s || fold(`${i.id} ${i.partner_name} ${i.description}`).includes(s)));
  }, [idx, q, dir, status, questions, withQuestions]);
  const statuses = [...new Set(idx.invoices.map((i) => i.payment.status))];
  return (
    <section className="panel" aria-label="Invoices">
      <div className="panel-pad stack">
        <div className="filters" role="search">
          <label className="sr-only" htmlFor="inv-q">Search invoices</label>
          <input id="inv-q" type="search" className="input" placeholder="Number, partner or description" value={q} onChange={(e) => { setQ(e.target.value); setN(PAGE); }} />
          <label className="sr-only" htmlFor="inv-dir">Direction</label>
          <select id="inv-dir" className="select" value={dir} onChange={(e) => { setDir(e.target.value); setN(PAGE); }}>
            <option value="all">Sales and purchases</option><option value="receivable">Sales ({cfg.words.customers})</option><option value="payable">Purchases ({cfg.words.suppliers})</option>
          </select>
          <label className="sr-only" htmlFor="inv-st">Payment status</label>
          <select id="inv-st" className="select" value={status} onChange={(e) => { setStatus(e.target.value); setN(PAGE); }}>
            <option value="all">Any payment status</option>{statuses.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
          </select>
          <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={questions} onChange={(e) => { setQuestions(e.target.checked); setN(PAGE); }} /> With open questions ({withQuestions.size})</label>
          <span className="muted" role="status">{rows.length.toLocaleString(cfg.numberLocale)} invoices</span>
        </div>
      </div>
      {rows.length === 0 ? <p className="empty">No invoices match. Clear the search or filters to see all {idx.invoices.length.toLocaleString(cfg.numberLocale)}.</p> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th scope="col">Number</th><th scope="col">Date</th><th scope="col">Partner</th><th scope="col">Account</th><th scope="col">Booked by</th><th scope="col">Payment</th><th scope="col" className="r">Gross</th></tr></thead>
            <tbody>
              {rows.slice(0, n).map((i) => (
                <tr key={i.id}>
                  <td><Ref target={{ kind: 'invoice', id: i.id }} /></td>
                  <td><DateText iso={i.date} /></td>
                  <td>{i.partner_name}</td>
                  <td className="code">{i.classification.account}</td>
                  <td>{decidedByLabel(i.classification.decided_by)}{i.classification.needs_review && <span className="tag attention" style={{ marginLeft: 6 }}>review</span>}</td>
                  <td>{statusLabel(i.payment.status)}</td>
                  <td className="r"><Amount value={toCents(i.original.gross.amount)} currency={i.original.gross.currency} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {rows.length > n && <div className="panel-pad row"><span className="muted">Showing {n} of {rows.length.toLocaleString(cfg.numberLocale)}.</span><button type="button" className="btn small" onClick={() => setN(n + PAGE * 2)}>Show {Math.min(PAGE * 2, rows.length - n)} more</button></div>}
    </section>
  );
}

function BankTable() {
  const { idx } = useDerived();
  const { cfg } = useApp();
  const [kind, setKind] = useState('all');
  const [n, setN] = useState(PAGE);
  const kinds = [...new Set(idx.bank.map((t) => t.match?.kind ?? 'none'))];
  const rows = idx.bank.filter((t) => kind === 'all' || (t.match?.kind ?? 'none') === kind);
  return (
    <section className="panel" aria-label="Bank transactions">
      <div className="panel-pad filters">
        <label htmlFor="bank-kind" className="strong">Show</label>
        <select id="bank-kind" className="select" value={kind} onChange={(e) => { setKind(e.target.value); setN(PAGE); }}>
          {['all', ...kinds].map((k) => <option key={k} value={k}>{k === 'all' ? 'All transactions' : k === 'none' ? 'Not matched' : matchLabel(k)} ({(k === 'all' ? idx.bank : idx.bank.filter((t) => (t.match?.kind ?? 'none') === k)).length.toLocaleString(cfg.numberLocale)})</option>)}
        </select>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th scope="col">Transaction</th><th scope="col">Date</th><th scope="col">Counterparty</th><th scope="col">Reference</th><th scope="col">Matched to</th><th scope="col" className="r">Amount</th></tr></thead>
          <tbody>
            {rows.slice(0, n).map((t) => (
              <tr key={t.id}>
                <td><Ref target={{ kind: 'tx', id: t.id }} /></td>
                <td><DateText iso={t.booking_date} /></td>
                <td>{t.counterparty_name}</td>
                <td className="code">{t.reference}</td>
                <td>{t.match ? <>{matchLabel(t.match.kind)}{t.match.invoices.map((i) => <span key={i}> <Ref target={{ kind: 'invoice', id: i }} /></span>)}</> : <span className="tag attention">Not matched</span>}</td>
                <td className="r"><Amount value={toCents(t.amount.amount)} currency={t.amount.currency} signed /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > n && <div className="panel-pad row"><span className="muted">Showing {n} of {rows.length.toLocaleString(cfg.numberLocale)}.</span><button type="button" className="btn small" onClick={() => setN(n + PAGE * 2)}>Show {Math.min(PAGE * 2, rows.length - n)} more</button></div>}
    </section>
  );
}
