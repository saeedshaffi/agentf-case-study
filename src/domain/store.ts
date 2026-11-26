import type { RoleId } from './config';
import type { Answers } from './decisions';

// The finance lead's work: answers, acknowledgements, sign-off, and a log of every change.
// Pure functions, so the rules (what counts as an answer, what undo restores, what sign-off locks)
// are testable without a browser.

export const STORE_VERSION = 2;

export type LogAction =
  | 'answered' | 'undone' | 'acknowledged' | 'unacknowledged' | 'signed_off' | 'reopened' | 'invited';

export interface LogEntry {
  at: string;
  by: RoleId;
  action: LogAction;
  decisionId?: string;
  findingId?: string;
  optionId?: string;
  value?: string;
  /** Answers given in one bulk action share a batch id. */
  batch?: string;
  note?: string;
}

export interface SignOff { at: string; by: RoleId; openOptional: number; acknowledged: string[] }

export interface WorkState {
  v: typeof STORE_VERSION;
  answers: Answers;
  acks: Record<string, { at: string; by: RoleId }>;
  log: LogEntry[];
  signedOff?: SignOff;
  advisorInvited?: string;
}

export const emptyState = (): WorkState => ({ v: STORE_VERSION, answers: {}, acks: {}, log: [] });

export type Action =
  | { t: 'answer'; items: { id: string; optionId: string; value?: string }[]; by: RoleId; batch?: string; at?: string }
  | { t: 'undo'; ids: string[]; by: RoleId; at?: string }
  | { t: 'ack'; id: string; on: boolean; by: RoleId; at?: string }
  | { t: 'signOff'; by: RoleId; openOptional: number; at?: string }
  | { t: 'reopen'; by: RoleId; note?: string; at?: string }
  | { t: 'invite'; by: RoleId; at?: string }
  | { t: 'reset' };

export function reduce(s: WorkState, a: Action): WorkState {
  const at = ('at' in a && a.at) || new Date().toISOString();
  switch (a.t) {
    case 'answer': {
      if (s.signedOff || !a.items.length) return s;
      const answers = { ...s.answers };
      const log = [...s.log];
      for (const it of a.items) {
        const prev = answers[it.id];
        // Re-submitting the same answer is a no-op: protects against double clicks.
        if (prev && prev.optionId === it.optionId && prev.value === it.value) continue;
        answers[it.id] = { optionId: it.optionId, value: it.value, by: a.by, at, batch: a.batch, bulk: !!a.batch };
        log.push({ at, by: a.by, action: 'answered', decisionId: it.id, optionId: it.optionId, value: it.value, batch: a.batch });
      }
      return log.length === s.log.length ? s : { ...s, answers, log };
    }
    case 'undo': {
      if (s.signedOff) return s;
      const ids = a.ids.filter((id) => s.answers[id]);
      if (!ids.length) return s;
      const answers = { ...s.answers };
      for (const id of ids) delete answers[id];
      return { ...s, answers, log: [...s.log, ...ids.map((id) => ({ at, by: a.by, action: 'undone' as const, decisionId: id, batch: s.answers[id].batch }))] };
    }
    case 'ack': {
      if (s.signedOff || !!s.acks[a.id] === a.on) return s;
      const acks = { ...s.acks };
      if (a.on) acks[a.id] = { at, by: a.by }; else delete acks[a.id];
      return { ...s, acks, log: [...s.log, { at, by: a.by, action: a.on ? 'acknowledged' : 'unacknowledged', findingId: a.id }] };
    }
    case 'signOff':
      if (s.signedOff) return s;
      return { ...s, signedOff: { at, by: a.by, openOptional: a.openOptional, acknowledged: Object.keys(s.acks) }, log: [...s.log, { at, by: a.by, action: 'signed_off' }] };
    case 'reopen':
      if (!s.signedOff) return s;
      return { ...s, signedOff: undefined, advisorInvited: undefined, log: [...s.log, { at, by: a.by, action: 'reopened', note: a.note }] };
    case 'invite':
      if (!s.signedOff || s.advisorInvited) return s;
      return { ...s, advisorInvited: at, log: [...s.log, { at, by: a.by, action: 'invited' }] };
    case 'reset':
      return emptyState();
  }
}

/** All answer ids that belong to the same batch as `id` (or just `id`). */
export function batchOf(s: WorkState, id: string): string[] {
  const b = s.answers[id]?.batch;
  if (!b) return [id];
  return Object.entries(s.answers).filter(([, a]) => a.batch === b).map(([k]) => k);
}

const ROLES = ['finance_lead', 'tax_advisor', 'owner'];
const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);

/**
 * Reads whatever is in storage and returns a valid state, or a fresh one plus a reason.
 * Accepts the version-1 shape written by earlier builds.
 */
export function parseStored(raw: string | null): { state: WorkState; problem?: string } {
  if (!raw) return { state: emptyState() };
  let x: unknown;
  try { x = JSON.parse(raw); } catch { return { state: emptyState(), problem: 'Saved work could not be read and was set aside.' }; }
  if (!isObj(x)) return { state: emptyState(), problem: 'Saved work had an unexpected shape and was set aside.' };
  const answers: Answers = {};
  if (isObj(x.answers)) {
    for (const [k, v] of Object.entries(x.answers)) {
      if (isObj(v) && typeof v.optionId === 'string' && ROLES.includes(String(v.by))) {
        answers[k] = { optionId: v.optionId, value: typeof v.value === 'string' ? v.value : undefined, by: v.by as RoleId, at: String(v.at ?? ''), batch: typeof v.batch === 'string' ? v.batch : undefined, bulk: !!v.bulk };
      }
    }
  }
  const acks: WorkState['acks'] = {};
  const rawAcks = isObj(x.acks) ? x.acks : isObj(x.acknowledged) ? x.acknowledged : {};
  for (const [k, v] of Object.entries(rawAcks)) acks[k] = isObj(v) ? { at: String(v.at ?? ''), by: (ROLES.includes(String(v.by)) ? v.by : 'finance_lead') as RoleId } : { at: String(v), by: 'finance_lead' };
  const log: LogEntry[] = Array.isArray(x.log) ? (x.log.filter((e) => isObj(e) && typeof e.action === 'string' && typeof e.at === 'string') as unknown as LogEntry[]) : [];
  // A sign-off is only honoured if it has the version-2 shape; anything else must be signed again.
  const so = isObj(x.signedOff) && x.v === STORE_VERSION && typeof x.signedOff.at === 'string' && ROLES.includes(String(x.signedOff.by)) ? (x.signedOff as unknown as SignOff) : undefined;
  return { state: { v: STORE_VERSION, answers, acks, log, signedOff: so, advisorInvited: so && typeof x.advisorInvited === 'string' ? x.advisorInvited : undefined } };
}
