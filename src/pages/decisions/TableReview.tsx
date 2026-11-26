import { Fragment, useId, useMemo, useState, type ReactNode } from 'react';
import { invoiceOf, isDeferred, isSettled, moneyOf, type DecisionGroup } from '../../domain/decisions';
import { valueSpecFor } from '../../domain/inputs';
import { abs, sum, toCents } from '../../domain/money';
import type { BankTransaction, Decision, Indexed } from '../../domain/types';
import { Amount, DateText, Ref } from '../../ui/components';
import { useApp } from '../../ui/state';
import { AnsweredLine, DecisionForm, optionLabel, PROTOTYPE_NOTE, useAnswerActions } from './shared';

interface Col { head: string; right?: boolean; cell: (d: Decision) => ReactNode }

function txOf(d: Decision, idx: Indexed): BankTransaction | undefined {
  for (const r of d.references) if ('transaction' in r) return idx.txById.get(r.transaction);
  return undefined;
}
/** What the bank shows was paid against an invoice (absolute, in the invoice currency). */
function paidByBank(invoiceId: string, idx: Indexed) {
  return abs(sum((idx.txByInvoice.get(invoiceId) ?? []).map((t) => toCents(t.amount.amount))));
}

function columnsFor(type: string, idx: Indexed): Col[] {
  const money = (d: Decision) => { const m = moneyOf(d, idx); return m ? <Amount value={m.value} currency={m.currency} /> : '—'; };
  switch (type) {
    case 'rounding_difference':
      return [
        { head: 'Invoice', cell: (d) => { const i = invoiceOf(d, idx); return i ? <Ref target={{ kind: 'invoice', id: i.id }} /> : '—'; } },
        { head: 'Supplier', cell: (d) => invoiceOf(d, idx)?.partner_name },
        { head: 'Net + VAT (booked)', right: true, cell: (d) => { const i = invoiceOf(d, idx)!; return <Amount value={toCents(i.booked.gross.amount)} currency={i.booked.gross.currency} />; } },
        { head: 'Gross in export', right: true, cell: (d) => { const i = invoiceOf(d, idx)!; const h = i.history[i.history.length - 1]; return <Amount value={abs(toCents(h.gross_in_export.amount))} currency={h.gross_in_export.currency} />; } },
        { head: 'Paid via bank', right: true, cell: (d) => { const i = invoiceOf(d, idx)!; const p = paidByBank(i.id, idx); const h = toCents(i.history[i.history.length - 1].gross_in_export.amount); return <span>{p ? <Amount value={p} currency={i.original.gross.currency} /> : '—'} {p && p === abs(h) ? <span className="cap muted">= export</span> : null}</span>; } },
      ];
    case 'overpayment':
      return [
        { head: 'Invoice', cell: (d) => { const i = d.references.find((r) => 'invoice' in r) as { invoice: string } | undefined; return i ? <Ref target={{ kind: 'invoice', id: i.invoice }} /> : '—'; } },
        { head: 'Customer', cell: (d) => txOf(d, idx)?.counterparty_name },
        { head: 'Paid', right: true, cell: (d) => { const t = txOf(d, idx); return t ? <Amount value={abs(toCents(t.amount.amount))} currency={t.currency} /> : '—'; } },
        { head: 'Extra', right: true, cell: money },
      ];
    default:
      return [
        { head: 'Payment', cell: (d) => { const t = txOf(d, idx); return t ? <Ref target={{ kind: 'tx', id: t.id }} /> : '—'; } },
        { head: 'Date', cell: (d) => { const t = txOf(d, idx); return t ? <DateText iso={t.booking_date} /> : '—'; } },
        { head: type === 'unexplained_refund' ? 'To' : 'From', cell: (d) => txOf(d, idx)?.counterparty_name },
        { head: 'Reference', cell: (d) => <span className="code">{txOf(d, idx)?.reference || '—'}</span> },
        { head: 'Amount', right: true, cell: money },
      ];
  }
}

/** Data-driven context for the whole table, where the evidence says something the suggestion does not. */
function Insight({ g, idx }: { g: DecisionGroup; idx: Indexed }) {
  if (g.config.match.type !== 'rounding_difference') return null;
  const rows = g.decisions.map((d) => invoiceOf(d, idx)!).filter(Boolean);
  const paidExport = rows.filter((i) => { const p = paidByBank(i.id, idx); return p > 0n && p === abs(toCents(i.history[i.history.length - 1].gross_in_export.amount)); });
  if (!paidExport.length) return null;
  return (
    <p className="measure notice attention" style={{ display: 'block' }}>
      <strong>Check before accepting the suggestion.</strong> For {paidExport.length} of {rows.length} invoices, the bank shows you paid the export's gross, not net plus VAT.
      {' '}With “Use net + VAT”, those invoices stay one cent off what you paid. “Use the gross from the export” matches the payment.
    </p>
  );
}

export function TableReview({ g }: { g: DecisionGroup }) {
  const { work, data, cfg, role } = useApp();
  const { answer, undo } = useAnswerActions();
  const idx = data.idx!;
  const uid = useId();
  const canDecide = cfg.roles[role].canDecide && !work.signedOff;
  const cols = useMemo(() => columnsFor(g.config.match.type, idx), [g, idx]);
  const open = g.decisions.filter((d) => !work.answers[d.id]);
  const answered = g.decisions.filter((d) => work.answers[d.id]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [option, setOption] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  // Bulk only for options that need no extra input.
  const bulkOptions = useMemo(() => {
    const ids = new Map<string, string>();
    for (const d of g.decisions) for (const o of d.options) if (!valueSpecFor(d, o.id, idx)) ids.set(o.id, o.label);
    return [...ids.entries()];
  }, [g, idx]);
  const chosen = open.filter((d) => selected.has(d.id) && d.options.some((o) => o.id === option));

  const apply = () => {
    if (!option || !chosen.length) return;
    answer(chosen.map((d) => ({ id: d.id, optionId: option })), `${optionLabel(chosen[0], option)}: saved for ${chosen.length} ${chosen.length === 1 ? 'item' : 'items'}.`, chosen.length > 1 ? `${Date.now()}-${option}` : undefined);
    setSelected(new Set()); setOption('');
  };

  return (
    <div className="work-body stack">
      <Insight g={g} idx={idx} />
      {open.length > 0 && (
        <div className="table-wrap" style={{ border: '1px solid var(--line)', borderRadius: 'var(--r-control)' }}>
          <table className="table">
            <caption className="sr-only">{open.length} open questions</caption>
            <thead>
              <tr>
                {canDecide && <th scope="col"><input type="checkbox" aria-label={`Select all ${open.length} open questions`} checked={open.every((d) => selected.has(d.id))} onChange={(e) => setSelected(e.target.checked ? new Set(open.map((d) => d.id)) : new Set())} /></th>}
                {cols.map((c) => <th key={c.head} scope="col" className={c.right ? 'r' : undefined}>{c.head}</th>)}
                <th scope="col">Engine suggestion</th>
                {canDecide && <th scope="col"><span className="sr-only">Decide one</span></th>}
              </tr>
            </thead>
            <tbody>
              {open.map((d) => (
                <Fragment key={d.id}>
                  <tr className={selected.has(d.id) ? 'selected' : undefined}>
                    {canDecide && <td><input type="checkbox" aria-label={`Select ${d.title}`} checked={selected.has(d.id)} onChange={(e) => setSelected((s) => { const n = new Set(s); if (e.target.checked) n.add(d.id); else n.delete(d.id); return n; })} /></td>}
                    {cols.map((c) => <td key={c.head} className={c.right ? 'r' : undefined}>{c.cell(d)}</td>)}
                    <td>{d.suggested_option ? optionLabel(d, d.suggested_option) : <span className="muted">None</span>}</td>
                    {canDecide && <td><button type="button" className="btn small" aria-expanded={expanded === d.id} onClick={() => setExpanded(expanded === d.id ? null : d.id)}>{expanded === d.id ? 'Close' : 'Decide'}</button></td>}
                  </tr>
                  {expanded === d.id && (
                    <tr><td colSpan={cols.length + 3} style={{ background: 'var(--surface-2)' }}>
                      <div style={{ padding: 8 }} className="stack-2">
                        <p><strong>{d.question}</strong></p>
                        {d.why_suggested && <p className="muted">Engine: {d.why_suggested}</p>}
                        <DecisionForm d={d} onDone={() => setExpanded(null)} />
                      </div>
                    </td></tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {canDecide && open.length > 0 && (
        <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="strong" style={{ marginBottom: 8 }}>Answer the selected questions together</legend>
          <div className="row" style={{ alignItems: 'stretch' }}>
            {bulkOptions.map(([id, label]) => (
              <label key={id} className="choice" style={{ marginTop: 0 }}>
                <input type="radio" name={`${uid}-bulk`} checked={option === id} onChange={() => setOption(id)} />
                <span>{label}{PROTOTYPE_NOTE[id] && <span className="hint" style={{ display: 'block' }}>{PROTOTYPE_NOTE[id]}</span>}</span>
              </label>
            ))}
          </div>
          <div className="row" style={{ marginTop: 12 }}>
            <button type="button" className="btn primary" disabled={!option || !chosen.length} onClick={apply}>
              {option && chosen.length ? `Apply to ${chosen.length} selected` : 'Apply to selected'}
            </button>
            <span className="disabled-reason">{!selected.size ? 'Select questions in the table, or use Decide on a single row.' : !option ? 'Choose an answer.' : ''}</span>
          </div>
        </fieldset>
      )}

      {answered.length > 0 && (
        <details open={open.length === 0}>
          <summary className="strong" style={{ cursor: 'pointer' }}>{answered.length} answered{answered.some((d) => isDeferred(work.answers[d.id])) ? `, ${answered.filter((d) => isDeferred(work.answers[d.id])).length} left open on purpose` : ''}</summary>
          <ul className="divided" style={{ listStyle: 'none', padding: 0, margin: '8px 0 0' }}>
            {answered.map((d) => (
              <li key={d.id} style={{ padding: '8px 0' }}>
                <div className="cap muted">{d.title}</div>
                <AnsweredLine d={d} a={work.answers[d.id]} onChange={() => undo(d.id)} />
                {!isSettled(work.answers[d.id]) && null}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
