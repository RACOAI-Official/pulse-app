# Admin Dashboard — Design (2026-11-14)

Platform back office for Pulse operators (rows in `platform_operators`, granted with
`python -m pulse_api.operator grant-operator --user-id <uuid>`). Absolute necessities only.

## Decisions
| Topic | Decision |
|---|---|
| Who | Platform operators only. Everyone else gets 404 from `/admin/*`. |
| Where | `pulse.racoai.io/admin` in the existing web app; `/ops` redirects there. |
| Credits | Admin credits go to a separate **bonus bucket** that never resets. AI replies spend plan credits first, then bonus. |
| Writes | Add/deduct bonus credits; suspend/unsuspend a business. Everything else read-only. |
| Suspend | Read-only + AI off: writes return 403 "Workspace suspended", AI replies and outbound sends stop, inbound messages still stored. |
| 2FA | Not now. |
| Privacy | No inbox/message content in admin; counts and billing data only. |

## Architecture
FastAPI `/admin/*` router → `SECURITY DEFINER` DB functions called with the operator's own JWT.
Each function re-checks `platform_operators` (defense in depth) and writes `admin_audit_log`
in the same transaction, with the actor taken from `auth.uid()`.

## Data model (migration `20261114000100_admin_dashboard.sql`)
- `credit_accounts.bonus_balance int not null default 0 check (>= 0)`.
- `credit_ledger`: reasons `admin_grant`, `admin_deduct`; columns `bucket ('plan'|'bonus')`,
  `actor_user_id` (FK auth.users, on delete set null), `note`.
- `tenants.suspended_at timestamptz`, `tenants.suspended_reason text`.
- `admin_audit_log(id, actor_user_id, action, tenant_id, details jsonb, created_at)`; append-only.
- `pulse_credit_consume`: plan balance first, then bonus; ledger records the bucket.
- `pulse_credit_refund`: credits back the bucket the consume used.
- `pulse_billing_has_access`: false when suspended (stops worker AI/outbound).

## API
- `GET /admin/overview`
- `GET /admin/businesses?q&status&page`, `GET /admin/businesses/{id}`
- `POST /admin/businesses/{id}/credits {amount, note, idempotency_key}`
- `POST /admin/businesses/{id}/suspend {reason}`, `POST /admin/businesses/{id}/unsuspend`
- `GET /admin/users?q&page`, `GET /admin/payments?provider&state&page`,
  `GET /admin/credits?reason&tenant_id&page`, `GET /admin/audit?page`
- Pages: 50 rows max; filters validated; admin writes rate-limited.

## UI
Tabs: Overview · Businesses (detail panel: credit adjust, suspend, with confirm + required reason)
· Users · Payments · Credits · Audit. Tenant app shows a suspended banner.

## Testing
Unit (auth gate, validation), SQL behavior (spend order, refund bucket, reset keeps bonus),
live local integration (grant/deduct/suspend/unsuspend/audit), full existing suite.
