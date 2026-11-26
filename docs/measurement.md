# What we would measure

The goal from the brief: customers get through the migration **faster** and **trust it more**. Trust is not directly observable, so we measure behaviour that only happens when it is present or missing.

## Faster

| Measure | Definition | Why |
|---|---|---|
| **Time to sign-off** | First login → sign-off, in working hours and in sessions | The headline. Median and the slowest quartile. The slow tail is where people get stuck. |
| **Time to first useful result** | First login → first group completed | Activation: did they get going without help? |
| **Drop-off by group** | Share of migrations where a group is opened but not finished within 48 h | Shows which kind of question stalls people, not just that they stall |
| **Bulk vs one-by-one** | Share of answers given via a group action | High where it should be (rounding), low where it should be (VAT) |

## Trust

| Measure | Definition | Why |
|---|---|---|
| **Trace opens per session, over time** | Opens of the trace panel, and how deep | Expect many early ("let me check"), then fewer. If it stays high, they are still not sure. If it is zero, the feature is not discoverable. |
| **Undo rate** | Answers undone within the session | Some is healthy. A high rate on one group means the options or their effects are unclear. |
| **Reopened after sign-off** | Migrations reopened, and answers changed after sign-off | The strongest signal that someone signed off without being sure |
| **Advisor follow-ups** | Questions the advisor sends back before approving | The test of "hand it over with confidence" |
| **Corrections within 90 days** | Postings from the migration re-booked after sign-off | Did the trust turn out to be justified? |

## Help needed

| Measure | Why |
|---|---|
| **Support contacts tagged "migration"** per customer, and their topic | Recurring topics become product changes. Then check whether the topic disappears. |
| **Findings acknowledged vs resolved** | If people tick "I have read this" without acting, the wording or the action is wrong |

## Guardrails

- **VAT corrections after the first return** for migrated customers. Speed must not come from skipping the questions that matter.
- **Sign-off without any trace open.** Not wrong in itself, but worth a look in session reviews.

## How

Events from the front end (`group_opened`, `answer_given {bulk}`, `answer_undone`, `trace_opened {kind, depth}`, `check_acknowledged`, `signed_off`, `reopened`), keyed by customer and role, with no amounts or names. For the first 10 customers: watch the sessions with the customer team, because the numbers will not explain *why*. Baseline: the current manual migration process. How long it takes today and how many e-mails it generates are the first things to establish.
