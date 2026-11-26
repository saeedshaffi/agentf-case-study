# Design rationale

## The journey

The finance lead's four needs from the brief map onto five steps, in this order:

| Step | Need it answers | Why here |
|---|---|---|
| **1. Arrival** | "See my books arrive, what loaded, how sure the system is" | Trust starts with seeing what happened, including what went wrong. The failed bank load is in the timeline with its error and its retry, not hidden. |
| **2. Your decisions** | "Make the decisions that are mine, in a sensible order, and see the effect" | Only after they know what loaded. |
| **3. What we checked** | (not in the brief) | Things in the result that no question covers. Better they hear it from us than from their tax advisor. |
| **4. Books** | "Open any number and see where it came from" | Available all the way through via the trace panel. As a page it is mostly for the advisor. |
| **5. Hand-over** | "Hand the result to my tax advisor with confidence" | A checklist that cannot be ticked by hope: balance, totals, blocking questions, acknowledged findings. |

The tax advisor gets Books → Decision log → Checks → Arrival, read-only. The managing director gets one page: did it work, and does anything need me?

## Decisions that mattered

**1. 168 questions become 9 groups, ordered by consequence.**
The questions are not equally important. A one-cent rounding difference and a missing VAT ID on a customer we invoiced tax-free are different problems. Each group has a *stake* (VAT → who owes what → profit and loss → unexplained cash → records → cents). Groups are ordered by stake first, then by their position in the config. The stake order is fixed in code on purpose: a customer can rename, reword and reorder groups within a stake, but cannot configure VAT to come after cents. Each group says in one sentence why it matters and whether it blocks sign-off.

**2. The model's suggestions are not reliable here, so the bulk action is different.**
The obvious design for 89 classification questions is "accept all suggestions". Looking at the data first showed this would be wrong. The model only sees description and supplier category. Yet for 10 of the 11 supplier/description combinations it suggested more than one account; that covers 88 of the 89 invoices. The same "Beratung Digitalisierung" invoice from the same supplier gets 6837 (software), 6600 (advertising), 6300 or 6825. So these questions are grouped by description, the spread of suggestions is shown, and the bulk action is "book all 37 to one account" with a preview of how many move and by how much. "Accept all" stays only where the suggestion is the same kind every time (rounding, overpayments). This is also raised as a check, because the engine team should know.

**3. Every number is a button.**
"Nobody trusts a number they cannot open." Every figure opens a side panel: total → parts → invoices → postings → source file and row → every version the old system held → the load → the bank payment that settled it. The panel keeps a trail (breadcrumbs, Back, Esc), so a tax advisor can go five levels deep and return. The same panel speaks in two registers. The finance lead sees "On Rechts- und Beratungskosten (6825) · decided by Model, 54 %" and a plain-words line. The tax advisor sees account numbers and the formal definition of each total.

**4. Recompute everything; show where we disagree.**
The front end recomputes each total the engine reports from the individual records, to the cent (integer cents, never floats) and shows "matches the engine's figure" or the difference. This caught my own mistake. I first wrote in the customer FAQ that the €5,216,558.36 open receivables were net of credit notes. The test showed they are sales invoices only, and 40 open credit notes (€560,940.33 owed back to customers) are not in that figure. The product now shows all three figures, and the managing director's headline uses the net figure (€4,655,618.03).

**5. Checks beyond the engine, linked to the answers that settle them.**
Five findings no question covered:
- 4 overpayments (€4,365.62) matched as normal full payments with no question raised.
- 11 tax-free EU sales to a French customer whose VAT ID is "n/a". The engine's own rule text says "EU customer with VAT id".
- 5 USD invoices with 19 % German VAT to a customer with no country.
- The open-credit-notes gap above.
- The inconsistent suggestions.

Each check knows which questions settle it. When those are answered, it turns green and stops asking for acknowledgement. When no question settles it, sign-off needs an explicit "I have read this".

**6. Something will be missing, wrong or still loading.**
Each endpoint loads on its own. The arrival timeline appears as soon as the summary is in. A section that needs data that failed says which data failed and offers a retry for that endpoint. It never shows a total computed from partial data. A wrong number is worse than no number. You can see this with `?fail=invoices` or `?latency=600`.

**7. Who sees what is configuration, enforced in components.**
Roles, pages and `seesPersonalData` are in the customer config. IBANs, e-mail addresses and contact names go through one `<Personal>` component that masks them for roles without access, so a new screen cannot forget. The advisor is read-only and has no decision controls. The managing director sees totals only. The page states what the classification model saw ("no names, IBANs or amounts"), because that is the first thing a careful finance lead asks. The app makes no third-party requests, not even for fonts.

**8. A new customer is a folder, not a fork.**
`customers/<id>/config.json` holds words ("client" instead of "customer"), people and how they are named in a sentence, roles and pages, decision groups (titles, explanations, which question types they match, order, bulk behaviour, whether they block sign-off), which checks run, and number and date locale. `npm run new-customer` scaffolds one. A test runs every customer folder against its data and fails if any question would be dropped. Question types the config does not know land in "Other questions". `customers/demo-agency` shows a design agency with different words, people, pages and blocking rules, without code changes.

## Tried and rejected

- **One inbox of 168 cards.** Equal visual weight for unequal problems; the finance lead would answer cents first because they are easy.
- **A strict wizard.** The finance lead and advisor jump around. Instead: an ordered list that opens on the first unfinished group and moves to the next when one is done.
- **Dashboard first.** Big numbers on arrival without provenance are exactly the "numbers appear without explanation" moment the brief warns about.
- **"Accept all suggestions above X % confidence".** Rejected after finding the inconsistent suggestions.
- **Engine open receivables as the headline.** Excludes open credit notes.

## Left out, and why

- **Bank postings and a full trial balance.** The export contains invoice postings and payment matches, not payment postings. The trial balance says so on screen rather than inventing them.
- **Real VIES validation, real invitations, real "ask the customer" e-mails.** Stubbed: format validation only; the invitation is recorded, not sent.
- **Server persistence and multiple users at once.** Answers live in the browser. In production they are API writes with an audit trail.
- **Pickers for every option.** Credit notes, invoices, VAT IDs and countries have inputs with likely candidates first. Merging partners and creating customers just record the choice.
- **Full translation of UI copy.** Domain words, people and group texts are configurable; the remaining interface copy is English.
- **A complete accessibility audit.** Keyboard reachable, labelled controls, focus handling in the panel, `aria-live` loading, reduced motion. Not audited against WCAG 2.2 AA.
- **Mobile-first layout.** It works on a phone, but it is designed for a desk.
