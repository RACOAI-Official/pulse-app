# Admin plan prices, trial credits, header credits, owner alerts

Date: 2026-11-14 · Status: implemented (local), not deployed

## Decisions

| Topic | Decision |
|---|---|
| Price change effect | New checkouts only. Stripe subscribers keep the price ID they bought; BDT terms renew at the new price. |
| Price storage | Append-only `plan_price_versions`; newest row per plan/interval/currency is live, else env default. 60 s per-process cache. |
| Stripe | Admin save creates a new Stripe Price on the existing product (prices are immutable), idempotency key = request ID. USD/GBP need an existing env price ID. |
| Renewal check | `amount_paid` must equal the amount of the subscription's own Pulse price ID (env original or any version). Unknown price IDs are rejected. |
| Trial credits | `platform_settings.trial_credits` (default 200), read by the signup trigger; new businesses only. Trial stays 7 days. |
| Header credits | Chip for every member: plan + bonus. Red when available ≤ 10% of the cycle allowance, or 0. `GET /tenants/{id}/billing/credits`, refreshed every 30 s while visible and on focus. |
| Alerts | Ported main's durable queue (`2d249a6`), generalised to events: `order_confirmed`, `order_drafted`, `credits_low`, `credits_empty`, `plan_ending`, `plan_expired`. Each has a dedupe key and fires once. |
| Channels | Email (existing Resend/SMTP sender, branded layout) and WhatsApp from Pulse's own Cloud API number to the owner's verified number. Nothing else. |
| Defaults | Owners get email alerts at their sign-in email, enabled and verified. Existing owners are backfilled. Language defaults to Bangla. |

## Event sources

- `order_confirmed`: deferred constraint trigger on `commerce_orders` (counts items written in the same transaction).
- `order_drafted`: the worker calls `pulse_notify_order_drafted` after the customer AI creates and prices a draft.
- `credits_low` / `credits_empty`: `pulse_credit_consume`, once per credit cycle; an alert failure never blocks a reply.
- `plan_ending` / `plan_expired`: hourly beat `pulse_notify_billing_deadlines` (trial or non-auto-renewing term within 3 days; ended within 3 days without access).

## WhatsApp setup (operator)

1. Register Pulse's number in WhatsApp Cloud API: `PULSE_WHATSAPP_PHONE_ID`, `PULSE_WHATSAPP_NUMBER`, `PULSE_WHATSAPP_TOKEN`, `PULSE_WHATSAPP_APP_SECRET`, `PULSE_WHATSAPP_VERIFY_TOKEN`.
2. Subscribe the app's `messages` field to `GET/POST /webhooks/pulse-whatsapp`.
3. Get one utility template per alert approved, in `bn` and `en`, then set `PULSE_WHATSAPP_TEMPLATE_<KIND>`. Body parameters, in order:
   - order_confirmed: business, order, customer, item qty, total, payment, link
   - order_drafted: business, order, customer, item qty, total, link
   - credits_low: business, credits left, allowance, link
   - credits_empty: business, link
   - plan_ending: business, plan, end date, link
   - plan_expired: business, plan, link
   - test: business
   Without a template, that alert's WhatsApp delivery is marked `suppressed` ("template not configured"); email still sends.
4. Set `PULSE_NOTIFICATIONS_ENABLED=true` on the API and worker, then restart them.

## Testing

Unit tests (`tests/test_plans_alerts.py`), SQL behaviour checks, live suite `tests/integration_plans_alerts_local.py`, Next build, and a browser check of the header chip (normal and low) and the Plans tab.
