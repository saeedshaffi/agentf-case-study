import { who } from '../domain/config';
import type { Cents } from '../domain/money';
import { Amount, DateText, Needs, PageHead, Status } from '../ui/components';
import { useApp, useDerived } from '../ui/state';

const ALL = ['summary', 'invoices', 'bank_transactions', 'decisions', 'partners', 'accounts'] as const;

/** The managing director's one screen: did it work, does anything need me. Totals only. */
export function Summary() {
  const { cfg } = useApp();
  return (
    <div className="stack-6">
      <PageHead title="Did the move to Agent F work?">A one-screen answer for {cfg.company}.</PageHead>
      <Needs eps={[...ALL]}>{() => <Inner />}</Needs>
    </div>
  );
}

function Inner() {
  const { idx, metrics, progress, findings, status, ready } = useDerived();
  const { work, cfg } = useApp();
  const lead = who(cfg, 'finance_lead');
  const vat = findings.filter((f) => f.kind === 'finding' && f.needsAttention && (f.id.startsWith('zero_rated') || f.id.startsWith('foreign_currency')));
  const openVat = vat.filter((f) => status(f) !== 'resolved');
  const signed = work.signedOff;
  return (
    <>
      <section className="panel panel-pad stack-2" aria-labelledby="answer">
        <div className="spread">
          <h2 id="answer">{signed ? 'Yes. The migration is signed off.' : ready ? 'Almost. Everything is ready for sign-off.' : 'The books are in. Sign-off is still open.'}</h2>
          {signed ? <Status kind="settled">Signed off <DateText iso={signed.at} /></Status> : <Status kind="open">In progress</Status>}
        </div>
        <p className="measure">
          {idx.invoices.length.toLocaleString(cfg.numberLocale)} invoices and {idx.bank.length.toLocaleString(cfg.numberLocale)} bank transactions were loaded and every booking balances.
          {' '}{signed ? `The ${lead} signed off on ${new Date(signed.at).toLocaleDateString(cfg.dateLocale)}.` : `The ${lead} has settled ${progress.requiredSettled} of ${progress.required} required questions.`}
        </p>
      </section>
      <div className="panel facts">
        <div className="fact"><div className="label">Customers owe you, net of credit notes</div><div className="value"><Amount value={metrics.net_receivables_eur.value as Cents} currency="EUR" trace={{ kind: 'metric', id: 'net_receivables_eur' }} label="net receivables" /></div><div className="foot">plus <Amount value={metrics.open_receivables_usd.value as Cents} currency="USD" /> in US dollars</div></div>
        <div className="fact"><div className="label">You owe suppliers</div><div className="value"><Amount value={metrics.open_payables_eur.value as Cents} currency="EUR" trace={{ kind: 'metric', id: 'open_payables_eur' }} label="open payables" /></div></div>
        <div className="fact"><div className="label">Questions left before sign-off</div><div className="value num">{progress.blockingOpen}</div><div className="foot">{progress.optional - progress.optionalAnswered} more can stay open</div></div>
      </div>
      <section className="panel panel-pad stack-2" aria-labelledby="needs">
        <h2 id="needs">Does anything need you?</h2>
        {openVat.length === 0
          ? <p>No. {vat.length ? `The ${vat.length} VAT points found during the migration are settled.` : 'Nothing waits on you.'}</p>
          : <>
              <p>Nothing to act on. {openVat.length === 1 ? 'One VAT point is' : `${openVat.length} VAT points are`} still open; your {who(cfg, 'tax_advisor')} will look at {openVat.length === 1 ? 'it' : 'them'} before the first VAT return:</p>
              <ul style={{ margin: 0, paddingLeft: 20 }}>{openVat.map((f) => <li key={f.id}>{f.title}{f.amount && <> (<Amount value={f.amount.value} currency={f.amount.currency} /> {f.amount.label})</>}</li>)}</ul>
              <p className="cap muted">The {lead} has the details.</p>
            </>}
      </section>
    </>
  );
}
