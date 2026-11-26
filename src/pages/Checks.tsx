import { useEffect } from 'react';
import { canAcknowledge, type CheckStatus, type Finding } from '../domain/checks';
import { who } from '../domain/config';
import { toCents } from '../domain/money';
import { optionLabel } from './decisions/shared';
import { Amount, DateText, Needs, PageHead, Ref, Status, type StatusKind } from '../ui/components';
import { href } from '../ui/router';
import { useApp, useDerived } from '../ui/state';

const ALL = ['summary', 'invoices', 'bank_transactions', 'decisions', 'partners', 'accounts'] as const;

export const STATUS_TEXT: Record<CheckStatus, [StatusKind, string]> = {
  passed: ['settled', 'Verified'],
  failed: ['blocking', 'Failed'],
  open: ['open', 'Needs you'],
  acknowledged: ['neutral', 'Acknowledged, still open'],
  resolved: ['settled', 'Resolved'],
  info: ['info', 'For information'],
};

export function Checks({ findingId }: { findingId?: string }) {
  return <Needs eps={[...ALL]}>{() => <ChecksInner findingId={findingId} />}</Needs>;
}

function ChecksInner({ findingId }: { findingId?: string }) {
  const { findings, status, blocking } = useDerived();
  const { cfg, role } = useApp();
  const lead = cfg.roles[role].canDecide;
  const attention = findings.filter((f) => f.kind === 'finding' && f.needsAttention);
  const verified = findings.filter((f) => f.kind === 'verification');
  const info = findings.filter((f) => f.kind === 'finding' && !f.needsAttention);
  const current = findings.find((f) => f.id === findingId) ?? blocking[0] ?? attention[0] ?? findings[0];
  const counts = (fs: Finding[], s: CheckStatus) => fs.filter((f) => status(f) === s).length;

  useEffect(() => {
    if (findingId && !findings.some((f) => f.id === findingId)) history.replaceState(null, '', href('checks'));
  }, [findingId, findings]);

  return (
    <div>
      <PageHead title="Checks">
        Every total the engine reports was recomputed from the individual records, and the result was checked for problems no question covers.
        {' '}{verified.length - counts(verified, 'failed')} of {verified.length} verifications passed; {blocking.length ? `${blocking.length} findings ${lead ? 'need you' : `are open for the ${who(cfg, 'finance_lead')}`} before sign-off.` : 'no finding blocks sign-off.'}
      </PageHead>
      <div className="workspace">
        <nav className="panel queue" aria-label="Checks">
          <CheckList title={lead ? 'Need you before sign-off' : 'Findings'} fs={attention} current={current} />
          <CheckList title="Verified" fs={verified} current={current} />
          <CheckList title="For information" fs={info} current={current} />
        </nav>
        {current && <CheckDetail key={current.id} f={current} />}
      </div>
    </div>
  );
}

function CheckList({ title, fs, current }: { title: string; fs: Finding[]; current?: Finding }) {
  const { status } = useDerived();
  if (!fs.length) return null;
  return (
    <section aria-label={title}>
      <h2>{title}</h2>
      <ul>
        {fs.map((f) => {
          const [kind, text] = STATUS_TEXT[status(f)];
          return (
            <li key={f.id}>
              <a href={href('checks', f.id)} aria-current={current === f ? 'true' : undefined}>
                <span className="q-title" style={{ gridColumn: '1 / -1' }}>{f.title}</span>
                <span className="q-meta"><Status kind={kind}>{text}</Status></span>
              </a>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function CheckDetail({ f }: { f: Finding }) {
  const { status, groups, idx } = useDerived();
  const { work, dispatch, role, cfg, showToast } = useApp();
  const s = status(f);
  const [kind, text] = STATUS_TEXT[s];
  const ack = work.acks[f.id];
  const canAct = cfg.roles[role].canDecide && !work.signedOff;
  const group = groups.find((g) => g.config.id === f.groupId);
  const decided = (f.decisionIds ?? []).map((id) => [id, work.answers[id]] as const).filter(([, a]) => a);

  return (
    <article className="panel" aria-labelledby="finding-title">
      <header className="work-head stack-2">
        <Status kind={kind}>{text}</Status>
        <h2 id="finding-title">{f.title}</h2>
        {f.amount && <p><strong><Amount value={f.amount.value} currency={f.amount.currency} /></strong> <span className="muted">{f.amount.label}</span>{f.affected && <span className="muted"> · {f.affected.count} {f.affected.noun}</span>}</p>}
      </header>
      <div className="work-body stack">
        <dl className="qa">
          <dt>What we found</dt><dd className="measure">{f.detail}</dd>
          {f.why && <><dt>Why it matters</dt><dd className="measure">{f.why}</dd></>}
          {f.next && s !== 'resolved' && s !== 'passed' && <><dt>Next step</dt><dd className="measure">{f.next}</dd></>}
          <dt>Status</dt>
          <dd className="measure">
            {s === 'passed' && 'Verified from the records. Nothing to do.'}
            {s === 'failed' && 'This verification failed. Sign-off is blocked until it is explained.'}
            {s === 'info' && 'Context only. It does not block sign-off.'}
            {s === 'open' && (!canAcknowledge(f, work.answers) ? 'Open. It is resolved when the related decision is settled.' : f.decisionIds?.length ? (f.followUp ?? 'Open.') : 'Open. Acknowledge it to carry it as an open item; it is not fixed by doing so.')}
            {s === 'acknowledged' && ack && <>Acknowledged by the {who(cfg, ack.by)} on <DateText iso={ack.at} time />. The underlying issue is <strong>still open</strong> and will be listed for your tax advisor.</>}
            {s === 'resolved' && <>Resolved by your answers{decided.length === 1 && <>: {optionLabel(idx.decisionById.get(decided[0][0])!, decided[0][1]!.optionId)}{decided[0][1]!.value && <> (<span className="code">{decided[0][1]!.value}</span>)</>}</>}{decided.length > 1 && ` to ${decided.length} questions`}.</>}
          </dd>
        </dl>

        <div className="row">
          {group && s !== 'resolved' && <a className="btn primary" href={href('decisions', group.config.id)}>Open the decision: {group.config.title}</a>}
          {group && s === 'resolved' && <a className="btn" href={href('decisions', group.config.id)}>Review the answers</a>}
          {canAct && canAcknowledge(f, work.answers) && s !== 'resolved' && f.needsAttention && f.kind === 'finding' && (
            ack
              ? <button type="button" className="btn" onClick={() => { dispatch({ t: 'ack', id: f.id, on: false, by: role }); showToast({ text: 'Acknowledgement withdrawn. The finding needs you again.' }); }}>Withdraw acknowledgement</button>
              : <button type="button" className="btn primary" onClick={() => { dispatch({ t: 'ack', id: f.id, on: true, by: role }); showToast({ text: 'Acknowledged. It stays open and is listed for your tax advisor.', undo: () => dispatch({ t: 'ack', id: f.id, on: false, by: role }) }); }}>Acknowledge as an open item</button>
          )}
        </div>

        <section>
          <h3 style={{ marginBottom: 8 }}>Records behind this ({f.items.length})</h3>
          <EvidenceList f={f} />
        </section>
      </div>
    </article>
  );
}

function EvidenceList({ f }: { f: Finding }) {
  const { idx, metrics } = useDerived();
  const shown = f.items.slice(0, 50);
  return (
    <div className="table-wrap">
      <table className="table">
        <tbody>
          {shown.map((t) => {
            const inv = t.kind === 'invoice' ? idx.invoiceById.get(t.id) : undefined;
            const dec = t.kind === 'decision' ? idx.decisionById.get(t.id) : undefined;
            return (
              <tr key={`${t.kind}:${t.id}`}>
                <td><Ref target={t}>{t.kind === 'metric' ? metrics[t.id].label : t.kind === 'partner' ? idx.partnerById.get(t.id)?.name : undefined}</Ref></td>
                <td>{inv?.partner_name ?? dec?.title ?? (t.kind === 'partner' ? 'Customer record' : '')}</td>
                <td className="r">{inv && <Amount value={toCents(inv.original.gross.amount)} currency={inv.original.gross.currency} />}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {f.items.length > shown.length && <p className="cap muted" style={{ marginTop: 8 }}>Showing the first {shown.length} of {f.items.length}. Open the related decision to work through all of them.</p>}
    </div>
  );
}
