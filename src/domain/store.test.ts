import { batchOf, emptyState, parseStored, reduce, type WorkState } from './store';

const by = 'finance_lead' as const;
const answer = (s: WorkState, ids: string[], optionId: string, batch?: string) =>
  reduce(s, { t: 'answer', items: ids.map((id) => ({ id, optionId })), by, batch, at: 't1' });

describe('work store', () => {
  it('records answers and logs them', () => {
    const s = answer(emptyState(), ['D1'], 'x');
    expect(s.answers.D1.optionId).toBe('x');
    expect(s.log).toHaveLength(1);
  });
  it('ignores a repeated identical answer (double click)', () => {
    const s1 = answer(emptyState(), ['D1'], 'x');
    expect(answer(s1, ['D1'], 'x')).toBe(s1);
  });
  it('undoes a whole bulk batch from any member', () => {
    let s = answer(emptyState(), ['D1', 'D2', 'D3'], '6825', 'b1');
    s = answer(s, ['D4'], '6300');
    expect(batchOf(s, 'D2').sort()).toEqual(['D1', 'D2', 'D3']);
    s = reduce(s, { t: 'undo', ids: batchOf(s, 'D2'), by });
    expect(Object.keys(s.answers)).toEqual(['D4']);
  });
  it('locks answers after sign-off and unlocks on reopen, logging both', () => {
    let s = reduce(answer(emptyState(), ['D1'], 'x'), { t: 'signOff', by, openOptional: 3 });
    expect(answer(s, ['D2'], 'y')).toBe(s);
    expect(reduce(s, { t: 'undo', ids: ['D1'], by })).toBe(s);
    s = reduce(s, { t: 'reopen', by });
    expect(s.signedOff).toBeUndefined();
    expect(s.log.map((e) => e.action)).toEqual(['answered', 'signed_off', 'reopened']);
  });
  it('only allows inviting the advisor after sign-off', () => {
    expect(reduce(emptyState(), { t: 'invite', by }).advisorInvited).toBeUndefined();
  });
  it('acknowledges and withdraws, with a log entry each time', () => {
    let s = reduce(emptyState(), { t: 'ack', id: 'f1', on: true, by });
    expect(s.acks.f1).toBeTruthy();
    s = reduce(s, { t: 'ack', id: 'f1', on: false, by });
    expect(s.acks.f1).toBeUndefined();
    expect(s.log.map((e) => e.action)).toEqual(['acknowledged', 'unacknowledged']);
  });
});

describe('reading saved work', () => {
  it('survives garbage', () => {
    expect(parseStored('{not json').problem).toBeTruthy();
    expect(parseStored('[]').state.answers).toEqual({});
  });
  it('drops malformed answers and an unversioned sign-off', () => {
    const raw = JSON.stringify({ answers: { D1: { optionId: 'x', by: 'finance_lead' }, D2: { by: 'hacker' } }, signedOff: { at: 'x', by: 'finance_lead' } });
    const { state } = parseStored(raw);
    expect(Object.keys(state.answers)).toEqual(['D1']);
    expect(state.signedOff).toBeUndefined();
  });
  it('reads version-1 acknowledgements', () => {
    expect(parseStored(JSON.stringify({ answers: {}, acknowledged: { f1: '2026-01-01' } })).state.acks.f1.at).toBe('2026-01-01');
  });
});
