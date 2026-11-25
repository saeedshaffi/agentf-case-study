---
type: data-readme
audience: external (sent to candidates)
last_updated: 2026-11-24
---

# Nordlicht Werkzeuge GmbH: migration engine output

**Engine output** · What the product's API returns after the migration · Synthetic, treat as real

Nordlicht Werkzeuge GmbH is a fictional German tool wholesaler. All data is synthetic, but treat it as real customer data: it contains names, e-mail addresses and bank account numbers.

Our migration engine loaded the company's export from its old accounting system, booked it against the German SKR04 chart of accounts, matched it against the bank statement and listed what it could not decide on its own. These files are what the product's API returns for this customer. Treat each file as the response of one endpoint.

| File | Contents |
|---|---|
| `summary.json` | The customer, its users and roles, the history of the four loads, counts, totals by currency, the balance check and open items |
| `invoices.json` | Every outgoing invoice (`RE-…`), supplier invoice (`ER-…`) and credit note: amounts in the original currency and as booked in EUR, the account and who decided it, the postings, payment status, source row and version history |
| `bank_transactions.json` | Every bank transaction and what it was matched to, with confidence |
| `decisions.json` | The open questions only the customer can answer, with options, a suggestion where there is one, the amount affected and links to the evidence |
| `partners.json` | Customers (`K…`) and suppliers (`L…`) with contact details and flags |
| `accounts.json` | The chart of accounts used |

Conventions:

| Field | Meaning |
|---|---|
| `amount` | A decimal number as a string, with a dot as the decimal separator. Always paired with `currency` |
| `source` | Where a record came from: file, row and load |
| `decided_by` | `rule`, `model`, `fuzzy_reference` or `person` |
| `confidence` | 0 to 1. The engine asks for review below 0.80 |
| `history` | Every version of an invoice the exports contained, oldest first |
| `postings` | The double-entry lines booked for the invoice, in EUR |

Nothing else is documented. Part of the work is finding out what the data says.
