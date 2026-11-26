import { useState } from 'react';
import { who } from '../domain/config';
import { isDeferred, isSettled } from '../domain/decisions';
import { ConfirmDialog, DateText, Needs, Notice, PageHead, Status } from '../ui/components';
import { href } from '../ui/router';
import { useApp, useDerived } from '../ui/state';
import { STATUS_TEXT } from './Checks';

const ALL = ['summary', 'invoices', 'bank_transactions', 'decisions', 'partners', 'accounts'] as const;

export function SignOff() {
  return <Needs eps={[...ALL]}>{() => <SignOffInner />}</Needs>;
}

function SignOffInner() {
  const { groups, findings, status, progress, blocking, ready } = useDerived();
  const { work, dispatch, role, cfg, showToast, setRole } = useApp();
  const [confirming, setConfirming] = useState<'sign' | 'reopen' | null>(null);
  const signed = work.signedOff;
  const canSign = cfg.roles[role].canSignOff;
  const advisor = who(cfg, 'tax_advisor');

  const requiredGroups = groups.filter((g) => g.config.blocksSignOff);
  const optionalGroups = groups.filter((g) => !g.config.blocksSignOff);
  const verifications = findings.filter((f) => f.kind === 'verification');
  const attention = findings.filter((f) => f.kind === 'finding' && f.needsAttention);
  const acknowledged = attention.filter((f) => status(f) === 'acknowledged');
  const optionalOpen = optionalGroups.reduce((n, g) => n + g.decisions.filter((d) => !isSettled(work.answers[d.id])).length, 0);
  const failedVerifications = verifications.filter((f) => status(f) === 'failed');

  const reasons: { text: string; to: string }[] = [];
  for (const g of requiredGroups) {
    const open = g.decisions.filter((d) => !isSettled(work.answers[d.id]));
    if (!open.length) continue;
    const deferred = open.filter((d) => isDeferred(work.answers[d.id])).length;
    reasons.push({ text: `${g.config.title}: ${open.length} of ${g.decisions.length} not settled${deferred ? ` (${deferred} waiting for someone else)` : ''}`, to: href('decisions', g.config.id) });
  }
  for (const f of blocking) reasons.push({ text: `${f.title}: ${f.kind === 'verification' ? 'verification failed' : f.decisionIds?.length ? 'resolve it through its decision' : 'acknowledge or resolve it'}`, to: href('checks', f.id) });

  const headline = signed ? 'Signed off' : ready ? 'Ready to sign off' : `Not ready: ${reasons.length} ${reasons.length === 1 ? 'thing' : 'things'} left`;

  return (
    <div className="stack-6">
      <PageHead title="Sign-off">
        Signing off confirms the migrated books are complete enough to hand to your {advisor}. Items allowed to stay open go with them, listed.
      </PageHead>

      <section className="panel panel-pad stack" aria-labelledby="readiness">
        <div className="spread">
          <h2 id="readiness">{headline}</h2>
          {signed
            ? <Status kind="settled">Signed off by the {who(cfg, signed.by)}, <DateText iso={signed.at} time /></Status>
            : ready ? <Status kind="settled">Everything required is settled</Status> : <Status kind="blocking">Sign-off blocked</Status>}
        </div>
        {!signed && !ready && (
          <ul className="stack-2" style={{ margin: 0, paddingLeft: 20 }}>
            {reasons.map((r) => <li key={r.text}><a href={r.to}>{r.text}</a></li>)}
          </ul>
        )}
        {!signed && canSign && (
          <div className="row">
            <button type="button" className="btn primary" disabled={!ready} onClick={() => setConfirming('sign')}>Sign off the migration</button>
            {!ready && <span className="disabled-reason">Settle {progress.blockingOpen ? `${progress.blockingOpen} required ${progress.blockingOpen === 1 ? 'decision' : 'decisions'}` : ''}{progress.blockingOpen && blocking.length ? ' and ' : ''}{blocking.length ? `${blocking.length} ${blocking.length === 1 ? 'check' : 'checks'}` : ''} first.</span>}
          </div>
        )}
        {signed && canSign && (
          <div className="row">
            {work.advisorInvited
              ? <Status kind="settled">Access for your {advisor} recorded <DateText iso={work.advisorInvited} time /></Status>
              : <button type="button" className="btn primary" onClick={() => { dispatch({ t: 'invite', by: role }); showToast({ text: `Read-only access for your ${advisor} recorded. In this prototype no e-mail is sent.` }); }}>Give your {advisor} read-only access</button>}
            <button type="button" className="btn" onClick={() => setRole('tax_advisor')}>See what they see</button>
            <button type="button" className="btn quiet" onClick={() => setConfirming('reopen')}>Reopen the migration</button>
          </div>
        )}
      </section>

      <div className="grid-2" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 340px), 1fr))', gap: 24, alignItems: 'start' }}>
        <section className="panel" aria-labelledby="req">
          <header className="panel-head"><h3 id="req">Required decisions</h3><span className="muted">{progress.requiredSettled} of {progress.required} settled</span></header>
          <table className="table"><tbody>
            {requiredGroups.map((g) => {
              const left = g.decisions.filter((d) => !isSettled(work.answers[d.id])).length;
              return (
                <tr key={g.config.id}>
                  <td><a href={href('decisions', g.config.id)}>{g.config.title}</a></td>
                  <td className="r">{left ? <Status kind="open">{left} left</Status> : <Status kind="settled">Settled</Status>}</td>
                </tr>
              );
            })}
          </tbody></table>
        </section>

        <section className="panel" aria-labelledby="ver">
          <header className="panel-head"><h3 id="ver">Verifications</h3><span className="muted">{verifications.length - failedVerifications.length} of {verifications.length} passed</span></header>
          <table className="table"><tbody>
            {verifications.map((f) => { const [k, t] = STATUS_TEXT[status(f)]; return <tr key={f.id}><td><a href={href('checks', f.id)}>{f.title}</a></td><td className="r"><Status kind={k}>{t}</Status></td></tr>; })}
          </tbody></table>
        </section>

        <section className="panel" aria-labelledby="fin">
          <header className="panel-head"><h3 id="fin">Findings</h3><span className="muted">resolve, or acknowledge as open</span></header>
          <table className="table"><tbody>
            {attention.map((f) => { const [k, t] = STATUS_TEXT[status(f)]; return <tr key={f.id}><td><a href={href('checks', f.id)}>{f.title}</a></td><td className="r"><Status kind={k}>{t}</Status></td></tr>; })}
          </tbody></table>
        </section>

        <section className="panel" aria-labelledby="open">
          <header className="panel-head"><h3 id="open">Allowed to stay open</h3><span className="muted">go to your {advisor}</span></header>
          <table className="table"><tbody>
            {optionalGroups.map((g) => {
              const left = g.decisions.filter((d) => !isSettled(work.answers[d.id])).length;
              return <tr key={g.config.id}><td><a href={href('decisions', g.config.id)}>{g.config.title}</a></td><td className="r num">{left ? `${left} open` : 'Settled'}</td></tr>;
            })}
            {acknowledged.map((f) => <tr key={f.id}><td><a href={href('checks', f.id)}>{f.title}</a></td><td className="r"><Status kind="neutral">Acknowledged</Status></td></tr>)}
          </tbody></table>
        </section>
      </div>

      {confirming === 'sign' && (
        <ConfirmDialog title="Sign off the migration?" confirmLabel="Sign off" onCancel={() => setConfirming(null)}
          onConfirm={() => { dispatch({ t: 'signOff', by: role, openOptional: optionalOpen }); setConfirming(null); showToast({ text: 'Migration signed off. Answers are locked.' }); }}>
          <p>You confirm that:</p>
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            <li>all {progress.required} required decisions are settled,</li>
            <li>all {verifications.length} verifications passed,</li>
            <li>{attention.length - acknowledged.length} findings are resolved{acknowledged.length ? ` and ${acknowledged.length} are acknowledged as open items` : ''}.</li>
          </ul>
          <p>{optionalOpen} optional {optionalOpen === 1 ? 'question stays' : 'questions stay'} open{acknowledged.length ? `, together with ${acknowledged.length} acknowledged ${acknowledged.length === 1 ? 'finding' : 'findings'},` : ''} and {optionalOpen + acknowledged.length === 1 ? 'is' : 'are'} listed for your {advisor}.</p>
          <p>Answers are locked after signing. You can reopen the migration later; reopening is recorded in the decision log.</p>
        </ConfirmDialog>
      )}
      {confirming === 'reopen' && (
        <ConfirmDialog title="Reopen the migration?" confirmLabel="Reopen" tone="danger" onCancel={() => setConfirming(null)}
          onConfirm={() => { dispatch({ t: 'reopen', by: role }); setConfirming(null); showToast({ text: 'Migration reopened. Answers can be changed again.' }); }}>
          <p>The sign-off is withdrawn and answers can be changed again. Your {advisor}'s access is withdrawn until you sign off again. This is recorded in the decision log.</p>
        </ConfirmDialog>
      )}
      {signed && <Notice tone="info">The {advisor} sees the books, every source row, the checks and this log, read-only. Customer and supplier contact details are masked for them.</Notice>}
    </div>
  );
}
