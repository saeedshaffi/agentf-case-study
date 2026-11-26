import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react';
import { blockingFindings, checkStatus, runChecks, type CheckStatus, type Finding } from '../domain/checks';
import type { CustomerConfig, PageId, RoleId } from '../domain/config';
import { groupDecisions, progress, type DecisionGroup, type Progress } from '../domain/decisions';
import { buildIndex, ENDPOINTS, fetchEndpoint, type Endpoint, type EndpointState } from '../domain/load';
import { computeMetrics, type Metric, type MetricId, type TraceTarget } from '../domain/metrics';
import { parseStored, reduce, type Action, type WorkState } from '../domain/store';
import type { EngineData, Indexed, Summary } from '../domain/types';
import { navigate, useRoute, type Route } from './router';

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
  const attempts = useRef<Record<string, number>>({});
  const load = useCallback((ep: Endpoint) => {
    const attempt = attempts.current[ep] = (attempts.current[ep] ?? -1) + 1;
    setEndpoints((s) => ({ ...s, [ep]: { status: 'loading' } }));
    const delay = opts.latencyMs ? opts.latencyMs * (ep === 'invoices' ? 3 : ep === 'bank_transactions' ? 2 : 1) : 0;
    const p = opts.fail === ep && attempt === 0
      ? new Promise((_, rej) => setTimeout(() => rej(new Error('the server did not answer in time')), delay || 300))
      : fetchEndpoint(cfg, ep, delay);
    p.then(
      (data) => setEndpoints((s) => ({ ...s, [ep]: { status: 'ready', data } })),
      (e: Error) => setEndpoints((s) => ({ ...s, [ep]: { status: 'error', message: e.message.replace(/^\w+: /, '') } })),
    );
  }, [cfg, opts.latencyMs, opts.fail]);

  useEffect(() => { ENDPOINTS.forEach((ep) => load(ep)); }, [load]);

  const ready = (ep: Endpoint) => (endpoints[ep].status === 'ready' ? (endpoints[ep] as { data: unknown }).data : undefined);
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
  return { endpoints, summary: ready('summary') as Summary | undefined, idx, retry: load };
}

// ---------- derived state, computed once per change ----------

export interface Derived {
  groups: DecisionGroup[];
  findings: Finding[];
  metrics: Record<MetricId, Metric>;
  progress: Progress;
  status: (f: Finding) => CheckStatus;
  blocking: Finding[];
  /** Everything that stands between the finance lead and sign-off. */
  ready: boolean;
}

// ---------- context ----------

export interface ToastMsg { text: string; undo?: () => void; undoLabel?: string; tone?: 'neutral' | 'error' }

export interface AppState {
  cfg: CustomerConfig;
  role: RoleId;
  setRole: (r: RoleId) => void;
  route: Route;
  page: PageId;
  go: (p: PageId, ...params: (string | undefined)[]) => void;
  data: DataState;
  work: WorkState;
  dispatch: (a: Action) => void;
  derived?: Derived;
  storageProblem?: string;
  trace: TraceTarget[];
  openTrace: (t: TraceTarget, opts?: { push?: boolean }) => void;
  closeTrace: () => void;
  popTrace: (to: number) => void;
  toast: ToastMsg | null;
  showToast: (t: ToastMsg | null) => void;
}

const Ctx = createContext<AppState | null>(null);

export function useApp(): AppState {
  const c = useContext(Ctx);
  if (!c) throw new Error('useApp outside provider');
  return c;
}

/** Derived data is only available once every endpoint has loaded. Components behind <Needs> may assert it. */
export function useDerived(): Derived & { idx: Indexed } {
  const { derived, data } = useApp();
  if (!derived || !data.idx) throw new Error('useDerived before data loaded');
  return { ...derived, idx: data.idx };
}

/** Only own keys of the config count as roles: `?role=constructor` must not resolve to Object.prototype. */
export function validRole(cfg: CustomerConfig, r: string | null | undefined): RoleId | null {
  return r && Object.prototype.hasOwnProperty.call(cfg.roles, r) ? (r as RoleId) : null;
}

const storageKey = (cfg: CustomerConfig) => `agentf:${cfg.id}:migration`;

export function AppProvider(props: {
  cfg: CustomerConfig; initialRole: RoleId; latencyMs: number; fail?: string; children: ReactNode;
}) {
  const { cfg } = props;
  const [role, setRoleState] = useState<RoleId>(props.initialRole);
  const route = useRoute();
  const [{ initial, problem }] = useState(() => {
    let raw: string | null = null;
    try { raw = localStorage.getItem(storageKey(cfg)); } catch { /* storage blocked */ }
    const r = parseStored(raw);
    return { initial: r.state, problem: r.problem };
  });
  const [work, dispatch] = useReducer(reduce, initial);
  const [trace, setTrace] = useState<TraceTarget[]>([]);
  const [toast, setToast] = useState<ToastMsg | null>(null);
  const data = useEngineData(cfg, { latencyMs: props.latencyMs, fail: props.fail });

  useEffect(() => {
    try { localStorage.setItem(storageKey(cfg), JSON.stringify(work)); } catch { /* ignore */ }
  }, [cfg, work]);

  // Another tab changed the same customer's work: follow it instead of overwriting it.
  useEffect(() => {
    const on = (e: StorageEvent) => { if (e.key === storageKey(cfg) && e.newValue) location.reload(); };
    window.addEventListener('storage', on);
    return () => window.removeEventListener('storage', on);
  }, [cfg]);

  const pages = cfg.roles[role].pages;
  const page: PageId = route.page && pages.includes(route.page) ? route.page : pages[0];
  useEffect(() => {
    if (!route.page || !pages.includes(route.page)) navigate(pages[0]);
  }, [route.page, pages]);

  const base = useMemo(() => {
    if (!data.idx) return undefined;
    return { groups: groupDecisions(data.idx, cfg), findings: runChecks(data.idx, cfg), metrics: computeMetrics(data.idx) };
  }, [data.idx, cfg]);

  const derived = useMemo<Derived | undefined>(() => {
    if (!base) return undefined;
    const p = progress(base.groups, work.answers);
    const status = (f: Finding) => checkStatus(f, work.answers, work.acks);
    const blocking = blockingFindings(base.findings, work.answers, work.acks);
    return { ...base, progress: p, status, blocking, ready: p.blockingOpen === 0 && blocking.length === 0 };
  }, [base, work.answers, work.acks]);

  // Saved work is checked against the data once it is loaded: answers must name a real question and one of its
  // options, and a saved sign-off must still be earned by the saved work.
  useEffect(() => {
    if (!data.idx) return;
    const bad = Object.entries(work.answers).filter(([id, a]) => !data.idx!.decisionById.get(id)?.options.some((o) => o.id === a.optionId)).map(([id]) => id);
    if (bad.length) dispatch({ t: 'prune', ids: bad });
  }, [data.idx, work.answers]);
  useEffect(() => {
    if (derived && work.signedOff && !derived.ready) dispatch({ t: 'reopen', by: work.signedOff.by, note: 'The saved sign-off did not match the saved work and was withdrawn.' });
  }, [derived, work.signedOff]);

  const setRole = (r: RoleId) => {
    setRoleState(r);
    setTrace([]);
    const u = new URL(location.href);
    u.searchParams.set('role', r);
    u.hash = '#/' + ({ finance_lead: 'overview', tax_advisor: 'records', owner: 'summary' } as const)[r];
    history.replaceState(null, '', u);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  };

  const value: AppState = {
    cfg, role, setRole, route, page,
    go: (p, ...params) => { if (pages.includes(p)) { navigate(p, ...params); setTrace([]); } },
    data, work, dispatch, derived, storageProblem: problem,
    trace,
    openTrace: (t, opts) => setTrace((s) => (opts?.push === false ? [t] : [...s, t])),
    closeTrace: () => setTrace([]),
    popTrace: (to) => setTrace((s) => s.slice(0, to + 1)),
    toast, showToast: setToast,
  };
  return <Ctx.Provider value={value}>{props.children}</Ctx.Provider>;
}
