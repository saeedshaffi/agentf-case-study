import { useRef } from 'react';
import { invoiceOf, partnerIdOf, type DecisionGroup } from '../../domain/decisions';
import { Ref } from '../../ui/components';
import { useApp } from '../../ui/state';
import { AnsweredLine, DecisionForm, PartnerFacts, Suggestion, useAnswerActions } from './shared';

/** One consequential question at a time: issue, why, records, evidence, options, effect. */
export function SingleReview({ g }: { g: DecisionGroup }) {
  const { work, data } = useApp();
  const { undo } = useAnswerActions();
  const idx = data.idx!;
  const doneRef = useRef<HTMLDivElement>(null);
  return (
    <div className="divided">
      {g.decisions.map((d) => {
        const a = work.answers[d.id];
        const pid = partnerIdOf(d);
        const inv = invoiceOf(d, idx);
        return (
          <article key={d.id} className="work-body stack" id={`d-${d.id}`} aria-labelledby={`dq-${d.id}`}>
            <div>
              <h3 id={`dq-${d.id}`}>{d.question}</h3>
              <p className="cap muted">{d.title} · question {d.id}</p>
            </div>
            {pid && <PartnerFacts partnerId={pid} />}
            {inv && <p>About <Ref target={{ kind: 'invoice', id: inv.id }} /> from {inv.partner_name}</p>}
            <div>
              <h4>Engine suggestion</h4>
              <Suggestion d={d} />
            </div>
            {a ? (
              <div ref={doneRef} className="effect"><AnsweredLine d={d} a={a} onChange={() => undo(d.id)} /></div>
            ) : (
              <div>
                <h4 style={{ marginBottom: 8 }}>Your answer</h4>
                <DecisionForm d={d} />
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}
