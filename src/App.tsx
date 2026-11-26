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

const JOURNEY: PageId[] = ['arrival', 'decisions', 'checks', 'handover'];

export function App() {
  const { cfg, role, setRole, page, route, derived, work, storageProblem, showToast } = useApp();
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

  // Moving between groups or findings inside a page: focus the new section's heading.
  const sub = route.params[0];
  const prevSub = useRef(sub);
  useEffect(() => {
    const from = prevSub.current;
    prevSub.current = sub;
    if (from === undefined || from === sub || prevPage.current !== page) return;
    window.scrollTo(0, 0);
    requestAnimationFrame(() => {
      const title = document.getElementById('group-title') ?? document.getElementById('finding-title');
      // On narrow screens the queue is stacked above the work area: bring the new section into view.
      if (title && title.getBoundingClientRect().top > window.innerHeight - 120) title.closest('section, article')?.scrollIntoView({ block: 'start' });
      title?.focus({ preventScroll: true });
    });
  }, [sub, page]);

  // After an answer, undo, acknowledgement or sign-off, the control that was used often disappears.
  // If that left focus on <body>, put it on the nearest section heading instead.
  // Remember the section the person last worked in, so focus can return there when a control disappears.
  const home = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const on = (e: FocusEvent) => { const el = (e.target as HTMLElement | null)?.closest?.('article, section') as HTMLElement | null; if (el) home.current = el; };
    document.addEventListener('focusin', on);
    return () => document.removeEventListener('focusin', on);
  }, []);
  const prevWork = useRef(work);
  useEffect(() => {
    if (prevWork.current === work) return; // not on first load
    prevWork.current = work;
    const t = requestAnimationFrame(() => requestAnimationFrame(() => {
      if (document.activeElement && document.activeElement !== document.body) return;
      if (document.querySelector('[role=dialog]')) return;
      const section = home.current && document.contains(home.current) ? home.current : null;
      if (section) { section.setAttribute('tabindex', '-1'); section.focus({ preventScroll: true }); return; }
      (document.getElementById('group-title') ?? document.getElementById('finding-title') ?? document.getElementById('readiness') ?? document.getElementById('page-title'))?.focus({ preventScroll: true });
    }));
    return () => cancelAnimationFrame(t);
  }, [work]);

  // A toast belongs to the page it was raised on.
  useEffect(() => { showToast(null); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [page, sub]);

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
        <div className="brand">
          <span className="brand-mark" aria-hidden>a.</span>
          <div>
            <div className="brand-company">Agent F</div>
            <div className="brand-sub">Migration</div>
          </div>
        </div>
        <nav className="nav" aria-label="Main">
          {[['Migration journey', pages.filter((p) => JOURNEY.includes(p))], ['Supporting', pages.filter((p) => !JOURNEY.includes(p))]].map(([title, list]) => (list as PageId[]).length > 0 && (
            <div key={title as string} className="nav-group">
              <div className="nav-title">{title as string}</div>
              {(list as PageId[]).map((p) => (
                <a key={p} href={href(p)} aria-current={page === p ? 'page' : undefined}>
                  <span>{PAGE_LABEL[p]}</span>
                  {count(p) && <span className="count">{count(p)}</span>}
                </a>
              ))}
            </div>
          ))}
        </nav>
        <div className="proto" aria-label="Prototype controls" role="group">
          <div>Prototype only. In the product, the login decides what you see; here roles and masking are applied on screen, not by a server.</div>
          <label>
            <span className="sr-only">View as</span>
            <select className="select" value={role} onChange={(e) => setRole(e.target.value as RoleId)}>
              {(Object.keys(cfg.roles) as RoleId[]).map((r) => <option key={r} value={r}>View as {who(cfg, r)}</option>)}
            </select>
          </label>
        </div>
      </aside>
      <div className="content">
      <header className="topbar">
        <div>
          <div className="topbar-company">{cfg.company}</div>
          <div className="brand-sub">Migration to Agent F</div>
        </div>
        {derived && pages.includes('handover') && (
          <a className="readiness" href={href('handover')}>
            {work.signedOff ? 'Signed off' : derived.ready ? 'Ready for sign-off' : `Sign-off · ${derived.progress.requiredSettled} of ${derived.progress.required} required`} <span aria-hidden>↗</span>
          </a>
        )}
      </header>
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
      </div>
      <TracePanel />
      <Toast />
    </div>
  );
}
