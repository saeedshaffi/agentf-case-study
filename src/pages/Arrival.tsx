import { useMemo } from 'react';
import { loadFunnel, runChecks } from '../domain/checks';
import { groupDecisions, progress } from '../domain/decisions';
import { computeMetrics } from '../domain/metrics';
import type { Cents } from '../domain/money';
import type { Load } from '../domain/types';
import { Amount, Badge, Callout, Count, DateText, Needs, PageHead, Ref, Stat } from '../ui/components';
import { useApp } from '../ui/state';

export function Arrival() {
  const { cfg, role, data } = useApp();
  const s = data.summary;
  return (
    <div className="stack">
      <PageHead title={`${cfg.people[role].greeting}. Your books have arrived.`}>
        {s ? <>We loaded {s.customer.name}'s history from {cfg.words.oldSystem}, booked it to the {s.customer.chart_of_accounts} chart of accounts and matched it against your bank account. Here is what happened, and how sure we are.</> : 'Loading the migration summary…'}
      </PageHead>

      <Needs eps={['summary']}>{() => <Timeline loads={data.summary!.loads} />}</Needs>
      <Needs eps={['summary', 'invoices', 'bank_transactions', 'decisions', 'partners', 'accounts']}>{() => <Loaded />}</Needs>
    </div>
  );
}

function Timeline({ loads }: { loads: Load[] }) {
  const failed = loads.filter((l) => l.status === 'failed');
  return (
    <section className="card">
      <div className="spread" style={{ marginBottom: 16 }}>
        <h2>What we loaded, in order</h2>
        {failed.length > 0 && <Badge tone="info">{failed.length} load failed and was retried</Badge>}
      </div>
      <ol className="timeline">
        {loads.map((l) => {
          const retry = loads.find((x) => x.retry_of === l.id);
          return (
            <li key={l.id}>
              <span className={`dot ${l.status === 'failed' ? 'failed' : 'ok'}`} aria-hidden />
              <div>
                <div className="spread">
                  <strong>{loadTitle(l)}</strong>
                  <span className="small muted"><DateText iso={l.started_at} time /> · <Ref target={{ kind: 'load', id: l.id }} /></span>
                </div>
                <div className="small muted mono">{l.file}</div>
                {l.status === 'failed' && (
                  <p className="small" style={{ marginTop: 4 }}>
                    <Badge tone="bad">Failed</Badge> {l.error}{' '}
                    {retry && <>Retried {minutesBetween(l.started_at, retry.started_at)} minutes later and {retry.status}. Every bank transaction you see comes from the retry.</>}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function loadTitle(l: Load) {
  const k: Record<string, string> = {
    initial_export: 'Full export from the old system',
    delta_export: 'Changes since the full export',
    bank_statement: 'Bank statement',
  };
  return (k[l.kind] ?? l.kind) + (l.retry_of ? ' (retry)' : '');
}

function minutesBetween(a: string, b: string) { return Math.round((+new Date(b) - +new Date(a)) / 60000); }

function Loaded() {
  const { data, cfg, go, role, persisted } = useApp();
  const idx = data.idx!;
  const m = useMemo(() => computeMetrics(idx), [idx]);
  const f = useMemo(() => loadFunnel(idx), [idx]);
  const groups = useMemo(() => groupDecisions(idx, cfg), [idx, cfg]);
  const checks = useMemo(() => runChecks(idx, cfg), [idx, cfg]);
  const p = progress(groups, persisted.answers);
  const attention = checks.filter((c) => c.severity === 'attention');
  const inv = idx.invoices;
  const byRule = inv.filter((i) => i.classification.decided_by === 'rule').length;
  const review = inv.filter((i) => i.classification.needs_review || i.classification.confidence < cfg.reviewThreshold).length;
  const byModel = inv.length - byRule - review;
  const bank = idx.bank;
  const bRule = bank.filter((t) => t.match?.decided_by === 'rule').length;
  const bFuzzy = bank.filter((t) => t.match && t.match.decided_by !== 'rule').length;
  const bNone = bank.length - bRule - bFuzzy;
  const balanced = idx.summary.balance_check.balanced;

  return (
    <>
      <div className="grid c3">
        <Stat label="Invoices in your books" foot={<>{idx.partners.length} {cfg.words.customers} and {cfg.words.suppliers}</>}>
          <Count n={inv.length} trace={{ kind: 'metric', id: 'invoices_loaded' }} label="Invoices loaded" />
        </Stat>
        <Stat label="The books balance" foot={balanced ? <Badge tone="good">✓ debits = credits</Badge> : <Badge tone="bad">They do not</Badge>}>
          <Amount value={m.debits.value as Cents} currency="EUR" trace={{ kind: 'metric', id: 'debits' }} label="Total debits" />
        </Stat>
        <Stat label="Bank transactions explained" foot={<>of <Count n={bank.length} /> · <Count n={bNone} trace={{ kind: 'metric', id: 'bank_unmatched' }} label="Unmatched bank transactions" /> wait for you</>}>
          <Count n={bank.length - bNone} trace={{ kind: 'metric', id: 'bank_matched' }} label="Matched bank transactions" />
        </Stat>
      </div>

      <div className="grid c2">
        <section className="card stack-sm">
          <h2>From rows to invoices</h2>
          <p className="muted small">Every row from the old system is accounted for.</p>
          <div className="funnel">
            <div className="fr"><span>Rows read from your exports</span><strong className="num"><Count n={f.rowsRead} /></strong></div>
            <div className="fr sub"><span>Exact duplicate rows removed</span><span className="num">− <Count n={f.duplicates} /></span></div>
            <div className="fr sub"><span>Older versions replaced by a later one <span className="muted small">({f.corrected.length} corrections, {f.repeats.length} repeats)</span></span><span className="num">− <Count n={f.superseded} /></span></div>
            <div className="fr sub"><span>Rows rejected</span><span className="num">− <Count n={f.rejected} /></span></div>
            <div className="fr total"><span>Invoices in your books</span><span className="num">{f.loaded.toLocaleString(cfg.numberLocale)}</span></div>
          </div>
          {f.reconciles
            ? <p className="small"><Badge tone="good">✓ adds up</Badge> Corrected invoices keep every earlier version. Open one to see them, e.g. <Ref target={{ kind: 'invoice', id: f.corrected[0]?.id ?? '' }} />.</p>
            : <Callout tone="attention" title="These steps do not add up">We are looking into it. Nothing has been changed in your books.</Callout>}
        </section>

        <section className="card stack">
          <h2>How sure we are</h2>
          <Confidence title="How invoices were booked" total={inv.length} parts={[
            ['By a fixed rule', byRule, 'var(--good)'],
            ['By the model, confident', byModel, '#7aa37f'],
            ['Waiting for you', review, 'var(--warn)'],
          ]} />
          <Confidence title="How bank payments were matched" total={bank.length} parts={[
            ['Exact reference', bRule, 'var(--good)'],
            ['Similar reference', bFuzzy, '#7aa37f'],
            ['Not matched yet', bNone, 'var(--warn)'],
          ]} />
          <p className="small muted">
            The model only sees an invoice's description and the supplier category: no names, IBANs or amounts.
            Anything below {Math.round(cfg.reviewThreshold * 100)} % confidence comes to you.
          </p>
        </section>
      </div>

      <section className="card">
        <div className="spread">
          <div className="stack-sm">
            <h2>What needs you</h2>
            <p>
              <strong>{p.total - p.answered}</strong> open questions, sorted into <strong>{groups.length}</strong> groups by what they change.
              {' '}Start with the {groups.filter((g) => g.config.stake === 'tax').reduce((n, g) => n + g.decisions.length, 0)} that affect your VAT.
              {attention.length > 0 && <> We also found <strong>{attention.length}</strong> things in the result you should know about.</>}
            </p>
          </div>
          {cfg.roles[role].pages.includes('decisions') && (
            <div className="row">
              {attention.length > 0 && <button className="btn" onClick={() => go('checks')}>See what we found</button>}
              <button className="btn primary" onClick={() => go('decisions')}>Start with the questions</button>
            </div>
          )}
        </div>
      </section>
    </>
  );
}

function Confidence({ title, total, parts }: { title: string; total: number; parts: [string, number, string][] }) {
  const { cfg } = useApp();
  return (
    <div>
      <div className="small" style={{ marginBottom: 6 }}><strong>{title}</strong></div>
      <div className="bar" role="img" aria-label={parts.map(([l, n]) => `${l}: ${n}`).join(', ')}>
        {parts.map(([l, n, c]) => <span key={l} style={{ width: `${(n / total) * 100}%`, background: c }} />)}
      </div>
      <div className="legend">
        {parts.map(([l, n, c]) => <span key={l}><i style={{ background: c }} />{l} <strong className="num">{n.toLocaleString(cfg.numberLocale)}</strong></span>)}
      </div>
    </div>
  );
}
