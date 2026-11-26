import { useId, useState } from 'react';
import { who } from '../../domain/config';
import { isDeferred, previewEffect, PROTOTYPE_EFFECT, type Answer } from '../../domain/decisions';
import { valueSpecFor } from '../../domain/inputs';
import { batchOf } from '../../domain/store';
import type { Decision } from '../../domain/types';
import { toCents } from '../../domain/money';
import { Amount, Ref, pct } from '../../ui/components';
import { useApp, useDerived } from '../../ui/state';

/** See PROTOTYPE_EFFECT: shown instead of the engine's effect text for these options. */
export const PROTOTYPE_NOTE = PROTOTYPE_EFFECT;

/** What choosing an option actually did here, for logs and summaries. */
export const RECORDED_EFFECT: Record<string, string> = {
  enter: 'VAT ID recorded. Format checked; not verified with the EU VIES service in this prototype.',
  ask_customer: 'Left open. No request was sent in this prototype.',
  refund: 'Choice recorded. No payment instruction was created in this prototype.',
  new_customer: 'Choice recorded. No customer record was created in this prototype.',
  leave_open: 'Left open; the payment stays unassigned.',
};

export function optionLabel(d: Decision, optionId: string) {
  return d.options.find((o) => o.id === optionId)?.label ?? optionId;
}

/** Answer with toast + undo. Undo of a bulk answer reverts the whole batch. */
export function useAnswerActions() {
  const { dispatch, role, showToast, work } = useApp();
  return {
    answer(items: { id: string; optionId: string; value?: string }[], text: string, batch?: string) {
      dispatch({ t: 'answer', items, by: role, batch });
      const ids = items.map((i) => i.id);
      showToast({ text, undo: () => dispatch({ t: 'undo', ids, by: role }) });
    },
    undo(id: string) {
      const ids = batchOf(work, id);
      dispatch({ t: 'undo', ids, by: role });
      showToast({ text: ids.length > 1 ? `Undid ${ids.length} answers given together.` : 'Answer removed. The question is open again.' });
    },
  };
}

/** The engine's suggestion, with its basis and its limits. Never pre-selected. */
export function Suggestion({ d }: { d: Decision }) {
  if (!d.suggested_option) return <p className="muted">No suggestion from the engine: this needs information only you have.</p>;
  return (
    <p>
      <strong>{optionLabel(d, d.suggested_option)}</strong>
      {d.why_suggested && <span className="muted">. {d.why_suggested}</span>}
      {d.confidence !== undefined && <span className="muted"> Model confidence {pct(d.confidence)}; below 80 % the engine asks a person.</span>}
    </p>
  );
}

export function AnsweredLine({ d, a, onChange }: { d: Decision; a: Answer; onChange?: () => void }) {
  const { cfg, work } = useApp();
  const n = a.batch ? batchOf(work, d.id).length : 1;
  return (
    <div className="row" style={{ justifyContent: 'space-between' }}>
      <div>
        <strong>{optionLabel(d, a.optionId)}</strong>{a.value && <> · <span className="code">{a.value}</span></>}
        <div className="cap muted">
          {isDeferred(a) ? 'Waiting: still blocks sign-off if required. ' : ''}
          {n > 1 ? `Answered with ${n - 1} others` : 'Answered'} by the {who(cfg, a.by)}
        </div>
      </div>
      {onChange && !work.signedOff && <button type="button" className="btn small" onClick={onChange}>{n > 1 ? `Undo all ${n}` : 'Change answer'}</button>}
    </div>
  );
}

/** Radio options (none selected), an extra input where the option needs one, and the effect of the choice. */
export function DecisionForm({ d, onDone }: { d: Decision; onDone?: () => void }) {
  const { data, work, cfg, role } = useApp();
  const { answer } = useAnswerActions();
  const idx = data.idx!;
  const [choice, setChoice] = useState<string | null>(null);
  const [value, setValue] = useState('');
  const [touched, setTouched] = useState(false);
  const uid = useId();
  const spec = choice ? valueSpecFor(d, choice, idx) : null;
  const err = spec?.kind === 'text' && value ? spec.validate(value) : null;
  const missing = !choice ? 'Choose an option.' : spec && !value ? (spec.kind === 'select' ? 'Choose one from the list.' : `Enter the ${spec.label.toLowerCase()}.`) : err;
  const effect = choice ? previewEffect(d, choice, idx) : null;
  const canDecide = cfg.roles[role].canDecide && !work.signedOff;

  const confirm = () => {
    setTouched(true);
    if (missing || !choice) return;
    const v = spec?.kind === 'text' ? value.replace(/[\s.-]+/g, '').toUpperCase() : value || undefined;
    answer([{ id: d.id, optionId: choice, value: v }], `Saved: ${optionLabel(d, choice)}.`);
    onDone?.();
  };

  return (
    <form onSubmit={(e) => { e.preventDefault(); confirm(); }} className="stack">
      <fieldset style={{ border: 0, padding: 0, margin: 0 }} disabled={!canDecide}>
        <legend className="sr-only">{d.question}</legend>
        {d.options.map((o) => (
          <label key={o.id} className="choice">
            <input type="radio" name={`${uid}-opt`} checked={choice === o.id} onChange={() => { setChoice(o.id); setValue(''); setTouched(false); }} />
            <span>
              {o.label} {d.suggested_option === o.id && <span className="tag">Engine suggestion</span>}
              <span className="hint" style={{ display: 'block' }}>{PROTOTYPE_NOTE[o.id] ?? o.effect}</span>
            </span>
          </label>
        ))}
      </fieldset>

      {spec && (
        <div className="field">
          <label htmlFor={`${uid}-v`}>{spec.label}</label>
          {spec.kind === 'select' ? (
            spec.options.length ? (
              <select id={`${uid}-v`} className="select" value={value} onChange={(e) => setValue(e.target.value)} aria-describedby={`${uid}-e`}>
                <option value="">Choose…</option>
                {spec.options.map((o) => <option key={o.value} value={o.value}>{o.label}{o.hint ? ` (${o.hint})` : ''}</option>)}
              </select>
            ) : <p className="muted">{spec.empty}</p>
          ) : (
            <input id={`${uid}-v`} className="input" style={{ width: 280 }} value={value} onChange={(e) => setValue(e.target.value)} placeholder={spec.placeholder}
              aria-invalid={!!err} aria-describedby={`${uid}-e`} autoComplete="off" />
          )}
          {spec.kind === 'select' && value && <span className="cap">Selected: <Ref target={{ kind: 'invoice', id: value }} /></span>}
          <span id={`${uid}-e`} className="field-error" role={err ? 'alert' : undefined}>{err ?? ''}</span>
        </div>
      )}

      {effect && (
        <div className="effect" aria-live="polite">
          <strong>If you confirm: </strong>
          {effect.lines.length
            ? effect.lines.map((l, k) => <span key={k}>{k > 0 && ' and '}{l.account} {idx.accountById.get(l.account)?.name} <Amount value={l.delta} currency="EUR" signed /></span>)
            : effect.text}
          {effect.lines.length > 0 && <span className="muted"> Total expenses stay the same.</span>}
        </div>
      )}

      {canDecide && (
        <div className="row">
          <button type="submit" className="btn primary" aria-describedby={`${uid}-why`}>Confirm answer</button>
          <span id={`${uid}-why`} className="disabled-reason" role={touched && missing ? 'alert' : undefined}>{touched && missing ? missing : ''}</span>
        </div>
      )}
    </form>
  );
}

/** Small "riding on this" facts for a partner question, from the partner's invoices. */
export function PartnerFacts({ partnerId }: { partnerId: string }) {
  const { idx, findings } = useDerived();
  const { cfg } = useApp();
  const p = idx.partnerById.get(partnerId);
  if (!p) return null;
  const invs = idx.invoicesByPartner.get(partnerId) ?? [];
  const zero = invs.filter((i) => i.direction === 'receivable' && cfg.zeroRatedAccounts.includes(i.classification.account));
  const usd = invs.filter((i) => i.original.gross.currency !== 'EUR');
  const vatOnUsd = usd.filter((i) => i.original.vat_rate_percent > 0);
  const net = zero.reduce((t, i) => t + toCents(i.booked.net.amount), 0n);
  const f = findings.filter((x) => x.decisionIds?.some((id) => (idx.decisionsByPartner.get(partnerId) ?? []).some((d) => d.id === id)));
  return (
    <dl className="qa">
      <dt>Customer</dt><dd><Ref target={{ kind: 'partner', id: p.id }}>{p.name}</Ref> <span className="muted">{p.id} · {p.city || 'no city'} · {p.country ?? 'no country'}</span></dd>
      <dt>VAT ID on record</dt><dd className="code">{p.vat_id}</dd>
      <dt>Invoices</dt>
      <dd>
        {invs.length}{zero.length > 0 && <>, of which <strong>{zero.length} booked tax-free</strong> (net <Amount value={net} currency="EUR" />)</>}
        {usd.length > 0 && <>, {usd.length} in {usd[0].original.gross.currency}{vatOnUsd.length > 0 && <> with {vatOnUsd[0].original.vat_rate_percent} % German VAT on {vatOnUsd.length}</>}</>}
      </dd>
      {f.length > 0 && <><dt>Related check</dt><dd>{f.map((x) => <a key={x.id} href={`#/checks/${encodeURIComponent(x.id)}`}>{x.title}</a>)}</dd></>}
    </dl>
  );
}
