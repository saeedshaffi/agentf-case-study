# Agent log

How AI agents were used to build, audit and redesign this submission: what they were told, how the work was split, what they got wrong, and how it was caught.

## Tools and data handling

- **Agent:** Claude Code (Claude Opus), desktop app. One orchestrating session with subagents for audits and reviews.
- **Where the data went:** the engine output was processed by the coding agent, which runs on a hosted model, during the build. The repository and two deployments (GitHub Pages, Vercel) were made **public on 26 Nov 2026** at the candidate's request. That publishes the synthetic customer dataset, IBANs and e-mail addresses included. The case says to treat this data as real, so see "Open items" below.
- **The app itself** makes no third-party requests: no analytics, no CDN, and the font is bundled.

## Phase 1: first build (25–26 Nov)

Read the brief and profile all six files before building → write the customer document → domain logic with tests against the real data → screens → browser check → clean-clone test. Ten defects were caught along the way (table below; the full list is in git history and the session transcript).

| What was wrong | How it was caught |
|---|---|
| The FAQ claimed the €5.2 m open receivables were net of credit notes | A test recomputing every engine total from the records |
| The plan was "accept all suggestions" for 89 classifications | The suggestion spread on screen, then a script: 10 of 11 pairs inconsistent |
| "VAT owed to the tax office" shown on tax-free invoices | Reading an intra-EU invoice in the record panel |

## Phase 2: independent audit (26 Nov)

Eight auditor agents worked in parallel. They covered:
- product and compliance
- UX and journeys
- UI and design system
- functional QA
- data integrity
- accessibility and responsive
- UX writing
- engineering, performance and security

Each worked from one shared brief, with headless Chrome against the deployed app, and was told: **read only; every finding needs evidence; label it Observed, Risk or Opinion**. The orchestrator re-checked the most serious claims before accepting them. For example, it confirmed that a finished decision group could not be reopened, and it **refuted** the claim that corrupt saved state blanked the app. Reports are in `audit/` (outside this repository).

## Phase 3: redesign (26 Nov)

Planned in `audit/03-DESIGN-STRATEGY.md`: two flagship workflows (decisions; checks to sign-off), a new token system and hash routing. Every change went through three validation rounds:
1. **Implementer verification:** unit and integration tests, plus a 40-check browser harness (`audit/harness/verify.mjs`) covering the journey, keyboard and focus, axe, and widths from 320 to 1920 px.
2. **Independent specialist review:** four reviewer agents who had not seen the implementation, working against a production build.
3. **Integrated regression** on a clean state.

What round 1 caught in the redesign:

| What was wrong | How it was caught |
|---|---|
| Focus escaped the record panel from its heading when nothing focusable followed it | Harness K-03, then a debug script that printed where focus went |
| Pages overflowed at 320–390 px: a grid column without `minmax(0, …)` | Harness RS-01, then an element-width probe |
| Undoing a 37-invoice booking wrote 37 separate log lines | Harness J-24 |
| Rows reopened by an undo came back unselected, so re-booking needed 37 clicks | The harness could not find the "Book 37" button after an undo |
| The page heading took focus on first load, in development only | Harness K-01; React StrictMode runs effects twice |
| My own expected count was wrong (93 instead of 92) | Harness J-09; the app was right, the test was fixed |

What rounds 2 and 3 caught that round 1 had passed:

| What was wrong | Who caught it |
|---|---|
| Sign-off could complete after a finding was reopened through a lingering Undo | UX reviewer |
| Answering "another country" turned a VAT finding green, although the invoices may still need re-booking | Accounting reviewer |
| The decision log told the tax advisor a VAT ID was "validated against VIES"; nothing was | Hiring reviewer |
| Focus fell to the page body after every action; a toast could hide the focused control | Accessibility reviewer, who rejected the build until it was fixed |
| A VAT ID that only passed a format check showed its finding as resolved | Round-3 verifier |
| The bottom toast covered the "Next" button on tablets and small laptops | Final re-check |

Round 3 did not end clean: twelve lower-priority findings were deferred with reasons, and the last four small fixes were checked by the implementer only. The tracker says which.

## Phase 4: visual pass on the candidate's direction (26 Nov)

The candidate had a second tool generate a mock-up and preferred its look, then noticed that it had lost the arrival figures, the click-through to records and the confidence figures of the first version. The agent's recommendation, which the candidate accepted: the mock-up uses invented data and cannot be submitted, so its look was ported onto the real-data app instead. Changed: app shell, Overview, Checks summary tiles, accept-all on grouped decisions. Verified with the 59 tests, the 41-check browser harness (one regression found and fixed: the new top bar pushed the page heading below 300 px on phones) and an axe scan at 1440 and 375 px.

A forked session edited the same checkout at the same time. The two were made to work on separate files once the overlap was noticed; the table-review accept-all came from the fork.

## What the agents got wrong that a person had to catch

- **An invented justification.** An agent configured the demo customer with a made-up rationale ("R&D tax credit"). It was reverted.
- **Untested data claims.** Agents repeatedly wrote numbers before testing them. Every number in the product and on the one-pager now has a test or an independent recomputation behind it.
- **Overclaims in the first one-pager.** It said "the engine did not ask" about two cases the engine did ask about, and that the transcript was in the repository. Both are corrected.

## Candidate's own review

*(To be completed by Saeed: what I decided, what I changed after reviewing the agents' work, what I would decide differently, and what I verified myself.)*

-
-
-

## Open items

- **The public dataset (repository, GitHub Pages, Vercel).** The independent audit recommended making the repository private and taking both deployments down. The candidate decided on 26 Nov 2026 to keep them public. The data is synthetic; the case still asks for it to be treated as real, so this is a known deviation from that rule.
- **The session transcript** is exported separately. It contains personal details unrelated to the case and must be redacted before sharing.
