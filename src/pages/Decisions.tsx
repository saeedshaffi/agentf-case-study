import { useEffect, useMemo, useState } from 'react';
import { STAKE_LABEL } from '../domain/config';
import { amountOf, groupDecisions, invoiceOf, previewEffect, progress, type DecisionGroup } from '../domain/decisions';
import { valueSpecFor } from '../domain/inputs';
import { KEEPS_OPEN } from '../domain/checks';
import { toCents } from '../domain/money';
import type { Decision } from '../domain/types';
import { Amount, Badge, Callout, Needs, PageHead, Ref, pct } from '../ui/components';
import { useApp } from '../ui/state';

export function Decisions() {
  return (
    <Needs eps={['summary', 'invoices', 'bank_transactions', 'decisions', 'partners', 'accounts']}>
      {() => <DecisionsInner />}
    </Needs>
  );
}

function DecisionsInner() {
  const { data, cfg, persisted, go } = useApp();
  const idx = data.idx!;
  const groups = useMemo(() => groupDecisions(idx, cfg), [idx, cfg]);
  const p = progress(groups, persisted.answers);
  const firstOpen = groups.findIndex((g) => g.decisions.some((d) => !persisted.answers[d.id]));
  const [open, setOpen] = useState<string | null>(groups[Math.max(0, firstOpen)]?.config.id ?? null);
  const locked = !!persisted.signedOff;
  // When the open group is finished, move on to the next group that still has questions.
  const openDone = groups.find((g) => g.config.id === open)?.decisions.every((d) => persisted.answers[d.id]);
  useEffect(() => {
    if (!openDone) return;
    const i = groups.findIndex((g) => g.config.id === open);
    const next = groups.slice(i + 1).find((g) => g.decisions.some((d) => !persisted.answers[d.id]));
    if (next) setOpen(next.config.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openDone]);

  return (
    <div className="stack">
      <PageHead
        title="Your decisions"
        aside={
          <div style={{ textAlign: 'right' }}>
            <div className="num" style={{ fontSize: 22, fontWeight: 650 }}>{p.answered} / {p.total}</div>
            <div className="small muted">answered · {p.blockingOpen} still needed for sign-off</div>
          </div>
        }
      >
        {p.total} questions only you can answer, sorted into {groups.length} groups by what they change: VAT first, cents last.
        Each answer shows its effect before it is booked, and you can undo it until you sign off.
      </PageHead>

      {locked && <Callout tone="good" title="Signed off">Answers are locked. Reopen the migration on the hand-over page to change them.</Callout>}
      {p.blockingOpen === 0 && !locked && (
        <Callout tone="good" title="Everything needed for sign-off is answered">
          <p>The remaining questions can stay open; they are visible to your tax advisor. <button className="link" onClick={() => go('handover')}>Go to hand-over →</button></p>
        </Callout>
      )}

      <div>
        {groups.map((g, i) => (
          <Group key={g.config.id} n={i + 1} g={g} open={open === g.config.id} onToggle={() => setOpen(open === g.config.id ? null : g.config.id)} locked={locked} />
        ))}
      </div>
    </div>
  );
}

function Group({ g, n, open, onToggle, locked }: { g: DecisionGroup; n: number; open: boolean; onToggle: () => void; locked: boolean }) {
  const { persisted, dispatch, role, cfg, showToast } = useApp();
  const answered = g.decisions.filter((d) => persisted.answers[d.id]).length;
  const done = answered === g.decisions.length;
  const openWithSuggestion = g.decisions.filter((d) => !persisted.answers[d.id] && d.suggested_option);
  const canDecide = cfg.roles[role].canDecide && !locked;

  const acceptAll = (ds: Decision[]) => {
    const ids = ds.map((d) => d.id);
    dispatch({ t: 'answer', ids, optionId: (id) => ds.find((d) => d.id === id)!.suggested_option!, by: role, bulk: true });
    showToast({ text: `Accepted the suggestion for ${ids.length} questions.`, undo: () => ids.forEach((id) => dispatch({ t: 'undo', id, by: role })) });
  };

  return (
    <section className={`group ${done ? 'done' : ''}`} aria-labelledby={`g-${g.config.id}`}>
      <header onClick={onToggle}>
        <span className="n" aria-hidden>{done ? '✓' : n}</span>
        <div className="stack-sm">
          <div className="row">
            <h3 id={`g-${g.config.id}`}>
              <button className="sr-only" aria-expanded={open} onClick={(e) => { e.stopPropagation(); onToggle(); }}>{open ? 'Collapse' : 'Expand'}</button>
              {g.config.title}
            </h3>
            <Badge tone={g.config.stake === 'tax' ? 'bad' : g.config.stake === 'trivial' || g.config.stake === 'records' ? 'neutral' : 'warn'}>{STAKE_LABEL[g.config.stake]}</Badge>
            {!g.config.blocksSignOff && <Badge tone="neutral">can stay open</Badge>}
          </div>
          <p className="small muted">{g.config.why}</p>
        </div>
        <div style={{ textAlign: 'right' }} className="stack-sm">
          <div className="small"><strong>{answered}</strong> of {g.decisions.length}</div>
          {g.amount > 0n && g.currency && <div className="small muted"><Amount value={g.amount} currency={g.currency} /></div>}
          <div className="progress" aria-hidden><span style={{ width: `${(answered / g.decisions.length) * 100}%` }} /></div>
        </div>
      </header>
      {open && (
        <div className="body stack">
          {g.config.bulkAcceptSuggestion && openWithSuggestion.length > 1 && canDecide && (
            <div className="callout info">
              <span className="icon" aria-hidden>i</span>
              <div className="spread" style={{ flex: 1 }}>
                <span>Every question here has the same kind of suggestion. Read one or two, then accept the rest together.</span>
                <button className="btn primary small" onClick={() => acceptAll(openWithSuggestion)}>Accept all {openWithSuggestion.length} suggestions</button>
              </div>
            </div>
          )}
          {g.clusters.map((c) => (
            <Cluster key={c.key} g={g} label={c.label} decisions={c.decisions} amount={c.amount} canDecide={canDecide} onAcceptAll={acceptAll} />
          ))}
        </div>
      )}
    </section>
  );
}

function Cluster({ g, label, decisions, amount, canDecide, onAcceptAll }: {
  g: DecisionGroup; label: string; decisions: Decision[]; amount: bigint; canDecide: boolean; onAcceptAll: (d: Decision[]) => void;
}) {
  const { persisted, data } = useApp();
  const [showAll, setShowAll] = useState(false);
  const openOnes = decisions.filter((d) => !persisted.answers[d.id]);
  const withSugg = openOnes.filter((d) => d.suggested_option);
  const cap = 6;
  // Answered questions sink to the bottom so the next one is always on top.
  const ordered = [...openOnes, ...decisions.filter((d) => persisted.answers[d.id])];
  const shown = showAll ? ordered : ordered.slice(0, cap);
  const suggestionSpread = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of withSugg) m.set(d.suggested_option!, (m.get(d.suggested_option!) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [withSugg]);

  return (
    <div className="stack-sm">
      {label && (
        <div className="stack-sm" style={{ padding: '4px 0' }}>
          <div>
            <strong>“{label}”</strong> <span className="muted small">· {decisions.length} invoices · <Amount value={amount} currency="EUR" /></span>
            {suggestionSpread.length > 0 && (
              <div className="small muted">
                Suggested: {suggestionSpread.map(([acc, n]) => `${acc} ${data.idx!.accountById.get(acc)?.name ?? ''} (${n})`).join(', ')}
              </div>
            )}
          </div>
          {suggestionSpread.length > 1 && (
            <p className="small" style={{ color: 'var(--warn)' }}>
              The model suggested {suggestionSpread.length} different accounts for this description, even for the same supplier.
              Its suggestions are not reliable here; decide what this kind of cost is once, and book them all the same way.
            </p>
          )}
          {canDecide && openOnes.length > 1 && (
            suggestionSpread.length > 1
              ? <OneAccountForAll decisions={openOnes} />
              : !g.config.bulkAcceptSuggestion && withSugg.length > 1 && <div><button className="btn small" onClick={() => onAcceptAll(withSugg)}>Accept each suggestion ({withSugg.length})</button></div>
          )}
        </div>
      )}
      {shown.map((d) => <DecisionCard key={d.id} d={d} canDecide={canDecide} />)}
      {ordered.length > cap && (
        <button className="link small" onClick={() => setShowAll(!showAll)}>
          {showAll ? 'Show fewer' : `Show all ${ordered.length} (${openOnes.length} open)`}
        </button>
      )}
    </div>
  );
}

function DecisionCard({ d, canDecide }: { d: Decision; canDecide: boolean }) {
  const { persisted, dispatch, role, data, cfg, showToast } = useApp();
  const idx = data.idx!;
  const ans = persisted.answers[d.id];
  const [choice, setChoice] = useState<string | null>(ans?.optionId ?? d.suggested_option);
  const [value, setValue] = useState<string>(ans?.value ?? '');
  const inv = invoiceOf(d, idx);
  const spec = choice ? valueSpecFor(d, choice, idx) : null;
  const err = spec?.kind === 'text' && value ? spec.validate(value) : null;
  const needsValue = !!spec;
  const ready = !!choice && (!needsValue || (value && !err));
  const effect = choice ? previewEffect(d, choice, idx) : null;

  const confirm = () => {
    if (!choice) return;
    dispatch({ t: 'answer', ids: [d.id], optionId: () => choice, value: value || undefined, by: role });
    showToast({ text: `${d.id} answered.`, undo: () => dispatch({ t: 'undo', id: d.id, by: role }) });
  };

  if (ans) {
    const opt = d.options.find((o) => o.id === ans.optionId);
    return (
      <article className="decision answered" id={`d-${d.id}`}>
        <div className="spread">
          <div>
            <Badge tone="good">✓</Badge> <strong>{d.title}</strong>
            <div className="small">
              {opt?.label}{ans.value && <> · <span className="mono">{ans.value}</span></>}
              {KEEPS_OPEN.includes(ans.optionId) && <> <Badge tone="neutral">still open in the books</Badge></>}
              <span className="muted"> · {ans.bulk ? 'accepted with the group' : 'answered'} by {cfg.people[ans.by].displayName.toLowerCase()}</span>
            </div>
          </div>
          {canDecide && <button className="btn small ghost" onClick={() => dispatch({ t: 'undo', id: d.id, by: role })}>Undo</button>}
        </div>
      </article>
    );
  }

  return (
    <article className="decision" id={`d-${d.id}`} aria-labelledby={`dt-${d.id}`}>
      <div className="spread">
        <strong id={`dt-${d.id}`}>{d.title}</strong>
        <span className="small muted">
          {d.amount_affected && <Amount value={amountOf(d)} currency={d.amount_affected.currency} />}
          {d.confidence !== undefined && <> · model {pct(d.confidence)} sure</>}
        </span>
      </div>
      <p className="small" style={{ marginTop: 4 }}>{d.question}</p>
      <p className="small muted" style={{ marginTop: 4 }}>
        Evidence:{' '}
        {d.references.map((r, k) => (
          <span key={k}>
            {k > 0 && ', '}
            {'invoice' in r && <Ref target={{ kind: 'invoice', id: r.invoice }} />}
            {'transaction' in r && <Ref target={{ kind: 'tx', id: r.transaction }} />}
            {'partner' in r && <Ref target={{ kind: 'partner', id: r.partner }}>{idx.partnerById.get(r.partner)?.name}</Ref>}
          </span>
        ))}
        {inv && <> · currently on {inv.classification.account} {inv.classification.account_name}</>}
      </p>
      <PartnerStake d={d} />

      <fieldset className="options" disabled={!canDecide} style={{ border: 0, padding: 0, margin: '12px 0 0' }}>
        <legend className="sr-only">{d.question}</legend>
        {d.options.map((o) => (
          <label key={o.id} className={`opt ${choice === o.id ? 'selected' : ''}`}>
            <input type="radio" name={d.id} aria-label={o.label} checked={choice === o.id} onChange={() => { setChoice(o.id); setValue(''); }} />
            <span>
              {o.label} {d.suggested_option === o.id && <Badge tone="accent">suggested</Badge>}
              <div className="eff">{o.effect}</div>
            </span>
          </label>
        ))}
      </fieldset>
      {d.why_suggested && <p className="small muted" style={{ marginTop: 6 }}>Why suggested: {d.why_suggested}</p>}
      {!d.suggested_option && <p className="small muted" style={{ marginTop: 6 }}>We have no suggestion here: this needs information only you have.</p>}

      {spec && (
        <div style={{ marginTop: 10 }}>
          <label className="small"><strong>{spec.label}</strong><br />
            {spec.kind === 'select' ? (
              spec.options.length ? (
                <select value={value} onChange={(e) => setValue(e.target.value)} style={{ marginTop: 4, padding: 6, maxWidth: '100%' }}>
                  <option value="">Choose…</option>
                  {spec.options.map((o) => <option key={o.value} value={o.value}>{o.label}{o.hint ? ` (${o.hint})` : ''}</option>)}
                </select>
              ) : <span className="muted">{spec.empty}</span>
            ) : (
              <input value={value} onChange={(e) => setValue(e.target.value)} placeholder={spec.placeholder} aria-invalid={!!err} style={{ marginTop: 4, padding: 6, width: 260 }} />
            )}
          </label>
          {err && <p className="small" style={{ color: 'var(--bad)' }} role="alert">{err}</p>}
          {spec.kind === 'select' && value && <p className="small"><Ref target={{ kind: 'invoice', id: value }}>Open {value}</Ref></p>}
        </div>
      )}

      {effect && (effect.lines.length > 0 || choice !== d.suggested_option) && (
        <div className="effect">
          <strong>What changes:</strong> {effect.lines.length === 0 ? effect.text : (
            <>
              {effect.lines.map((l, k) => (
                <span key={k}>{k > 0 && ' · '}{l.account} {idx.accountById.get(l.account)?.name} <Amount value={l.delta} currency="EUR" signed /></span>
              ))}
              <span className="muted"> · total unchanged</span>
            </>
          )}
        </div>
      )}

      {canDecide && (
        <div className="row" style={{ marginTop: 12 }}>
          <button className="btn primary small" disabled={!ready} onClick={confirm}>
            {choice && choice === d.suggested_option ? 'Accept suggestion' : 'Confirm answer'}
          </button>
          {d.amount_affected && toCents(d.amount_affected.amount) === 0n && <span className="small muted">No amount affected.</span>}
        </div>
      )}
    </article>
  );
}


/** For partner questions: what is riding on the answer, from the partner's invoices. */
function PartnerStake({ d }: { d: Decision }) {
  const { data, cfg } = useApp();
  const idx = data.idx!;
  const ref = d.references.find((r) => 'partner' in r) as { partner: string } | undefined;
  if (!ref) return null;
  const invs = (idx.invoicesByPartner.get(ref.partner) ?? []);
  if (!invs.length) return <p className="small muted" style={{ marginTop: 4 }}>No invoices for this partner.</p>;
  const zero = invs.filter((i) => i.direction === 'receivable' && cfg.zeroRatedAccounts.includes(i.classification.account));
  const usd = invs.filter((i) => i.original.gross.currency !== 'EUR');
  const net = zero.reduce((t, i) => t + toCents(i.booked.net.amount), 0n);
  return (
    <p className="small" style={{ marginTop: 4 }}>
      <strong>Riding on this:</strong> {invs.length} invoices
      {zero.length > 0 && <>, {zero.length} booked tax-free (net <Amount value={net} currency="EUR" />)</>}
      {usd.length > 0 && <>, {usd.length} in {usd[0].original.gross.currency}</>}.
    </p>
  );
}

/** Book every open question in a cluster to the same option (e.g. one expense account), with a preview. */
function OneAccountForAll({ decisions }: { decisions: Decision[] }) {
  const { dispatch, role, data, showToast } = useApp();
  const idx = data.idx!;
  const options = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of decisions) for (const o of d.options) m.set(o.id, o.label);
    return [...m.entries()];
  }, [decisions]);
  const [acc, setAcc] = useState('');
  const moving = acc ? decisions.filter((d) => invoiceOf(d, idx)?.classification.account !== acc) : [];
  const moved = moving.reduce((t, d) => t + amountOf(d), 0n);
  const apply = () => {
    const ids = decisions.map((d) => d.id);
    dispatch({ t: 'answer', ids, optionId: () => acc, by: role, bulk: true });
    showToast({ text: `Booked ${ids.length} invoices to ${acc}.`, undo: () => ids.forEach((id) => dispatch({ t: 'undo', id, by: role })) });
  };
  return (
    <div className="row" style={{ background: 'var(--sunk)', padding: 10, borderRadius: 6 }}>
      <label className="small">Book all {decisions.length} to{' '}
        <select value={acc} onChange={(e) => setAcc(e.target.value)} style={{ padding: 4 }}>
          <option value="">choose an account…</option>
          {options.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        </select>
      </label>
      {acc && <span className="small muted">{moving.length} invoices move (<Amount value={moved} currency="EUR" /> net); the total is unchanged.</span>}
      <button className="btn small primary" disabled={!acc} onClick={apply}>Book all {decisions.length}</button>
    </div>
  );
}
