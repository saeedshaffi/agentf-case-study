import { useMemo } from 'react';
import { who } from '../domain/config';
import { previewEffect } from '../domain/decisions';
import type { LogEntry } from '../domain/store';
import { ACCOUNT_PLAIN, Amount, DateText, Needs, PageHead, Ref, Status } from '../ui/components';
import { href } from '../ui/router';
import { useApp, useDerived } from '../ui/state';
import { optionLabel, RECORDED_EFFECT } from './decisions/shared';

const ALL = ['summary', 'invoices', 'bank_transactions', 'decisions', 'partners', 'accounts'] as const;

export function DecisionLog() {
  return <Needs eps={[...ALL]}>{() => <LogInner />}</Needs>;
}

/** One row per action: answers given together appear once, as the bulk action they were. */
function LogInner() {
  const { idx, progress, findings, status } = useDerived();
  const { work, cfg } = useApp();
  const lead = who(cfg, 'finance_lead');
  const rows = useMemo(() => {
    const out: { e: LogEntry; ids: string[] }[] = [];
    for (const e of work.log) {
      const last = out[out.length - 1];
      if (last && e.batch && last.e.batch === e.batch && e.action === last.e.action) last.ids.push(e.decisionId!);
      else out.push({ e, ids: e.decisionId ? [e.decisionId] : [] });
    }
    return out.reverse();
  }, [work.log]);
  const openItems = findings.filter((f) => status(f) === 'acknowledged');

  return (
    <div className="stack-6">
      <PageHead title="Decision log">
        Every answer the {lead} gave, when, and what it changed in the books. {progress.answered} of {progress.total} questions answered{work.signedOff ? <>; signed off <DateText iso={work.signedOff.at} time />.</> : '; not signed off yet.'}
      </PageHead>
      {openItems.length > 0 && (
        <section className="panel panel-pad stack-2" aria-labelledby="carried">
          <h2 id="carried">Acknowledged as open items</h2>
          <ul style={{ margin: 0, paddingLeft: 20 }}>{openItems.map((f) => <li key={f.id}><a href={href('checks', f.id)}>{f.title}</a></li>)}</ul>
        </section>
      )}
      <section className="panel" aria-label="Log entries">
        {rows.length === 0 ? <p className="empty">Nothing has been answered yet.</p> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th scope="col">When</th><th scope="col">Who</th><th scope="col">What</th><th scope="col">Effect on the books</th></tr></thead>
              <tbody>
                {rows.slice(0, 400).map(({ e, ids }, k) => {
                  const d = e.decisionId ? idx.decisionById.get(e.decisionId) : undefined;
                  const eff = d && e.optionId ? previewEffect(d, e.optionId, idx) : null;
                  const finding = e.findingId ? findings.find((f) => f.id === e.findingId) : undefined;
                  let what: React.ReactNode = null;
                  if (e.action === 'answered' && d) what = ids.length > 1
                    ? <>Answered {ids.length} questions together: <strong>{d.type === 'uncertain_classification' ? `booked to ${e.optionId} ${ACCOUNT_PLAIN[e.optionId!] ?? ''}` : optionLabel(d, e.optionId!)}</strong></>
                    : <><Ref target={{ kind: 'decision', id: d.id }} /> {d.title}: <strong>{optionLabel(d, e.optionId!)}</strong>{e.value && <> (<span className="code">{e.value}</span>)</>}</>;
                  if (e.action === 'undone' && d) what = <>Withdrew the answer to <Ref target={{ kind: 'decision', id: d.id }} />{ids.length > 1 ? ` and ${ids.length - 1} others` : ''}</>;
                  if (e.action === 'acknowledged') what = <>Acknowledged as an open item: {finding?.title ?? e.findingId}</>;
                  if (e.action === 'unacknowledged') what = <>Withdrew acknowledgement: {finding?.title ?? e.findingId}</>;
                  if (e.action === 'signed_off') what = <Status kind="settled">Signed off the migration</Status>;
                  if (e.action === 'reopened') what = <Status kind="open">Reopened the migration</Status>;
                  if (e.action === 'invited') what = <>Gave the {who(cfg, 'tax_advisor')} read-only access</>;
                  const effectLines = eff?.lines.length ? (ids.length > 1
                    ? <>Profit-and-loss lines change for {ids.length} invoices; totals unchanged</>
                    : eff.lines.map((l, j) => <span key={j}>{j > 0 && ' · '}<span className="code">{l.account}</span> <Amount value={l.delta} currency="EUR" signed /></span>)) : null;
                  return (
                    <tr key={k}>
                      <td><DateText iso={e.at} time /></td>
                      <td>{who(cfg, e.by)}</td>
                      <td>{what ?? e.action}</td>
                      <td className="muted">{e.action === 'answered' ? (effectLines ?? RECORDED_EFFECT[e.optionId ?? ''] ?? eff?.text) : '—'}</td>
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
