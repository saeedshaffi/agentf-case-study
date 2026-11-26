import type { DecisionGroup } from '../../domain/decisions';
import { toCents } from '../../domain/money';
import type { Partner } from '../../domain/types';
import { Amount, Personal, Ref, pct } from '../../ui/components';
import { useApp } from '../../ui/state';
import { AnsweredLine, DecisionForm, useAnswerActions } from './shared';

/** Two records that may be one: compare them field by field, then decide. */
export function CompareReview({ g }: { g: DecisionGroup }) {
  const { work, data } = useApp();
  const { undo } = useAnswerActions();
  const idx = data.idx!;
  return (
    <div className="divided">
      {g.decisions.map((d) => {
        const ids = d.references.flatMap((r) => ('partner' in r ? [r.partner] : []));
        const ps = ids.map((id) => idx.partnerById.get(id)).filter((p): p is Partner => !!p);
        if (ps.length !== 2) return <div key={d.id} className="work-body"><DecisionForm d={d} /></div>;
        const [a, b] = ps;
        const facts = ps.map((p) => {
          const invs = idx.invoicesByPartner.get(p.id) ?? [];
          const open = invs.reduce((t, i) => t + (i.payment.open.currency === 'EUR' ? toCents(i.payment.open.amount) : 0n), 0n);
          const txs = idx.bank.filter((t) => t.match?.invoices.some((x) => invs.some((i) => i.id === x)));
          return { invs, open, txs };
        });
        const rows: [string, (p: Partner) => string, 'iban' | 'email' | 'name' | null][] = [
          ['Name', (p) => p.name, null],
          ['VAT ID', (p) => p.vat_id, null],
          ['Country and city', (p) => `${p.country ?? '—'}, ${p.city || '—'}`, null],
          ['IBAN', (p) => p.iban, 'iban'],
          ['E-mail', (p) => p.email, 'email'],
          ['Contact', (p) => p.contact_person, 'name'],
          ['Source row', (p) => `${p.source.file}, row ${p.source.row}`, null],
        ];
        const keep = d.options.find((o) => o.id === 'merge')?.label.match(/K\d+/)?.[0] ?? a.id;
        const retire = keep === a.id ? b : a;
        const retireFacts = facts[ps.indexOf(retire)];
        const answer = work.answers[d.id];
        return (
          <article key={d.id} className="work-body stack" aria-labelledby={`dq-${d.id}`}>
            <div>
              <h3 id={`dq-${d.id}`}>Are these the same company?</h3>
              <p className="cap muted">{d.title} · question {d.id}{d.confidence !== undefined && ` · model confidence ${pct(d.confidence)}`}</p>
            </div>
            <div className="table-wrap">
              <table className="compare">
                <thead>
                  <tr><th scope="col"><span className="sr-only">Field</span></th>{ps.map((p) => <th key={p.id} scope="col"><Ref target={{ kind: 'partner', id: p.id }}>{p.id}</Ref></th>)}<th scope="col"><span className="sr-only">Comparison</span></th></tr>
                </thead>
                <tbody>
                  {rows.map(([label, get, kind]) => {
                    const same = get(a) === get(b);
                    return (
                      <tr key={label}>
                        <th scope="row">{label}</th>
                        {ps.map((p) => <td key={p.id}>{kind ? <Personal kind={kind} value={get(p)} /> : get(p)}</td>)}
                        <td>{label === 'Source row' ? null : same ? <span className="same">✓ Same</span> : <span className="differs">≠ Differs</span>}</td>
                      </tr>
                    );
                  })}
                  <tr><th scope="row">Invoices</th>{facts.map((f, k) => <td key={k}>{f.invs.length}</td>)}<td /></tr>
                  <tr><th scope="row">Bank payments</th>{facts.map((f, k) => <td key={k}>{f.txs.length}</td>)}<td /></tr>
                  <tr><th scope="row">Open amount</th>{facts.map((f, k) => <td key={k}><Amount value={f.open} currency="EUR" /></td>)}<td /></tr>
                </tbody>
              </table>
            </div>
            {d.why_suggested && <p><strong>Why the engine thinks so:</strong> {d.why_suggested}</p>}
            <div className="effect">
              <strong>What merging does: </strong>
              {retire.id} is retired and {keep} is kept. {retireFacts.invs.length === 0 && retireFacts.txs.length === 0
                ? `${retire.id} has no invoices and no bank payments, so no amount moves and no balance changes.`
                : `${retireFacts.invs.length} invoices and ${retireFacts.txs.length} payments move from ${retire.id} to ${keep}.`}
              {' '}Both source rows stay in the history.
            </div>
            {answer ? <div className="effect"><AnsweredLine d={d} a={answer} onChange={() => undo(d.id)} /></div> : <DecisionForm d={d} />}
          </article>
        );
      })}
    </div>
  );
}
