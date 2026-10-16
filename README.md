# Pulse

Pulse Phase 0–2 combines a three-channel Meta sandbox inbox with a local commerce workspace. The product brief is [Pulse-documentation.md](Pulse-documentation.md); the reference investigation and limits are in [docs/reverse-engineering](docs/reverse-engineering/README.md).

## Stack

- Next.js 16, React 19, Supabase Auth
- FastAPI, Redis/Celery, Meta Graph APIs
- Supabase Postgres with tenant row-level security and private Storage
- Docker Compose and Caddy for staging

## Local setup

1. Run Docker Desktop, then `supabase start` from the repository root. The local Supabase CLI prints its API URL, anon key, and service role key.
2. Copy `.env.example` to `.env`, set the Supabase values, a fresh `PULSE_CREDENTIAL_KEY` from `PYTHONPATH=apps/api .venv/bin/python -m pulse_api.operator generate-key`, Meta app secret and webhook verify token, and a supported `META_GRAPH_VERSION` from your Meta app. Set `PULSE_ECHO_MODE=false` for the human inbox.
3. Copy `apps/web/.env.local.example` to `apps/web/.env.local` and set the local Supabase URL/anon key and `NEXT_PUBLIC_API_URL=http://localhost:8000`.
4. `supabase start` applies the versioned migrations on a new local project. For an existing local project, run `supabase migration up` to add Phase 2 without resetting data. Configure custom SMTP in Supabase Auth for real invitations and recovery email. Local Mailpit is available from the Supabase CLI stack.
5. Install API dependencies in a Python 3.12 virtual environment: `python3.12 -m venv .venv` and `.venv/bin/pip install -r apps/api/requirements.txt`. Install web dependencies with `npm ci` in `apps/web`.
6. Start Redis (for example, `docker run -d --name pulse-local-redis -p 6379:6379 redis:7.4-alpine`), then run API, Celery worker, and Celery beat in separate terminals from the repository root:

   ```sh
   PYTHONPATH=apps/api .venv/bin/uvicorn pulse_api.main:app --reload --port 8000
   PYTHONPATH=apps/api .venv/bin/celery -A pulse_api.tasks.celery_app worker --loglevel=info
   PYTHONPATH=apps/api .venv/bin/celery -A pulse_api.tasks.celery_app beat --loglevel=info
   ```

   Run `npm run dev` in `apps/web` and open `http://localhost:3000`.

7. Create the first tenant and invite its owner:

   ```sh
   PYTHONPATH=apps/api .venv/bin/python -m pulse_api.operator create-tenant --name "Test business" --owner-email owner@example.com
   ```

   For each Meta sandbox asset, set `PULSE_CHANNEL_TOKEN` in the process environment and run `connect-channel` with `--tenant-id`, `--channel`, `--account-id`, and `--display-name`. Do not put access tokens in command arguments or commit them. The account IDs must be the Page ID, Instagram account ID, and WhatsApp phone number ID that appear in the corresponding webhook payloads.

## Staging

The approved target is an Ubuntu 22.04 VPS with two HTTPS hostnames. Fill `.env` with the remote Supabase project keys, `PULSE_APP_HOST`, `PULSE_API_HOST`, `PULSE_WEB_ORIGIN=https://<app-host>`, and the three `NEXT_PUBLIC_*` values. Configure the Supabase Auth site URL and allowed redirect URL as `https://<app-host>/auth/callback`. Apply the versioned migration to the dedicated project with `supabase db push`, then run `docker compose up -d --build` on the VPS. Point both DNS records at the VPS before expecting Caddy certificates.

Meta webhook callback: `https://<api-host>/webhooks/meta`. Set the same verify token in Meta and `.env`, configure the three channel subscriptions, and connect each sandbox asset with the operator CLI. Instagram uses Instagram Login directly. A real inbound and one human text reply must succeed on all three channels before staging acceptance. Meta app review and broader production messaging permissions are separate from sandbox acceptance.

## Verification

Run `PYTHONPATH=apps/api .venv/bin/pytest -q apps/api/tests`, `npm run typecheck`, and `npm run build` in `apps/web`. With local Supabase, Redis, and the Celery worker running, `PYTHONPATH=apps/api .venv/bin/python apps/api/tests/integration_local.py` exercises Auth, RLS, webhook deduplication, worker processing, inbox reads, owner invites, WebSocket ticket creation, and failed outbound visibility. It creates uniquely named fixture users and tenants in the local database. Real Meta delivery still requires the sandbox credentials and staging hostnames.

Phase 2's database flow can be checked against a local PostgreSQL server with `psql -X -v ON_ERROR_STOP=1 postgres -f apps/api/tests/commerce_postgres.sql`. This applies both migrations in a transaction, checks stock, payment, cancellation, tenant isolation, and product restoration, then rolls the transaction back.

## Commerce workflow

Open **Catalog** to select the workspace currency before adding data. Owners can choose BDT, USD, EUR, or GBP; it locks when the first product or order exists. Owners and staff can add draft products, set variants and prices, attach a JPEG/PNG/WebP upload or public HTTPS image URL, then activate the product. Existing stock is adjusted with a reason, creating an audit movement. The CSV template has one row per variant; preview reports row errors, and import commits all products in one database transaction. Product handles and SKUs must be unique within the workspace.

Open **Orders** to create a manual draft from active catalog variants. Submit it for confirmation, then confirm to recheck prices and stock and reserve units. Continue through processing and completion. Cancellation before completion restores reserved units once. Payments are manual records; cancelling a paid order keeps those records and shows the amount due for a refund. Pulse does not process the refund. Unreferenced products can be removed; products used by an order are archived and may be restored as drafts. See [Phase 2 design](docs/plans/2026-10-16-phase-2-commerce-design.md) for the approved boundary and reference evidence.

## Operational behavior

- Webhooks are HMAC verified and stored before acknowledgment. Celery processes them idempotently; beat requeues pending records.
- Human sends are queued in Postgres. A timeout or worker death yields an **uncertain** state; staff must check the channel before sending again. Explicit retry is available only for known failures.
- The inbox uses WebSocket refresh notifications with 15-second polling as fallback.
- A daily worker task deletes private media after 30 days and message records after 365 days.
