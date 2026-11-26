import { blockingFindings, checkStatus, loadFunnel, runChecks } from './checks';
import { groupDecisions, previewEffect, progress } from './decisions';
import { agreesWithEngine, computeMetrics } from './metrics';
import { toDecimalString } from './money';
import { trialBalance, totalOf } from './ledger';
import { parseConfig, ConfigError } from './config';
import { loadCustomer } from '../test/fixtures';

const { cfg, idx } = loadCustomer();

describe('metrics recomputed from records', () => {
  const m = computeMetrics(idx);
  it('agree with every figure the engine reports', () => {
    for (const metric of Object.values(m)) {
      if (metric.engineValue !== undefined) expect([metric.id, agreesWithEngine(metric)]).toEqual([metric.id, true]);
    }
  });
  it('shows open credit notes the engine leaves out of open receivables', () => {
    expect(toDecimalString(m.open_receivables_eur.value as bigint)).toBe('5216558.36');
    expect(toDecimalString(m.open_credit_notes_eur.value as bigint)).toBe('560940.33');
    expect(toDecimalString(m.net_receivables_eur.value as bigint)).toBe('4655618.03');
  });
  it('keeps USD separate', () => {
    expect(m.open_receivables_usd.currency).toBe('USD');
    expect(toDecimalString(m.open_receivables_usd.value as bigint)).toBe('228491.60');
  });
});

describe('load funnel', () => {
  it('reconciles rows read to invoices loaded', () => {
    const f = loadFunnel(idx);
    expect(f).toMatchObject({ rowsRead: 1877, duplicates: 72, superseded: 35, loaded: 1770, reconciles: true });
    expect(f.corrected).toHaveLength(17);
    expect(f.repeats).toHaveLength(18);
  });
});

describe('decision groups', () => {
  const groups = groupDecisions(idx, cfg);
  it('covers all 168 questions exactly once', () => {
    const ids = groups.flatMap((g) => g.decisions.map((d) => d.id));
    expect(ids).toHaveLength(168);
    expect(new Set(ids).size).toBe(168);
  });
  it('puts tax first and cents last', () => {
    expect(groups.map((g) => g.config.id)).toEqual([
      'vat_zero_rated', 'country', 'classification',
      'unmatched_receipt', 'unexplained_refund', 'overpayment', 'duplicate_partner', 'vat_id_domestic', 'rounding',
    ]);
  });
  it('sends the zero-rated EU customer to the tax group and the German one to records', () => {
    expect(groups[0].decisions.map((d) => d.id)).toEqual(['D0168']);
    expect(groups.find((g) => g.config.id === 'vat_id_domestic')!.decisions.map((d) => d.id)).toEqual(['D0167']);
  });
  it('clusters classifications by description, largest first', () => {
    const c = groups.find((g) => g.config.id === 'classification')!;
    expect(c.clusters.map((x) => x.decisions.length).reduce((a, b) => a + b)).toBe(89);
    expect(c.clusters.length).toBe(3);
    expect(c.clusters[0].amount >= c.clusters[1].amount).toBe(true);
  });
  it('puts unknown question types into Other instead of dropping them', () => {
    const extra = { ...idx.decisions[0], id: 'DX', type: 'something_new' };
    const g = groupDecisions({ ...idx, decisions: [...idx.decisions, extra] }, cfg);
    expect(g.find((x) => x.config.id === '_other')!.decisions.map((d) => d.id)).toEqual(['DX']);
  });
  it('tracks what still blocks sign-off', () => {
    const p = progress(groups, {});
    expect(p).toMatchObject({ total: 168, answered: 0 });
    expect(p.blockingOpen).toBe(1 + 1 + 1 + 89 + 24);
  });
});

describe('effects', () => {
  it('moves the net amount between expense accounts and keeps the books balanced', () => {
    const d = idx.decisionById.get('D0002')!;
    expect(previewEffect(d, '6825', idx).lines).toEqual([]); // already booked there
    const e = previewEffect(d, '6300', idx);
    expect(e.lines.map((l) => [l.account, toDecimalString(l.delta)])).toEqual([
      ['6825', '-13257.94'],
      ['6300', '13257.94'],
    ]);
    const before = trialBalance(idx, {});
    const after = trialBalance(idx, { D0002: { optionId: '6300', by: 'finance_lead', at: '' } });
    expect(after.find((r) => r.account === '6300')!.balanceAfter - after.find((r) => r.account === '6300')!.balance).toBe(1325794n);
    const net = (rows: typeof before) => rows.reduce((t, r) => t + r.balanceAfter, 0n);
    expect(net(after)).toBe(net(before));
    expect(totalOf(after, 'debit')).toBe(totalOf(before, 'debit'));
  });
});

describe('checks', () => {
  const f = runChecks(idx, cfg);
  const byId = (p: string) => f.find((x) => x.id.startsWith(p));
  // Expected values below were recomputed independently in Python from the raw JSON (audit/harness/di-recompute.py),
  // not with the functions under test.
  it('explains the 4 overpayments as invoices lowered after payment', () => {
    const x = byId('overpaid_without_decision')!;
    expect(x.items).toHaveLength(4);
    expect(toDecimalString(x.amount!.value)).toBe('4365.62');
    expect(x.title).toMatch(/lowered after the customer had paid/);
    expect(x.next).not.toMatch(/income/);
  });
  it('flags zero-rated sales to the customer with VAT ID "n/a", counting the credit note separately', () => {
    const x = byId('zero_rated_no_vat_id:K00059')!;
    expect(x.needsAttention).toBe(true);
    expect(x.items.filter((i) => i.kind === 'invoice')).toHaveLength(11);
    expect(x.detail).toMatch(/^10 invoices and 1 credit note/);
    expect(toDecimalString(x.amount!.value)).toBe('81660.65');
    expect(x.decisionIds).toEqual(['D0168']);
  });
  it('flags German VAT on USD invoices for the customer without a country', () => {
    const x = byId('foreign_currency_with_de_vat:K00018')!;
    expect(x.items.filter((i) => i.kind === 'invoice')).toHaveLength(5);
    expect(toDecimalString(x.amount!.value)).toBe('9072.80');
  });
  it('counts inconsistent model suggestions exactly: 10 of 11 pairs, 88 invoices', () => {
    const x = byId('inconsistent_suggestions')!;
    expect(x.detail).toMatch(/For 10 of 11 supplier-and-description pairs/);
    expect(x.affected!.count).toBe(88);
  });
  it('labels the three USD questions the engine marks as EUR', () => {
    const x = byId('decision_currency')!;
    expect(x.items.map((i) => i.id).sort()).toEqual(['D0109', 'D0123', 'D0143']);
  });
  it('lists each FX invoice once', () => {
    const ids = byId('fx')!.items.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it('verifies the engine totals, the journal and the row count', () => {
    for (const id of ['summary_reconciles', 'balanced', 'rows_accounted']) expect(checkStatus(byId(id)!, {}, {})).toBe('passed');
  });
});

describe('finding states', () => {
  const f = runChecks(idx, cfg);
  const vat = f.find((x) => x.id === 'zero_rated_no_vat_id:K00059')!;
  const cn = f.find((x) => x.id === 'credit_notes_in_open_items')!;
  const a = (optionId: string) => ({ optionId, by: 'finance_lead' as const, at: '' });
  it('an answer that defers does not resolve a finding', () => {
    expect(checkStatus(vat, { D0168: a('ask_customer') }, {})).toBe('open');
    expect(checkStatus(vat, { D0168: { ...a('enter'), value: 'FR40303265045' } }, {})).toBe('resolved');
  });
  it('acknowledging is never shown as resolved', () => {
    expect(checkStatus(cn, {}, { credit_notes_in_open_items: { at: '', by: 'finance_lead' } })).toBe('acknowledged');
    expect(blockingFindings(f, {}, { credit_notes_in_open_items: { at: '', by: 'finance_lead' } }).map((x) => x.id)).not.toContain('credit_notes_in_open_items');
  });
  it('blocks sign-off on the five open findings at the start', () => {
    expect(blockingFindings(f, {}, {}).map((x) => x.id).sort()).toEqual([
      'credit_notes_in_open_items', 'foreign_currency_with_de_vat:K00018', 'inconsistent_suggestions', 'overpaid_without_decision', 'zero_rated_no_vat_id:K00059',
    ]);
  });
});

describe('progress', () => {
  const groups = groupDecisions(idx, cfg);
  it('separates 116 required from 52 optional', () => {
    const p = progress(groups, {});
    expect(p).toMatchObject({ total: 168, required: 116, optional: 52, blockingOpen: 116, requiredSettled: 0 });
  });
  it('keeps a deferred required answer blocking', () => {
    const p = progress(groups, { D0168: { optionId: 'ask_customer', by: 'finance_lead', at: '' } });
    expect(p).toMatchObject({ answered: 1, requiredSettled: 0, blockingOpen: 116, requiredDeferred: 1 });
  });
  it('never mixes USD into euro group totals', () => {
    const over = groups.find((g) => g.config.id === 'overpayment')!;
    expect(toDecimalString(over.amounts.get('EUR')!)).toBe('160.00');
    expect(toDecimalString(over.amounts.get('USD')!)).toBe('20.01');
  });
});

describe('config', () => {
  it('lists every problem in an invalid config', () => {
    try {
      parseConfig({ id: 'x', company: 'X', roles: {}, decisionGroups: [{ id: 'a', match: {}, stake: 'nope' }] });
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(ConfigError);
      expect(String(e)).toMatch(/roles.finance_lead is missing/);
      expect(String(e)).toMatch(/no match.type/);
      expect(String(e)).toMatch(/unknown stake/);
    }
  });
});
