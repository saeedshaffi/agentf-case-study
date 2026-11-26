import { useEffect, useRef } from 'react';
import { who, type PageId, type RoleId } from './domain/config';
import { Overview } from './pages/Overview';
import { Decisions } from './pages/Decisions';
import { Checks } from './pages/Checks';
import { Records } from './pages/Records';
import { SignOff } from './pages/SignOff';
import { DecisionLog } from './pages/DecisionLog';
import { Summary } from './pages/Summary';
import { Toast } from './ui/components';
import { href } from './ui/router';
import { TracePanel } from './ui/TracePanel';
import { useApp } from './ui/state';

const PAGE_LABEL: Record<PageId, string> = {
  arrival: 'Overview', decisions: 'Decisions', checks: 'Checks', books: 'Records',
  handover: 'Sign-off', decisionLog: 'Decision log', overview: 'Summary',
};

export function App() {
  const { cfg, role, setRole, page, route, derived, work, storageProblem } = useApp();
  const pages = cfg.roles[role].pages;
  const prevPage = useRef(page);

  // Move focus to the new page's heading when the page changes (not on first load), so keyboard and
  // screen-reader users land there.
  useEffect(() => {
    if (prevPage.current === page) return;
    prevPage.current = page;
    window.scrollTo(0, 0);
    requestAnimationFrame(() => document.getElementById('page-title')?.focus({ preventScroll: true }));
  }, [page]);

  useEffect(() => { document.title = `${PAGE_LABEL[page]} · ${cfg.shortName} migration`; }, [page, cfg.shortName]);

  const count = (p: PageId): string | null => {
    if (!derived) return null;
    if (p === 'decisions') return derived.progress.blockingOpen ? `${derived.progress.blockingOpen} required` : 'Done';
    if (p === 'checks') return derived.blocking.length ? `${derived.blocking.length} open` : null;
    if (p === 'handover') return work.signedOff ? 'Signed off' : derived.ready ? 'Ready' : null;
    return null;
  };

  return (
    <div className="shell">
      <a className="skip" href="#main">Skip to content</a>
      <aside className="sidebar">
        <div>
          <div className="brand-company">{cfg.company}</div>
          <div className="brand-sub">Migration to Agent F</div>
        </div>
        <nav className="nav" aria-label="Main">
          {pages.map((p) => (
            <a key={p} href={href(p)} aria-current={page === p ? 'page' : undefined}>
              <span>{PAGE_LABEL[p]}</span>
              {count(p) && <span className="count">{count(p)}</span>}
            </a>
          ))}
        </nav>
        <div className="proto" aria-label="Prototype controls" role="group">
          <div>Prototype only. In the product, the login decides what you see.</div>
          <label>
            <span className="sr-only">View as</span>
            <select className="select" value={role} onChange={(e) => setRole(e.target.value as RoleId)}>
              {(Object.keys(cfg.roles) as RoleId[]).map((r) => <option key={r} value={r}>View as {who(cfg, r)}</option>)}
            </select>
          </label>
        </div>
      </aside>
      <main className={`main ${page === 'decisions' ? 'wide' : ''}`} id="main" tabIndex={-1}>
        {storageProblem && <div style={{ marginBottom: 16 }} className="notice attention" role="status">{storageProblem}</div>}
        {page === 'arrival' && <Overview />}
        {page === 'decisions' && <Decisions groupId={route.params[0]} />}
        {page === 'checks' && <Checks findingId={route.params[0]} />}
        {page === 'books' && <Records tab={route.params[0]} />}
        {page === 'handover' && <SignOff />}
        {page === 'decisionLog' && <DecisionLog />}
        {page === 'overview' && <Summary />}
      </main>
      <TracePanel />
      <Toast />
    </div>
  );
}
