# Customer document: the migration, from first login to sign-off

*Written before building. Press release + FAQ. Nordlicht Werkzeuge GmbH is the first customer; everything customer-specific lives in configuration.*

*Kept as first written, apart from the two corrections marked in the text. The product was later audited and redesigned; where this document and the product differ (page names, how questions are grouped, bulk answers), [design-rationale.md](design-rationale.md) describes the current state. One statement here needs a caveat: who sees what is enforced on screen only in this prototype, not by a server.*

---

## Press release

**Nordlicht Werkzeuge moves ten months of books to Agent F and signs off in one afternoon**

*Berlin.* Nordlicht's finance lead logged in on a Monday morning to find 1,770 invoices, 1,362 bank transactions and 161 customers and suppliers already booked, balanced and matched. The books did not just show up. The screen showed each load arriving, including the one that timed out and was retried safely, and which numbers the system was sure of and which it was not.

Agent F had 168 open questions. The finance lead didn't face a list of 168. They saw **nine short groups, most important first**: the two that change the VAT return, the one that changes who owes what, then the expense accounts that need a person, sorted by amount. Most groups could be settled in one go by accepting a suggestion the system explains. For each answer the screen showed what would change in the books before anything was booked.

Any number on any screen can be opened: open receivables become invoices, an invoice becomes its postings, its row in the old export and every version the old system held, and the bank payment that settled it.

The external tax advisor got a read-only link. They saw the same numbers in accountant's terms (accounts, postings, debits and credits) and a log of every decision: who made it, when, and what it changed. The managing director got one screen that answers whether it worked and whether anything needs them.

> "I didn't have to trust it. I could check it. When the advisor asked where a figure came from, I clicked it and showed them." (Finance lead, Nordlicht)

---

## Who uses this and what they need

| Person | Knows | Wants | Sees | Can do |
|---|---|---|---|---|
| **Finance lead** | The business and its numbers; not an accountant | Get the books in and stand behind every number | Everything, in plain language first, with accounting terms one click away | Answer decisions, undo them, sign off, invite the advisor |
| **Tax advisor** (external) | Accounting, VAT, SKR04 | Trace any figure to its source before the first VAT return | Books, postings, lineage, decision log. Personal contact data (e-mail, IBAN) masked | Read only. Can leave a note. |
| **Managing director** | The company | "Did it work? Does anything need me?" | One overview: status, money at stake, anything waiting on them | Nothing to operate |

## The journey (finance lead)

1. **Arrival.** "Your books have arrived." A timeline of the four loads. Load 3 failed: *timed out while matching payments; nothing was booked; retried 35 minutes later and succeeded.* We show this plainly instead of hiding it.
2. **What loaded, and how sure we are.** From rows read to invoices kept, step by step (duplicates removed, older versions replaced by corrections). Then the confidence: decided by fixed rules, by the model with high confidence, or waiting for you.
3. **Your decisions.** Grouped and ordered by consequence: tax first, then who owes what, then money by amount, then the trivia that can be accepted in bulk. Every option shows its effect before you choose.
4. **Checks we ran on the result.** Things the screens noticed that no decision covers. The finance lead should hear about these from us, not from the tax advisor.
5. **Open any number.** A trace panel from total → items → postings → source row → versions → bank payment.
6. **Hand over.** A sign-off checklist; invite the advisor; the advisor's read-only view and decision log.

## Questions customers will ask (FAQ)

**Did everything load?** Yes. 1,877 rows were read, 0 rejected. 72 exact duplicates were removed. 35 rows were earlier versions of an invoice that appeared again later: 17 genuine corrections, 18 repeats. That leaves 1,770 invoices. Every one can be opened back to its row.

**One load failed. Is my data damaged?** No. The bank load timed out after 600 s while matching payments, with nothing booked, and was retried 35 minutes later, at 08:05 the same morning. Every bank transaction you see comes from the successful retry.

**Do the books balance?** Debits and credits are both €24,929,183.08.

**Why are there 168 questions? Do I have to answer them all?** Not one by one. 24 are one-cent rounding differences (24 cents in total). They are one group with one suggested answer. 89 are expense accounts the model was not sure about, worth €1.07m. Those matter and are sorted by amount. Two partner questions decide the VAT treatment of 23 invoices; those come first.

**What is "decided by model" and did you send my data to an AI?** The engine reports that the model saw only the invoice description and the supplier category: no names, IBANs or amounts. Rules decided 1,558 invoices; the model 212, of which 89 wait for you.

**My open receivables say €5.2m. Is that what customers owe me?** Not quite. The €5,216,558.36 counts open sales invoices only. You also have 40 credit notes worth €560,940.33 that have not been refunded or set against an invoice yet. That is money you owe customers back. Net of those, customers owe you €4,655,618.03. We show all three figures and how they relate. USD invoices ($228,491.60 open) are shown separately and never mixed into a euro total.

*(Correction during the build: this answer first said the €5.2m was already net of credit notes. A test that recomputes every figure from the records showed it is not. That is why every total in the product is recomputed and compared.)*

**How do I know a USD invoice was converted correctly?** Each one shows the rate used and its date. Nine fell on a weekend or holiday and used the previous business day's rate. That is flagged, not hidden.

**Who can see my customers' IBANs and e-mail addresses?** Only you. The tax advisor sees the books with contact details masked. The managing director sees totals only.

**Can I undo a decision?** Yes, until you sign off. Every decision is logged with who, when and the before/after effect, and the advisor sees that log.

**What happens if something is still loading or missing?** The screen says exactly what is missing and keeps the rest usable. A total that depends on missing data is marked as incomplete instead of showing a wrong number.

## Out of scope for this version

Editing invoices directly; the VAT return itself; real e-mail or VIES calls (shown as stubs); multi-entity companies; mobile-first layout (it works on a phone, but it is designed for a desk).
