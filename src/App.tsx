import { useMemo } from 'react';
import type { PageId, RoleId } from './domain/config';
import { groupDecisions, progress } from './domain/decisions';
import { isResolved, runChecks } from './domain/checks';
import { Arrival } from './pages/Arrival';
import { Decisions } from './pages/Decisions';
import { Books, Checks, DecisionLog, Handover, Overview } from './pages/Other';
import { TracePanel } from './ui/TracePanel';
import { useApp } from './ui/state';

const PAGE_LABEL: Record<PageId, string> = {
  arrival: 'Arrival', decisions: 'Your decisions', checks: 'What we checked', books: 'Books',
  handover: 'Hand-over', decisionLog: 'Decision log', overview: 'Overview',
};

export function App() {
  const { cfg, role, setRole, page, go, data, persisted, toast, showToast } = useApp();
  const pages = cfg.roles[role].pages;
  const counts = useMemo(() => {
    if (!data.idx) return {} as Partial<Record<PageId, string>>;
    const p = progress(groupDecisions(data.idx, cfg), persisted.answers);
    const att = runChecks(data.idx, cfg).filter((f) => f.severity === 'attention' && !isResolved(f, persisted.answers) && !persisted.acknowledged?.[f.id]).length;
    return { decisions: `${p.total - p.answered}`, checks: att ? `${att}` : '', handover: persisted.signedOff ? '✓' : '' } as Partial<Record<PageId, string>>;
  }, [data.idx, cfg, persisted]);

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          {cfg.company}
          <small>Migration to Agent F · {cfg.people[role].displayName}</small>
        </div>
        <nav className="nav" aria-label="Migration steps">
          {pages.map((p, i) => (
            <button key={p} aria-current={page === p ? 'page' : undefined} onClick={() => go(p)}>
              <span><span className="step">{pages.length > 1 ? i + 1 : ''}</span>{PAGE_LABEL[p]}</span>
              {counts[p] && <span className="small">{counts[p]}</span>}
            </button>
          ))}
        </nav>
        <label className="viewas">
          Prototype: view as
          <select value={role} onChange={(e) => setRole(e.target.value as RoleId)}>
            {(Object.keys(cfg.roles) as RoleId[]).map((r) => <option key={r} value={r}>{cfg.people[r].displayName}</option>)}
          </select>
        </label>
      </aside>
      <main className="main" id="main">
        {page === 'arrival' && <Arrival />}
        {page === 'decisions' && <Decisions />}
        {page === 'checks' && <Checks />}
        {page === 'books' && <Books />}
        {page === 'handover' && <Handover />}
        {page === 'decisionLog' && <DecisionLog />}
        {page === 'overview' && <Overview />}
      </main>
      <TracePanel />
      {toast && (
        <div className="toast" role="status">
          {toast.text}
          {toast.undo && <button className="link" onClick={() => { toast.undo!(); showToast(null); }}>Undo</button>}
        </div>
      )}
    </div>
  );
}
