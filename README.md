# The migration experience: Nordlicht Werkzeuge GmbH

A working front end for a customer whose books have just been moved to Agent F. It covers the journey from first login to sign-off for the finance lead, a read-only view for the tax advisor and a one-screen answer for the managing director.

## Run it

**Live version:** https://saeedshaffi.github.io/agentf-case-study/ (the built site lives on the `gh-pages` branch; rebuild with `BASE=/agentf-case-study/ npx vite build`).


```bash
npm start
```

That is the only command. On a clean checkout it installs dependencies first (Node 20+), then opens http://localhost:5173.

```bash
npm test          # 32 tests: money, every total recomputed against the engine, grouping, checks, UI journey, roles, error states, every customer config
```

Useful URL parameters (prototype only):

| Parameter | Effect |
|---|---|
| `?role=tax_advisor` / `?role=owner` | View as the tax advisor or managing director. In production this comes from the login; here a "view as" switch sits at the bottom of the sidebar |
| `?latency=600` | Simulate a slow API so the loading states are visible |
| `?fail=invoices` | Make one endpoint fail once, to show the error state and retry |
| `?customer=demo-agency` | A second customer, configured differently (see below) |

Answers are stored in the browser (localStorage) per customer. Clear site data to start again.

## What is where

| Path | What |
|---|---|
| `customers/nordlicht/engine-output/` | The engine's API responses, unchanged. Served as static files, one file per endpoint |
| `customers/nordlicht/config.json` | Everything specific to this customer: words, people, roles and what they see, decision groups and their order, which checks run |
| `customers/demo-agency/config.json` | A design agency's config. It reuses Nordlicht's data (no second dataset was provided) to show what configuration alone changes |
| `customers/_template/` | Starting point for a new customer |
| `src/domain/` | No React. Money in integer cents, metrics recomputed from records, decision grouping, effects, checks, ledger, privacy masking |
| `src/ui/`, `src/pages/` | Components, the trace panel, and one file per step of the journey |
| `docs/` | Customer document, design rationale, agent log, measurement plan, one-pager |

## A new customer gets their own version

```bash
npm run new-customer -- kranich "Studio Kranich GmbH" "Design agency"
```

Then put the engine's output in `customers/kranich/engine-output/`, edit `config.json`, and run `npm test`. The tests check every customer folder: the config is valid, every open question lands in a group (unknown question types go to "Other questions" instead of disappearing), and every check runs against their data. No code is copied.

## Documents

- [Customer document](docs/customer-document.md) (written before building; PR + FAQ)
- [Design rationale](docs/design-rationale.md)
- [Agent log](docs/agent-log.md)
- [What we would measure](docs/measurement.md)
- [One-pager](docs/one-pager.pdf)
