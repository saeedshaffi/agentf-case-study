# Design rationale

The finance lead at Nordlicht is not an accountant. They need to answer five questions:
1. Did the migration work?
2. What needs me?
3. Can I trust it?
4. What was booked?
5. Can I sign off and hand it to the tax advisor?

The case says the 168 open questions "are not equally important" and that "nobody trusts a number they cannot open". Those two sentences decided where the design effort went. The full strategy, with the three visual directions considered, is in `audit/03-DESIGN-STRATEGY.md`.

## The journey

| Page | Question it answers | Shape |
|---|---|---|
| **Overview** (`#/overview`) | Did it work; what is left | One status sentence, one next step, four facts. Load history last, with the failed bank load tied to its retry |
| **Decisions** (`#/decisions/<group>`) | What needs me | Workspace: a queue split into *needed for sign-off* (116) and *can stay open* (52), plus a work area whose layout fits the question |
| **Checks** (`#/checks/<finding>`) | Can I trust it | Verified / Needs you / Acknowledged, still open / Resolved, each linked to the decision that settles it |
| **Records** (`#/records/...`) | What was booked | Accounts, invoices, bank. Every figure opens to its postings, source row, versions and payment |
| **Sign-off** (`#/sign-off`) | Can I sign off | Exact blockers with links, a grouped checklist, a confirmation that lists what stays open, read-only access for the advisor |

The tax advisor gets Records, Decision log, Checks and Overview, read-only and with contact data masked. The managing director gets one Summary page.

## Flagship 1: the decision workspace

**Problem.** 168 questions of very different weight. In the first version they were an accordion of 9 groups, about 10,700 px long, with the model's answer pre-selected on every card.

**Three models considered:**
- master-detail
- one-at-a-time focus
- grouped table review

None fits every question, because the questions come in three shapes. So the workspace is **master-detail with a layout per shape**:
- **Focused:** VAT ID, missing country, domestic VAT ID. Each shows the question, the customer facts that make it matter (e.g. 10 invoices and 1 credit note booked tax-free, €81,660.65 net), the engine suggestion with its basis, the options (none pre-selected), the effect, and Confirm.
- **Comparison:** the duplicate customer, field by field (✓ Same / ≠ Differs). Computed from the data: K00161 has no invoices or payments, so merging moves nothing.
- **Evidence tables:**
  - **Classification (89):** grouped by description. The model's suggestion spread is shown next to its limits ("it only sees the description and the supplier category"). You choose an account, shown in plain English with the German SKR04 name, see a preview ("31 move, €353,513.89 net; totals unchanged"), and book the selection. Undo reverts the whole booking.
  - **Rounding (24):** each row shows what the bank actually paid. In 20 of 24 cases that was the export's gross, which contradicts the engine's suggestion. The table says so before you accept anything.
  - **Payments and refunds:** each row shows date, counterparty, reference and amount. Answers that need a value (which invoice, which credit note) open inline with the likeliest candidates first.

**Rules:**
- Deferring ("Ask the customer", "Leave open") is recorded but never counts as settled.
- Completed work stays reviewable and can be changed until sign-off.
- USD questions are shown in USD and never added to euro totals.

## Flagship 2: checks → sign-off

**Problem.** In the first version, ticking "I have read this" turned a warning green; a deferred VAT question let you sign off; and the managing director saw settled VAT issues as still open.

**Design.** Each finding carries a status computed from the work, never from a click alone:
- **Resolved:** the linked decisions are settled.
- **Acknowledged, still open:** grey, never green, and listed for the advisor.
- **Needs you.**

The verifications (engine totals, journal balance, every export row accounted for) are listed separately. Sign-off names every blocker with a link, groups the checklist, and asks for confirmation in a dialog that lists what stays open. Reopening is confirmed and logged.

## Decisions that came from the data, not from patterns

- **Show the spread, not "accept all".** The model gave different accounts for identical inputs in 10 of 11 cases, so the bulk action books a decision you make, not the suggestions.
- **Show net receivables to the managing director.** Open receivables (€5,216,558.36) exclude 40 open credit notes (€560,940.33); net is €4,655,618.03.
- **Explain the 4 "overpayments" correctly.** They are invoices corrected downwards after the customer paid the first version. The finding says that and does not suggest booking the money as income.

## Visual system

- **Colours:** neutral surfaces, Agent F's coal (#21201C) for text and primary actions, and one deep green (#1E5B47) for selection, links and "settled".
- **Status:** amber means needs you; red means blocks sign-off. Status is always text plus a shape plus colour.
- **Type:** IBM Plex Sans, bundled; 6 sizes, 3 weights, tabular figures throughout.
- **Containers:** one level, never three.

The first version's warm cream with a terracotta accent was replaced: it is the most common look of generated interfaces.

## Visual pass after the candidate's review (26 Nov)

The candidate compared three builds side by side: the first version, the redesign, and a separately generated mock-up with invented data. The decision was to keep the real-data app as the product and take only the look and the navigation ideas from the mock-up.

- **Overview** now leads with one status card (what is left, the recommended next step) and four status tiles that open Decisions, Checks, Records and Sign-off. The arrival figures stay directly below (invoices in the books, the books balance, bank payments explained, net receivables), each still opening the records behind it, followed by "From export rows to invoices" and "How sure we are". Status tiles answer "what do I do"; arrival figures answer "can I trust it". Removing either would drop a need named in the brief.
- **Accept all suggestions** is back. The redesign had replaced it with "select all, then apply", which cost a step on the groups where the engine's suggestion is uniform. On expense accounts, where the model's suggestions disagree for the same description, the action is secondary and a dialog states how many accounts the invoices would land on before anything is saved. Every bulk accept is one undo.
- **Confidence** is shown as a number with a small bar per invoice, and in the suggestion text for single questions.
- **Checks** starts with four tiles (need you, acknowledged and still open, verified or resolved, for information) that jump to the first finding of each kind.

## Considered and rejected

- **One inbox of 168 cards:** equal weight for unequal problems.
- **A strict wizard:** people jump between questions, checks and records.
- **"Accept all above X % confidence":** rejected because of the data above.
- **Pre-selecting the suggestion:** it nudges people toward an answer the data shows is unreliable.
- **Showing the engine's open receivables as the headline:** misleading without the credit notes.

## Left out

- **Bank postings:** not in the export, so not invented.
- **Real VIES checks and e-mails:** format check only, stated on screen.
- **A backend, real logins and multi-user conflict handling:** a second tab follows the first, but it does not merge.
- **German interface copy.**
