# Client billing (Phase 29)

How a client project's money flows, from deposit to paying the team. Decisions: `docs/DECISIONS.md`
(Phase 29). Code: `src/modules/billing`, rules in `db/migrations/*_client_money_flow_rules.sql`.

## The flow

1. **Payment plan** (project › Billing tab). Pick a common plan (50/50, 40/30/30, 100% upfront,
   100% on completion) or add payments yourself (an amount like `2500.00` or a share like `30%`).
   Link a payment to a milestone if you like.
2. **Deposit.** Click *Create invoice* on the deposit; issue the invoice and send it. When the
   client pays, record the payment on the invoice. The deposit shows as **Paid**.
3. **Start the work.** With *No deposit, no work* on (Company page), the project can't move to
   In progress before the deposit is paid. A manager can still start it with a written reason.
4. **Client review.** When a piece of work is delivered, note that it was sent for review. The page
   shows the answer deadline (the company's review days, Monday to Friday). Record the client's
   acceptance with how they accepted (email, WhatsApp, meeting).
5. **Changes.** Anything new the client asks for is a change request with a price and extra days.
   Mark it sent; when the client decides, record it. Approved: the project's value goes up, a
   Change payment is added to the plan, and the target date moves.
6. **Invoice each payment** as it becomes due, and record the client's payments.
7. **Pay the team.** After the project is approved, payouts are paid either straight away or, with
   *in step with the client* on, up to the share the client has paid. Example: a GHS 12,000 project,
   the client has paid GHS 5,000, a developer is owed GHS 8,400: GHS 3,500 can be paid now
   (8,400 × 5,000 ÷ 12,000), the rest as the client pays.

## Settings (Company page › Client payments)

| Setting | Default | Effect |
|---|---|---|
| Usual deposit | 50% | The deposit in the 50/50 plan. |
| No deposit, no work | Off | Client projects start only once the deposit is paid. |
| Client review days | 10 | Working days a client has to answer a review. |
| When the team can be paid | As soon as approved | Or *in step with what the client has paid*. |

## Rules the database keeps

- A stage on a live invoice keeps its amount and type; invoiced stages and change payments are never deleted.
- A decided change request never changes; a sent one can't be edited.
- With *in step with the client*, a payment above what the client has paid for is refused
  (`payment_transactions_release`).
