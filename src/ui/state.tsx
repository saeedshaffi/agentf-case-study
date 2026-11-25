import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useState, type ReactNode } from 'react';
import type { CustomerConfig, PageId, RoleId } from '../domain/config';
import { nowIso, type Answers, type LogEntry } from '../domain/decisions';
import { buildIndex, ENDPOINTS, fetchEndpoint, type Endpoint, type EndpointState } from '../domain/load';
import type { TraceTarget } from '../domain/metrics';
import type { EngineData, Indexed, Summary } from '../domain/types';

// ---------- persisted decision state ----------

interface Persisted { answers: Answers; log: LogEntry[]; acknowledged?: Record<string, string>; signedOff?: { at: string; by: RoleId }; advisorInvited?: string }

type Action =
  | { t: 'answer'; ids: string[]; optionId: (id: string) => string; value?: string; by: RoleId; bulk?: boolean }
  | { t: 'undo'; id: string; by: RoleId }
  | { t: 'signOff'; by: RoleId }
  | { t: 'reopen'; by: RoleId }
  | { t: 'invite'; at: string }
  | { t: 'ack'; id: string; on: boolean }
  | { t: 'reset' };

function reducer(s: Persisted, a: Action): Persisted {
  const at = nowIso();
  switch (a.t) {
    case 'answer': {
      if (s.signedOff) return s;
      const answers = { ...s.answers };
      const log = [...s.log];
      for (const id of a.ids) {
        const optionId = a.optionId(id);
        answers[id] = { optionId, value: a.value, by: a.by, at, bulk: a.bulk };
        log.push({ at, by: a.by, decisionId: id, action: 'answered', optionId, value: a.value, bulk: a.bulk });
      }
      return { ...s, answers, log };
    }
    case 'undo': {
      if (s.signedOff || !s.answers[a.id]) return s;
      const { [a.id]: _gone, ...answers } = s.answers;
      return { ...s, answers, log: [...s.log, { at, by: a.by, decisionId: a.id, action: 'undone' }] };
    }
    case 'signOff': return { ...s, signedOff: { at, by: a.by } };
    case 'reopen': return { ...s, signedOff: undefined };
    case 'invite': return { ...s, advisorInvited: a.at };
    case 'ack': {
      const acknowledged = { ...(s.acknowledged ?? {}) };
      if (a.on) acknowledged[a.id] = at; else delete acknowledged[a.id];
      return { ...s, acknowledged };
    }
    case 'reset': return { answers: {}, log: [] };
  }
}

const storageKey = (cfg: CustomerConfig) => `agentf:${cfg.id}:migration`;

function loadPersisted(cfg: CustomerConfig): Persisted {
  try {
    const raw = localStorage.getItem(storageKey(cfg));
    if (raw) return JSON.parse(raw);
  } catch { /* storage unavailable: start fresh */ }
  return { answers: {}, log: [] };
}

// ---------- data loading ----------

export interface DataState {
  endpoints: Record<Endpoint, EndpointState>;
  summary?: Summary;
  idx?: Indexed;
  retry: (ep: Endpoint) => void;
}

function useEngineData(cfg: CustomerConfig, opts: { latencyMs: number; fail?: string }): DataState {
  const [endpoints, setEndpoints] = useState<Record<Endpoint, EndpointState>>(
    () => Object.fromEntries(ENDPOINTS.map((e) => [e, { status: 'loading' }])) as Record<Endpoint, EndpointState>,
  );
  const load = useCallback((ep: Endpoint, attempt = 0) => {
    setEndpoints((s) => ({ ...s, [ep]: { status: 'loading' } }));
    // Larger files take longer in the demo latency mode so the loading states are visible.
    const delay = opts.latencyMs ? opts.latencyMs * (ep === 'invoices' ? 3 : ep === 'bank_transactions' ? 2 : 1) : 0;
    const p = opts.fail === ep && attempt === 0
      ? new Promise((_, rej) => setTimeout(() => rej(new Error(`${ep}: the server did not answer in time`)), delay || 300))
      : fetchEndpoint(cfg, ep, delay);
    p.then(
      (data) => setEndpoints((s) => ({ ...s, [ep]: { status: 'ready', data } })),
      (e: Error) => setEndpoints((s) => ({ ...s, [ep]: { status: 'error', message: e.message } })),
    );
  }, [cfg, opts.latencyMs, opts.fail]);

  const [attempts, setAttempts] = useState<Record<string, number>>({});
  useEffect(() => { ENDPOINTS.forEach((ep) => load(ep, 0)); }, [load]);
  const retry = useCallback((ep: Endpoint) => {
    const n = (attempts[ep] ?? 0) + 1;
    setAttempts((a) => ({ ...a, [ep]: n }));
    load(ep, n);
  }, [attempts, load]);

  const ready = (ep: Endpoint) => (endpoints[ep].status === 'ready' ? (endpoints[ep] as { data: unknown }).data : undefined);
  const summary = ready('summary') as Summary | undefined;
  const all = ENDPOINTS.every((e) => endpoints[e].status === 'ready');
  const idx = useMemo(() => {
    if (!all) return undefined;
    const d: EngineData = {
      summary: ready('summary') as EngineData['summary'],
      invoices: ready('invoices') as EngineData['invoices'],
      bank: ready('bank_transactions') as EngineData['bank'],
      decisions: ready('decisions') as EngineData['decisions'],
      partners: ready('partners') as EngineData['partners'],
      accounts: ready('accounts') as EngineData['accounts'],
    };
    return buildIndex(d);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all]);
  return { endpoints, summary, idx, retry };
}

// ---------- context ----------

export interface AppState {
  cfg: CustomerConfig;
  role: RoleId;
  setRole: (r: RoleId) => void;
  page: PageId;
  go: (p: PageId) => void;
  data: DataState;
  persisted: Persisted;
  dispatch: (a: Action) => void;
  trace: TraceTarget[];
  openTrace: (t: TraceTarget, opts?: { push?: boolean }) => void;
  closeTrace: () => void;
  popTrace: (to: number) => void;
  toast: ToastMsg | null;
  showToast: (t: ToastMsg | null) => void;
}

export interface ToastMsg { text: string; undo?: () => void }

const Ctx = createContext<AppState | null>(null);

export function useApp(): AppState {
  const c = useContext(Ctx);
  if (!c) throw new Error('useApp outside provider');
  return c;
}

export function AppProvider(props: {
  cfg: CustomerConfig; initialRole: RoleId; latencyMs: number; fail?: string; children: ReactNode;
}) {
  const { cfg } = props;
  const [role, setRoleState] = useState<RoleId>(props.initialRole);
  const [page, setPage] = useState<PageId>(() => cfg.roles[props.initialRole].pages[0]);
  const [persisted, dispatch] = useReducer(reducer, cfg, loadPersisted);
  const [trace, setTrace] = useState<TraceTarget[]>([]);
  const [toast, setToast] = useState<ToastMsg | null>(null);
  const data = useEngineData(cfg, { latencyMs: props.latencyMs, fail: props.fail });

  useEffect(() => {
    try { localStorage.setItem(storageKey(cfg), JSON.stringify(persisted)); } catch { /* ignore */ }
  }, [cfg, persisted]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast]);

  const setRole = (r: RoleId) => {
    setRoleState(r);
    setTrace([]);
    setPage(cfg.roles[r].pages[0]);
    const u = new URL(location.href); u.searchParams.set('role', r); history.replaceState(null, '', u);
  };
  const go = (p: PageId) => { if (cfg.roles[role].pages.includes(p)) { setPage(p); window.scrollTo(0, 0); } };

  const value: AppState = {
    cfg, role, setRole, page, go, data, persisted, dispatch,
    trace,
    openTrace: (t, opts) => setTrace((s) => (opts?.push === false ? [t] : [...s, t])),
    closeTrace: () => setTrace([]),
    popTrace: (to) => setTrace((s) => s.slice(0, to + 1)),
    toast, showToast: setToast,
  };
  return <Ctx.Provider value={value}>{props.children}</Ctx.Provider>;
}
