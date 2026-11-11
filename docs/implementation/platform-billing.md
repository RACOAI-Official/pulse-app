# Platform subscription billing and AI credits

Pulse collects subscription fees through its own Stripe and SSLCOMMERZ accounts. This is separate from merchants' customer orders and payments.

## Plans

| Plan | Monthly | Yearly (2 months free) | AI credits / month |
| --- | --- | --- | --- |
| Pro | $30 · £25 · ৳3,500 | $300 · £250 · ৳35,000 | 4,000 |
| Enterprise | $100 · £80 · ৳12,000 | $1,000 · £800 · ৳120,000 | 15,000 |

- **1 credit = 1 AI auto-reply.** The admin agent's intent calls don't use credits.
- **Monthly reset.** Credits reset every month, including on yearly plans. Unused credits don't roll over.
- **Running out.** When credits hit zero, AI replies pause. Each paused job is cancelled and a handoff ticket is opened, so the team replies from the Inbox. The Plan page shows a warning at 80% and at 100% use.
- **Trial.** Each new workspace gets a 7-day trial with 200 credits and no card. A trigger on `tenants` creates it.
- **Expired plan or trial.** These are blocked:
  - API writes return `402`.
  - Database writes to commerce and agent tables are blocked.
  - AI replies and outbound sends stop.
  - Reads and the Plan page still work.

## Gateways

The currency decides the gateway. The Plan page picks a default currency from the browser's time zone and language (`Asia/Dhaka` or `bn`/`-BD` → BDT, `Europe/London` or `en-GB` → GBP, anything else → USD). The owner can switch it.

**USD and GBP use Stripe Checkout** in subscription mode with the configured Price IDs.
- Renewal is automatic. The owner can turn auto-renew off or back on.
- **Upgrade to Enterprise:** Pulse changes the subscription item with `proration_behavior=always_invoice` and `payment_behavior=error_if_incomplete`. The prorated invoice settles right away and tops up credits.
- **Downgrade to Pro:** Pulse changes the price with no proration, so it takes effect at the next renewal invoice.

**BDT uses SSLCOMMERZ hosted checkout** with prepaid monthly or yearly terms.
- Renewal opens in the last 7 days of a term, and the new term starts when the current one ends.
- **Upgrade:** the owner pays `(Enterprise − Pro) × remaining fraction of the term`, rounded up to a whole taka. The term end date stays the same.
- **Downgrade:** sets `pending_plan_key`, which applies at the next renewal.

**Webhook and reconcile safety.**
- Stripe events are HMAC-verified and re-fetched from Stripe before Pulse acts on them.
- SSLCOMMERZ IPNs are checked with the validation API: transaction ID, validation ID, amount, and BDT currency.
- High-risk SSLCOMMERZ payments are marked `review` and do not grant access.
- `pulse.reconcile_billing` runs hourly and recovers missed callbacks.
- `pulse.roll_credit_cycles` runs every 15 minutes and resets monthly credit cycles.

## API

| Purpose | Endpoint |
| --- | --- |
| Status, prices, credits, upgrade quote, invoices | `GET /tenants/{id}/billing` |
| Hosted checkout or SSL renewal | `POST /tenants/{id}/billing/checkout` |
| Pro → Enterprise now | `POST /tenants/{id}/billing/upgrade` |
| Enterprise → Pro at renewal | `POST /tenants/{id}/billing/downgrade` |
| Stop Stripe renewal | `POST /tenants/{id}/billing/cancel` |
| Toggle Stripe renewal | `POST /tenants/{id}/billing/auto-renew?enabled=` |
| Gateway notifications | `POST /webhooks/billing/{stripe\|sslcommerz}` |

## Database

Migration `20261111000200_phase_09_plans_credits.sql` adds:
- **Tables:** `billing_accounts`, `billing_checkouts`, `billing_invoices`, `billing_webhook_events`, `billing_operator_grants`, `credit_accounts`, `credit_ledger`.
- **Billing functions:** `pulse_billing_has_access`, `pulse_billing_settle` (upgrade top-up, newer-payment-wins rule).
- **Credit functions:** `pulse_credit_consume`, `pulse_credit_refund`, `pulse_credit_roll_cycles`.
- **Guard triggers:** the paid-write and outbound-send guards.

Existing tenants get a 30-day operator grant and 200 credits.

## Configuration (server-side only)

- **API and keys:**
  - `PULSE_API_PUBLIC_URL` (HTTPS)
  - `PULSE_WEB_ORIGIN`
  - `PULSE_STRIPE_SECRET_KEY`
  - `PULSE_STRIPE_WEBHOOK_SECRET`
  - `PULSE_SSL_STORE_ID`
  - `PULSE_SSL_STORE_PASSWD`
  - `PULSE_SSL_ENVIRONMENT` (`sandbox` or `live`)
- **Stripe Price IDs (8):** `PULSE_STRIPE_PRICE_{PRO|ENTERPRISE}_{MONTH|YEAR}_{USD|GBP}`. Create recurring Prices in Stripe whose amounts match the price table below.
- **Price table:** `PULSE_PRICE_{PRO|ENTERPRISE}_{MONTH|YEAR}_{USD|GBP|BDT}`, in minor units. The defaults are the table above.
- **Credit allowances:** `PULSE_CREDITS_PRO` (4000) and `PULSE_CREDITS_ENTERPRISE` (15000). The trial's 200 credits are set in SQL.
- **Policy pages:** `PULSE_TERMS_URL`, `PULSE_PRIVACY_URL`, `PULSE_REFUND_URL`. These must be HTTPS for live keys.

Register the Stripe webhook for these events:
- `checkout.session.completed`
- `invoice.paid`
- `customer.subscription.deleted`

## Verification and launch gates

Run these checks:
- `cd apps/api && PYTHONPATH=. .venv/bin/pytest`
- `psql -v ON_ERROR_STOP=1 -f apps/api/tests/billing_postgres.sql` after the migrations are applied
- `npm run typecheck` and `npm run build` in `apps/web`

These checks don't prove gateway settlement. Before taking real money:
- Complete provider onboarding.
- Publish the policy pages.
- Run sandbox payments:
  - Stripe USD monthly, with an upgrade and a cancel.
  - SSLCOMMERZ BDT yearly.
- Reconcile the provider settlement reports against Pulse invoices.
