import { useEffect } from 'react';
import { STAKE_LABEL } from '../domain/config';
import { isSettled, type DecisionGroup } from '../domain/decisions';
import { Amount, Needs, Notice, PageHead } from '../ui/components';
import { href, navigate } from '../ui/router';
import { useApp, useDerived } from '../ui/state';
import { ClassificationReview } from './decisions/Classification';
import { CompareReview } from './decisions/Compare';
import { SingleReview } from './decisions/Single';
import { TableReview } from './decisions/TableReview';

const ALL = ['summary', 'invoices', 'bank_transactions', 'decisions', 'partners', 'accounts'] as const;

/** Which layout fits which kind of question. */
export function shapeOf(g: DecisionGroup): 'single' | 'compare' | 'classification' | 'table' {
  const t = g.config.match.type;
  if (t === 'possible_duplicate_partner') return 'compare';
  if (t === 'uncertain_classification') return 'classification';
  if (g.decisions.length > 3) return 'table';
  return 'single';
}

export function Decisions({ groupId }: { groupId?: string }) {
  return <Needs eps={[...ALL]}>{() => <Workspace groupId={groupId} />}</Needs>;
}

function Workspace({ groupId }: { groupId?: string }) {
  const { groups, progress } = useDerived();
  const { work } = useApp();
  const required = groups.filter((g) => g.config.blocksSignOff);
  const optional = groups.filter((g) => !g.config.blocksSignOff);
  const remaining = (g: DecisionGroup) => g.decisions.filter((d) => !isSettled(work.answers[d.id])).length;
  const firstOpen = required.find((g) => remaining(g) > 0) ?? optional.find((g) => remaining(g) > 0) ?? groups[0];
  const current = groups.find((g) => g.config.id === groupId);

  // No group in the URL: open the first one that still needs work (replace, so Back is not trapped).
  useEffect(() => {
    if (!current && firstOpen) history.replaceState(null, '', href('decisions', firstOpen.config.id));
    if (!current && firstOpen) window.dispatchEvent(new HashChangeEvent('hashchange'));
  }, [current, firstOpen]);

  const pctDone = progress.required ? Math.round((progress.requiredSettled / progress.required) * 100) : 100;

  return (
    <div>
      <PageHead
        title="Decisions"
        aside={
          <div style={{ minWidth: 260 }} aria-live="polite">
            <div className="spread"><strong>{progress.requiredSettled} of {progress.required} required</strong><span className="muted cap">{pctDone} %</span></div>
            <div className="meter" style={{ margin: '6px 0' }} aria-hidden><span style={{ width: `${pctDone}%` }} /></div>
            <div className="cap muted">{progress.optionalOpen} optional open; they can stay open</div>
          </div>
        }
      >
        The engine could not decide {progress.total} things on its own. {progress.required} must be settled before you can sign off; {progress.optional} can stay open and go to your tax advisor as open items.
      </PageHead>

      {work.signedOff && <div style={{ marginBottom: 16 }}><Notice tone="settled" title="Signed off">Answers are locked. Reopen the migration on the sign-off page to change them.</Notice></div>}

      <div className="workspace">
        <nav className="panel queue" aria-label="Decision groups">
          <QueueSection title="Needed for sign-off" groups={required} current={current} remaining={remaining} />
          <QueueSection title="Can stay open" groups={optional} current={current} remaining={remaining} />
        </nav>
        <div>{current ? <GroupWork key={current.config.id} g={current} /> : null}</div>
      </div>
    </div>
  );
}

function QueueSection({ title, groups, current, remaining }: { title: string; groups: DecisionGroup[]; current?: DecisionGroup; remaining: (g: DecisionGroup) => number }) {
  const { work } = useApp();
  const total = groups.reduce((n, g) => n + g.decisions.length, 0);
  const left = groups.reduce((n, g) => n + remaining(g), 0);
  if (!groups.length) return null;
  return (
    <section aria-label={title}>
      <h2>{title} · {left ? `${left} of ${total} left` : 'all done'}</h2>
      <ul>
        {groups.map((g) => {
          const r = remaining(g);
          const deferred = g.decisions.filter((d) => work.answers[d.id] && !isSettled(work.answers[d.id])).length;
          return (
            <li key={g.config.id}>
              <a href={href('decisions', g.config.id)} aria-current={current === g ? 'true' : undefined} className={r === 0 ? 'complete' : undefined}>
                <span className="q-title">{g.config.title}</span>
                <span className="q-count num">{r === 0 ? '✓ Done' : `${r} left`}</span>
                <span className="q-meta">
                  {STAKE_LABEL[g.config.stake]} · {g.decisions.length} {g.decisions.length === 1 ? 'question' : 'questions'}
                  {deferred > 0 && ` · ${deferred} waiting`}
                </span>
              </a>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function GroupWork({ g }: { g: DecisionGroup }) {
  const { groups } = useDerived();
  const { work } = useApp();
  const shape = shapeOf(g);
  const settled = g.decisions.filter((d) => isSettled(work.answers[d.id])).length;
  const nextGroup = groups.find((x) => x !== g && x.config.blocksSignOff && x.decisions.some((d) => !isSettled(work.answers[d.id])))
    ?? groups.find((x) => x !== g && x.decisions.some((d) => !work.answers[d.id]));
  return (
    <section className="panel" aria-labelledby="group-title">
      <header className="work-head stack-2">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2 id="group-title">{g.config.title}</h2>
          <div className="row">
            {g.config.blocksSignOff ? <span className="tag required">Required for sign-off</span> : <span className="tag">Can stay open</span>}
            <span className="tag">{STAKE_LABEL[g.config.stake]}</span>
          </div>
        </div>
        <p className="measure" style={{ color: 'var(--ink-2)' }}>{g.config.why}</p>
        <p className="cap muted">
          {settled} of {g.decisions.length} settled
          {[...g.amounts.entries()].map(([cur, v]) => <span key={cur}> · <Amount value={v} currency={cur} /> {g.config.match.type === 'uncertain_classification' ? 'net' : ''} affected</span>)}
        </p>
      </header>
      {shape === 'single' && <SingleReview g={g} />}
      {shape === 'compare' && <CompareReview g={g} />}
      {shape === 'classification' && <ClassificationReview g={g} />}
      {shape === 'table' && <TableReview g={g} />}
      {settled === g.decisions.length && nextGroup && (
        <div className="action-bar">
          <span>This group is settled.</span>
          <button type="button" className="btn accent" onClick={() => navigate('decisions', nextGroup.config.id)}>Next: {nextGroup.config.title}</button>
        </div>
      )}
    </section>
  );
}
