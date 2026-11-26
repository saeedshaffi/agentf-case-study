import { Component, StrictMode, useEffect, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import { App } from './App';
import type { CustomerConfig } from './domain/config';
import { fetchConfig } from './domain/load';
import { AppProvider, validRole } from './ui/state';
import './ui/styles.css';

// URL parameters (prototype only):
//   ?customer=<id>   which customers/<id>/ folder to use (default: VITE_CUSTOMER or "nordlicht")
//   ?role=<role>     finance_lead | tax_advisor | owner
//   ?latency=<ms>    simulate a slow API so loading states are visible
//   ?fail=<endpoint> make one endpoint fail once, to show the error state and retry
const params = new URLSearchParams(location.search);
const customerId = params.get('customer') ?? import.meta.env.VITE_CUSTOMER ?? 'nordlicht';

function Failure({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="main"><div className="notice blocking" role="alert"><div className="stack-2">
      <h1 style={{ fontSize: 20, lineHeight: '28px' }}>{title}</h1><p>{detail}</p>
      <p><a href={location.pathname}>Start again</a></p>
    </div></div></div>
  );
}

/** A render error shows a way out instead of a blank page. Saved work stays in the browser. */
class Boundary extends Component<{ children: ReactNode }, { error?: Error }> {
  state: { error?: Error } = {};
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (this.state.error) return <Failure title="This page could not be shown" detail={`Your saved answers are not affected. (${this.state.error.message})`} />;
    return this.props.children;
  }
}

function Root() {
  const [cfg, setCfg] = useState<CustomerConfig | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { fetchConfig(customerId).then(setCfg, (e: Error) => setErr(e.message)); }, []);
  if (err) return <Failure title="This workspace could not start" detail={err} />;
  if (!cfg) return <div className="main" aria-busy="true"><div className="skeleton" style={{ width: 240 }} /></div>;
  const role = validRole(cfg, params.get('role')) ?? 'finance_lead';
  return (
    <AppProvider cfg={cfg} initialRole={role} latencyMs={Number(params.get('latency') ?? 0) || 0} fail={params.get('fail') ?? undefined}>
      <App />
    </AppProvider>
  );
}

createRoot(document.getElementById('root')!).render(<StrictMode><Boundary><Root /></Boundary></StrictMode>);
