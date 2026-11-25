import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import type { CustomerConfig, RoleId } from './domain/config';
import { fetchConfig } from './domain/load';
import { AppProvider } from './ui/state';
import './ui/styles.css';

// URL parameters (prototype only):
//   ?customer=<id>   which customers/<id>/ folder to use (default: VITE_CUSTOMER or "nordlicht")
//   ?role=<role>     finance_lead | tax_advisor | owner
//   ?latency=<ms>    simulate a slow API so loading states are visible
//   ?fail=<endpoint> make one endpoint fail once, to show the error state and retry
const params = new URLSearchParams(location.search);
const customerId = params.get('customer') ?? import.meta.env.VITE_CUSTOMER ?? 'nordlicht';

function Root() {
  const [cfg, setCfg] = useState<CustomerConfig | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { fetchConfig(customerId).then(setCfg, (e: Error) => setErr(e.message)); }, []);
  if (err) return <div className="main"><div className="callout bad"><span className="icon">!</span><div><strong>This workspace could not start</strong><pre style={{ whiteSpace: 'pre-wrap' }}>{err}</pre></div></div></div>;
  if (!cfg) return <div className="main"><div className="skeleton" style={{ width: 240 }} /></div>;
  const role = (params.get('role') as RoleId) ?? 'finance_lead';
  document.title = `${cfg.shortName} · Migration`;
  return (
    <AppProvider cfg={cfg} initialRole={cfg.roles[role] ? role : 'finance_lead'} latencyMs={Number(params.get('latency') ?? 0)} fail={params.get('fail') ?? undefined}>
      <App />
    </AppProvider>
  );
}

createRoot(document.getElementById('root')!).render(<StrictMode><Root /></StrictMode>);
