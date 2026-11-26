import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { invoiceOf, isSettled, moneyOf, type DecisionGroup } from '../../domain/decisions';
import { sum, toCents } from '../../domain/money';
import { batchOf } from '../../domain/store';
import type { Decision } from '../../domain/types';
import { ACCOUNT_PLAIN, Amount, DateText, Ref, pct } from '../../ui/components';
import { useApp } from '../../ui/state';
import { useAnswerActions } from './shared';

/** Many similar questions about expense accounts, reviewed per description and decided together. */
export function ClassificationReview({ g }: { g: DecisionGroup }) {
  return (
    <div className="divided">
      {g.clusters.map((c) => <Cluster key={c.key} label={c.label} decisions={c.decisions} />)}
    </div>
  );
}

function Cluster({ label, decisions }: { label: string; decisions: Decision[] }) {
  const { work, data, cfg, role } = useApp();
  const { answer } = useAnswerActions();
  const idx = data.idx!;
  const uid = useId();
  const canDecide = cfg.roles[role].canDecide && !work.signedOff;
  const rows = useMemo(() => decisions.map((d) => ({ d, inv: invoiceOf(d, idx)!, net: moneyOf(d, idx)?.value ?? 0n })), [decisions, idx]);
  const open = rows.filter((r) => !isSettled(work.answers[r.d.id]));
  const [selected, setSelected] = useState<Set<string>>(() => new Set(open.map((r) => r.d.id)));
  const [account, setAccount] = useState<string>('');
  // Rows reopened by an undo come back selected, so re-booking them is one step.
  const openKey = open.map((r) => r.d.id).join(',');
  const prevOpen = useRef<Set<string>>(new Set(open.map((r) => r.d.id)));
  useEffect(() => {
    const now = new Set(open.map((r) => r.d.id));
    const reopened = [...now].filter((id) => !prevOpen.current.has(id));
    if (reopened.length) setSelected((s) => new Set([...s, ...reopened]));
    prevOpen.current = now;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openKey]);

  const options = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of decisions) for (const o of d.options) m.set(o.id, o.label);
    return [...m.keys()];
  }, [decisions]);
  const spread = useMemo(() => {
    const m = new Map<string, number>();
    for (const { d } of rows) if (d.suggested_option) m.set(d.suggested_option, (m.get(d.suggested_option) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [rows]);
  const suppliers = new Set(rows.map((r) => r.inv.partner_id)).size;
  const sameSupplierConflict = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const { d, inv } of rows) if (d.suggested_option) (m.get(inv.partner_id) ?? m.set(inv.partner_id, new Set()).get(inv.partner_id)!).add(d.suggested_option);
    return [...m.values()].some((s) => s.size > 1);
  }, [rows]);

  const chosen = rows.filter((r) => selected.has(r.d.id) && !isSettled(work.answers[r.d.id]));
  const moving = account ? chosen.filter((r) => r.inv.classification.account !== account) : [];
  const toggleAll = (on: boolean) => setSelected(on ? new Set(open.map((r) => r.d.id)) : new Set());

  const apply = () => {
    if (!account || !chosen.length) return;
    const batch = `${Date.now()}-${account}`;
    answer(chosen.map((r) => ({ id: r.d.id, optionId: account })), `Booked ${chosen.length} “${label}” invoices to ${account} ${ACCOUNT_PLAIN[account] ?? ''}.`, chosen.length > 1 ? batch : undefined);
    setSelected(new Set()); setAccount('');
  };

  const batches = useMemo(() => {
    const seen = new Map<string, { ids: string[]; account: string }>();
    for (const { d } of rows) {
      const a = work.answers[d.id];
      if (!a) continue;
      const key = a.batch ?? d.id;
      if (!seen.has(key)) seen.set(key, { ids: batchOf(work, d.id).filter((id) => rows.some((r) => r.d.id === id)), account: a.optionId });
    }
    return [...seen.values()];
  }, [rows, work]);

  return (
    <section className="work-body stack" aria-labelledby={`${uid}-h`}>
      <div className="spread">
        <h3 id={`${uid}-h`}>“{label}”</h3>
        <span className="muted">{rows.length} invoices from {suppliers} suppliers · <Amount value={sum(rows.map((r) => r.net))} currency="EUR" /> net</span>
      </div>

      <div>
        <p><strong>What the model suggested:</strong> {spread.map(([acc, n], k) => <span key={acc}>{k > 0 && ', '}{acc} {ACCOUNT_PLAIN[acc] ?? idx.accountById.get(acc)?.name} ({n})</span>)}.</p>
        {spread.length > 1 && (
          <p className="measure" style={{ color: 'var(--warn)' }}>
            {spread.length} different accounts for the same description{sameSupplierConflict ? ', including different answers for the same supplier' : ''}. The model only sees the description and the supplier category, so these suggestions do not tell you which account is right. Decide what this cost is and book the invoices together.
          </p>
        )}
      </div>

      {batches.length > 0 && (
        <ul className="stack-2" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {batches.map((b) => <BatchLine key={b.ids[0]} ids={b.ids} account={b.account} />)}
        </ul>
      )}

      {open.length > 0 && (
        <>
          <div className="table-wrap" style={{ maxHeight: 420, overflowY: 'auto', border: '1px solid var(--line)', borderRadius: 'var(--r-control)' }}>
            <table className="table">
              <caption className="sr-only">Open invoices for “{label}”</caption>
              <thead>
                <tr>
                  <th scope="col"><input type="checkbox" aria-label={`Select all ${open.length} open invoices`} checked={open.every((r) => selected.has(r.d.id))} onChange={(e) => toggleAll(e.target.checked)} disabled={!canDecide} /></th>
                  <th scope="col">Invoice</th><th scope="col">Supplier</th><th scope="col">Date</th><th scope="col" className="r">Net</th>
                  <th scope="col">Booked now (model)</th><th scope="col" className="r">Confidence</th>
                </tr>
              </thead>
              <tbody>
                {open.map(({ d, inv, net }) => (
                  <tr key={d.id} className={selected.has(d.id) ? 'selected' : undefined}>
                    <td><input type="checkbox" aria-label={`Select ${inv.id}`} checked={selected.has(d.id)} disabled={!canDecide}
                      onChange={(e) => setSelected((s) => { const n = new Set(s); if (e.target.checked) n.add(d.id); else n.delete(d.id); return n; })} /></td>
                    <td><Ref target={{ kind: 'invoice', id: inv.id }} /></td>
                    <td>{inv.partner_name}</td>
                    <td><DateText iso={inv.date} /></td>
                    <td className="r"><Amount value={net} currency="EUR" /></td>
                    <td>{inv.classification.account} {ACCOUNT_PLAIN[inv.classification.account] ?? inv.classification.account_name}</td>
                    <td className="r">{d.confidence !== undefined ? pct(d.confidence) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {canDecide && (
            <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
              <legend className="strong" style={{ marginBottom: 8 }}>Which account are the selected invoices?</legend>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 8 }}>
                {options.map((acc) => (
                  <label key={acc} className="choice" style={{ marginTop: 0 }}>
                    <input type="radio" name={`${uid}-acc`} checked={account === acc} onChange={() => setAccount(acc)} />
                    <span>
                      <strong>{acc}</strong> {ACCOUNT_PLAIN[acc] ?? ''}
                      <span className="hint" style={{ display: 'block' }} lang="de">{idx.accountById.get(acc)?.name}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}

          {canDecide && (
            <div className="effect" aria-live="polite">
              {!chosen.length ? 'Select the invoices to book.' : !account ? `${chosen.length} selected. Choose an account to see what changes.` : (
                <>
                  <strong>Book {chosen.length} invoices to {account} {ACCOUNT_PLAIN[account]}.</strong>{' '}
                  {moving.length} move from other accounts (<Amount value={sum(moving.map((r) => r.net))} currency="EUR" /> net); {chosen.length - moving.length} are already there.
                  {' '}Total expenses and VAT stay the same; only the profit-and-loss line changes.
                </>
              )}
            </div>
          )}
          {canDecide && (
            <div className="row">
              <button type="button" className="btn primary" disabled={!account || !chosen.length} onClick={apply}>
                {account && chosen.length ? `Book ${chosen.length} invoices to ${account}` : 'Book selected invoices'}
              </button>
              <span className="disabled-reason">{!chosen.length ? 'Select at least one invoice.' : !account ? 'Choose an account.' : ''}</span>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function BatchLine({ ids, account }: { ids: string[]; account: string }) {
  const { data, work } = useApp();
  const { undo } = useAnswerActions();
  const net = sum(ids.map((id) => { const d = data.idx!.decisionById.get(id); return d?.amount_affected ? toCents(d.amount_affected.amount) : 0n; }));
  return (
    <li className="effect row" style={{ justifyContent: 'space-between' }}>
      <span><span className="status settled">Booked</span> {ids.length} invoices to <strong>{account} {ACCOUNT_PLAIN[account]}</strong> · <Amount value={net} currency="EUR" /> net</span>
      {!work.signedOff && <button type="button" className="btn small" onClick={() => undo(ids[0])}>{ids.length > 1 ? `Undo this booking (${ids.length})` : 'Change answer'}</button>}
    </li>
  );
}
