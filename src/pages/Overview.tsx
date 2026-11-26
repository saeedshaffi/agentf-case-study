import { loadFunnel } from '../domain/checks';
import { who } from '../domain/config';
import { isSettled } from '../domain/decisions';
import type { Cents } from '../domain/money';
import type { Load } from '../domain/types';
import { Amount, Count, DateText, Needs, PageHead, Ref, Status } from '../ui/components';
import { href } from '../ui/router';
import { useApp, useDerived } from '../ui/state';

const ALL = ['summary', 'invoices', 'bank_transactions', 'decisions', 'partners', 'accounts'] as const;

export function Overview() {
  const { cfg, role, data } = useApp();
  const advisor = role === 'tax_advisor';
  return (
    <div className="stack-6">
      <PageHead title={advisor ? `${cfg.company}: migration` : 'Your books are in Agent F'}>
        {advisor
          ? 'Read-only. What was loaded from the old system, how it was booked, and how sure the engine is.'
          : `${data.summary?.customer.name ?? cfg.company}'s history from ${cfg.words.oldSystem} has been loaded, booked to ${data.summary?.customer.chart_of_accounts ?? 'the chart of accounts'} and matched against your bank account.`}
      </PageHead>
      <Needs eps={[...ALL]}>{() => <Status_ />}</Needs>
      {data.summary && <Loads loads={data.summary.loads} />}
    </div>
  );
}

function Status_() {
  const { idx, metrics, progress, blocking, ready, groups } = useDerived();
  const { cfg, role, work } = useApp();
  const lead = cfg.roles[role].canDecide;
  const f = loadFunnel(idx);
  const inv = idx.invoices;
  const byRule = inv.filter((i) => i.classification.decided_by === 'rule').length;
  const review = inv.filter((i) => i.classification.needs_review || i.classification.confidence < cfg.reviewThreshold).length;
  const byModel = inv.length - byRule - review;
  const bank = idx.bank;
  const fees = bank.filter((t) => t.match?.kind === 'bank_fee').length;
  const exact = bank.filter((t) => t.match?.decided_by === 'rule' && t.match.kind !== 'bank_fee').length;
  const similar = bank.filter((t) => t.match && t.match.decided_by !== 'rule').length;
  const unmatched = bank.filter((t) => !t.match).length;
  const nextGroup = groups.find((g) => g.config.blocksSignOff && g.decisions.some((d) => !isSettled(work.answers[d.id])));
  const balanced = idx.summary.balance_check.balanced;

  return (
    <>
      <section className="panel" aria-labelledby="status-h">
        <div className="panel-pad stack">
          <div className="spread">
            <h2 id="status-h">
              {work.signedOff ? 'Signed off and handed over' : ready ? 'Ready for sign-off' : `${progress.blockingOpen} required ${progress.blockingOpen === 1 ? 'decision' : 'decisions'}${blocking.length ? ` and ${blocking.length} ${blocking.length === 1 ? 'check' : 'checks'}` : ''} before sign-off`}
            </h2>
            {work.signedOff ? <Status kind="settled">Signed off <DateText iso={work.signedOff.at} /></Status> : ready ? <Status kind="settled">Ready</Status> : <Status kind="open">In progress</Status>}
          </div>
          <p className="measure" style={{ color: 'var(--ink-2)' }}>
            Everything loaded: {f.rowsRead.toLocaleString(cfg.numberLocale)} rows from the old system became {f.loaded.toLocaleString(cfg.numberLocale)} invoices, none rejected, and {balanced ? 'every booking balances' : 'the bookings do not balance'}.
            {' '}{progress.required} questions need an answer before sign-off and {progress.optional} can stay open for your {who(cfg, 'tax_advisor')}.
          </p>
          {lead && !work.signedOff && (
            <div className="row">
              {nextGroup
                ? <a className="btn primary" href={href('decisions', nextGroup.config.id)}>{progress.requiredSettled ? 'Continue' : 'Start'}: {nextGroup.config.title}</a>
                : <a className="btn primary" href={href('handover')}>Go to sign-off</a>}
              {blocking.length > 0 && <a className="btn" href={href('checks', blocking[0].id)}>See the {blocking.length} {blocking.length === 1 ? 'check' : 'checks'} that need you</a>}
            </div>
          )}
        </div>
        <div className="facts" style={{ borderTop: '1px solid var(--line)' }}>
          <div className="fact"><div className="label">Invoices loaded</div><div className="value"><Count n={inv.length} trace={{ kind: 'metric', id: 'invoices_loaded' }} label="invoices loaded" /></div><div className="foot">{idx.partners.length} customers and suppliers</div></div>
          <div className="fact"><div className="label">Journal debits = credits</div><div className="value"><Amount value={metrics.debits.value as Cents} currency="EUR" trace={{ kind: 'metric', id: 'debits' }} label="journal debits" /></div><div className="foot">{balanced ? '✓ Balanced. A total of all bookings, not money held.' : 'Not balanced'}</div></div>
          <div className="fact"><div className="label">Bank payments explained</div><div className="value"><Count n={bank.length - unmatched} trace={{ kind: 'metric', id: 'bank_matched' }} label="bank payments explained" /></div><div className="foot">of {bank.length.toLocaleString(cfg.numberLocale)}; <Count n={unmatched} trace={{ kind: 'metric', id: 'bank_unmatched' }} label="payments not yet explained" /> not yet</div></div>
          <div className="fact"><div className="label">Customers owe you, net</div><div className="value"><Amount value={metrics.net_receivables_eur.value as Cents} currency="EUR" trace={{ kind: 'metric', id: 'net_receivables_eur' }} label="net receivables" /></div><div className="foot">after open credit notes; plus <Amount value={metrics.open_receivables_usd.value as Cents} currency="USD" /></div></div>
        </div>
      </section>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 360px), 1fr))', gap: 24, alignItems: 'start' }}>
        <section className="panel" aria-labelledby="recon">
          <header className="panel-head"><h3 id="recon">From export rows to invoices</h3>{f.reconciles ? <Status kind="settled">Adds up</Status> : <Status kind="blocking">Does not add up</Status>}</header>
          <table className="table">
            <tbody>
              <tr><td>Rows read from your exports</td><td className="r num">{f.rowsRead.toLocaleString(cfg.numberLocale)}</td></tr>
              <tr><td>Exact duplicates removed</td><td className="r num">−{f.duplicates}</td></tr>
              <tr><td>Earlier versions replaced by a later one <span className="muted">({f.corrected.length} corrections, {f.repeats.length} repeats)</span></td><td className="r num">−{f.superseded}</td></tr>
              <tr><td>Rows rejected</td><td className="r num">{f.rejected}</td></tr>
            </tbody>
            <tfoot><tr><td>Invoices in your books</td><td className="r num">{f.loaded.toLocaleString(cfg.numberLocale)}</td></tr></tfoot>
          </table>
          <p className="cap muted" style={{ padding: '0 12px 12px' }}>Corrected invoices keep every earlier version, for example <Ref target={{ kind: 'invoice', id: f.corrected[0]?.id ?? '' }} />.</p>
        </section>

        <section className="panel panel-pad stack" aria-labelledby="conf">
          <h3 id="conf">How entries were decided</h3>
          <Distribution title="Invoices booked" total={inv.length} parts={[
            ['By a fixed rule', byRule, '#1E5B47'],
            [`By the model, ${Math.round(cfg.reviewThreshold * 100)} % sure or more`, byModel, '#7FA394'],
            ['Waiting for your review', review, '#B07A1F'],
          ]} />
          <Distribution title="Bank payments" total={bank.length} parts={[
            ['Exact invoice reference', exact, '#1E5B47'],
            ['Similar reference', similar, '#7FA394'],
            ['Bank fees', fees, '#9AA0A6'],
            ['Not matched yet', unmatched, '#B07A1F'],
          ]} />
          <p className="cap muted measure">Confidence is how sure the model was, not proof it is right. The model saw only invoice descriptions and supplier categories: no names, IBANs or amounts.</p>
        </section>
      </div>
    </>
  );
}

function Distribution({ title, total, parts }: { title: string; total: number; parts: [string, number, string][] }) {
  const { cfg } = useApp();
  return (
    <div>
      <h4 style={{ marginBottom: 8 }}>{title} <span className="muted" style={{ fontWeight: 400 }}>({total.toLocaleString(cfg.numberLocale)})</span></h4>
      <div className="dist" aria-hidden>{parts.map(([l, n, c]) => n > 0 && <span key={l} style={{ width: `${(n / total) * 100}%`, background: c }} />)}</div>
      <div className="dist-legend">
        {parts.map(([l, n, c]) => (
          <div key={l}><i style={{ background: c }} /><span>{l}</span><strong className="num">{n.toLocaleString(cfg.numberLocale)}</strong><span className="num muted" style={{ minWidth: 40, textAlign: 'right' }}>{Math.round((n / total) * 100)} %</span></div>
        ))}
      </div>
    </div>
  );
}

function Loads({ loads }: { loads: Load[] }) {
  const titles: Record<string, string> = { initial_export: 'Full export', delta_export: 'Changes since the full export', bank_statement: 'Bank statement' };
  const retried = new Set(loads.filter((l) => l.retry_of).map((l) => l.retry_of));
  return (
    <section className="panel" aria-labelledby="loads">
      <header className="panel-head"><h3 id="loads">Load history</h3><span className="muted">{loads.filter((l) => l.status === 'succeeded').length} loads succeeded</span></header>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th scope="col">What</th><th scope="col">File</th><th scope="col">Started</th><th scope="col">Result</th></tr></thead>
          <tbody>
            {loads.map((l) => {
              const retry = loads.find((x) => x.retry_of === l.id);
              const gap = retry ? Math.round((+new Date(retry.started_at) - +new Date(l.finished_at)) / 60000) : 0;
              return (
                <tr key={l.id}>
                  <td>{titles[l.kind] ?? l.kind}{l.retry_of ? ' (second attempt)' : ''}</td>
                  <td className="code">{l.file}</td>
                  <td><DateText iso={l.started_at} time /></td>
                  <td>
                    {l.status === 'failed'
                      ? <><Status kind={retried.has(l.id) ? 'neutral' : 'blocking'}>Failed, retried</Status><div className="cap muted">{l.error}{retry && ` Retried ${gap} minutes after it failed.`}</div></>
                      : <Status kind="settled">Loaded</Status>}
                    {' '}<Ref target={{ kind: 'load', id: l.id }}>details</Ref>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
