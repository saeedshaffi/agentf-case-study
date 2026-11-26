# Agent log

## Setup

- **Agent:** Claude Code (model Claude Opus 5.5), desktop app, one session.
- **Brief given to the agent:** the job description, the invitation e-mail, and the instruction to read the case from the shared folder and build it.
- **Data handling:** the engine output was read locally only. It was not sent to any third-party service, and the app makes no external requests (no analytics, no web fonts, no CDN).
- **Transcript:** exported from the Claude desktop app; see the note at the end.

## How the work was split

1. **Read before building.** Profile all six files with short Python scripts: shapes, counts, totals, flags and every cross-reference. Then write the customer document (PR + FAQ) *before* any code, as the case asks.
2. **Domain first, without UI.** Money as integer cents, metrics recomputed from records, decision grouping driven by config, effects, checks, ledger. Tested against the real data before a single screen existed.
3. **Screens on top of that domain:** shell, trace panel, then one page per step.
4. **Verify in a real browser.** Every page, every role, the error and loading states, and the full finance-lead journey to sign-off, clicked through in the app's browser.
5. **Clean-checkout test.** Clone the repo into an empty folder, run `npm test` (installs and runs 32 tests), and build.

## What went wrong and how it was caught

| # | What was wrong | How it was caught | Fix |
|---|---|---|---|
| 1 | The customer FAQ claimed the engine's €5,216,558.36 open receivables were net of credit notes | A test that recomputes every engine total from the records failed: open sales invoices alone add up to that figure | Show three figures (sales invoices, open credit notes, net), add a check, correct the FAQ and say so in it |
| 2 | Retry described as "25 minutes later" | Looking at the timeline in the browser: 07:30 → 08:05 is 35 | Fixed in the doc; the UI computes it from timestamps |
| 3 | The plan was "accept all suggestions" for 89 classifications | The screen listed the suggestion spread per description: 4 accounts for one description. A script confirmed 10 of 11 supplier/description pairs get inconsistent suggestions | "Book all to one account" with preview; a new check |
| 4 | Plain-language line said "VAT is owed to the tax office" on 0 % invoices | Reading an intra-EU invoice in the trace panel | Separate wording for tax-free sales |
| 5 | Bulk preview labelled amounts as gross; they are net | Comparing with the invoice's postings | Label corrected |
| 6 | Button said "Accept suggestion" on questions without a suggestion | Screenshot of the VAT ID question | Label depends on whether a suggestion exists |
| 7 | Checks kept demanding acknowledgement after the finance lead had answered the questions that settle them | Walking the journey to sign-off | Checks carry the IDs of the questions that settle them |
| 8 | Hard-coded "finance lead" / "tax advisor" in copy | Switching to the agency config | `who(cfg, role)` from config |
| 9 | In the agency demo, the agent gave cost questions a "tax" stake with an invented justification ("R&D tax credit") to move them first | Self-review of the config | Reverted. VAT-first is a fixed product rule, and the rationale now says so |
| 10 | Page overflowed horizontally next to wide tables | Screenshot at 1024 px | `minmax(0, 1fr)` grid column |

## What the agent got right without being told

- Treating amounts as exact decimals (BigInt cents), not floats.
- Not inventing bank postings that are not in the export, and saying so on screen.
- Masking personal data through one component rather than per screen.

## Candidate's own review

*(To be completed by Saeed: what I changed after reviewing the agent's work, what I would have decided differently, and what I verified myself.)*

-
-
-

## Transcript

Exported from the Claude desktop app (Session → Export): the conversation and every tool call. It is attached separately (or in `docs/transcript/` if added), after removing personal details unrelated to the case.
