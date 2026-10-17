# Pulse

Pulse combines a three-channel Meta sandbox inbox, local commerce workspace, versioned customer agent, dashboard analytics, CRM, and a confirmation-based Admin Agent. The product brief is [Pulse-documentation.md](Pulse-documentation.md); the reference investigation and limits are in [docs/reverse-engineering](docs/reverse-engineering/README.md). The [implementation index](docs/implementation/README.md) maps the implemented scope and remaining work.

## Stack

- Next.js 16, React 19, Supabase Auth
- FastAPI, Redis/Celery, Meta Graph APIs, and a configurable OpenAI-compatible local model endpoint
- Supabase Postgres with tenant row-level security and private Storage
- Docker Compose and Caddy for staging

## Local setup

1. Run Docker Desktop, then start the minimal local Supabase stack from the repository root: `supabase start --exclude realtime,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor`. Pulse uses Postgres, Auth, PostgREST, Storage, and Kong locally. The CLI prints the API URL and keys. To use local email capture or Studio, start the optional services separately by removing their names from the exclude list.
2. Copy `.env.example` to `.env`, set the Supabase values, a fresh `PULSE_CREDENTIAL_KEY` from `PYTHONPATH=apps/api apps/api/.venv/bin/python -m pulse_api.operator generate-key`, Meta app secret and webhook verify token, and a supported `META_GRAPH_VERSION` from your Meta app. Set `PULSE_ECHO_MODE=false`. Set `PULSE_LLM_CHAT_URL` to the full `/v1/chat/completions` URL, `PULSE_LLM_MODEL` to its served model name, and `PULSE_LLM_API_KEY` if the server requires a bearer token. For Qwen3 servers that support `chat_template_kwargs`, set `PULSE_LLM_DISABLE_THINKING=true` to get reply text within the configured token cap.
   Restart the API and Celery worker after changing `.env`; both cache settings at process startup. A webhook challenge can pass while message POSTs fail signature verification if the App Secret changed after startup.
3. Copy `apps/web/.env.local.example` to `apps/web/.env.local` and set the local Supabase URL/anon key and `NEXT_PUBLIC_API_URL=http://localhost:8000`.
4. The minimal `supabase start` command applies the versioned migrations on a new local project. For an existing local project, run `supabase migration up` to add pending phases without resetting data. Configure custom SMTP in Supabase Auth for real invitations and recovery email. Local Mailpit starts only when you remove it from the exclude list.
5. Install API dependencies in a Python 3.12 virtual environment: `python3.12 -m venv apps/api/.venv` and `apps/api/.venv/bin/pip install -r apps/api/requirements.txt`. Install web dependencies with `npm ci` in `apps/web`.
6. Start an existing local Redis service (on macOS with Homebrew, `brew services start redis`), then run API, Celery worker, and Celery beat in separate terminals from the repository root:

   ```sh
   PYTHONPATH=apps/api apps/api/.venv/bin/uvicorn pulse_api.main:app --reload --port 8000
   PYTHONPATH=apps/api apps/api/.venv/bin/celery -A pulse_api.tasks.celery_app worker --pool=solo --concurrency=1 --loglevel=info
   PYTHONPATH=apps/api apps/api/.venv/bin/celery -A pulse_api.tasks.celery_app beat --loglevel=info
   ```

   Run `npm run dev` in `apps/web` and open `http://localhost:3000`.
   The solo worker setting is for local macOS development; it avoids the prefork task failure observed with the local Python/Celery combination. Staging uses the worker configuration in Docker Compose.

7. Create the first tenant and invite its owner:

   ```sh
   PYTHONPATH=apps/api apps/api/.venv/bin/python -m pulse_api.operator create-tenant --name "Test business" --owner-email owner@example.com
   ```

   For each Meta sandbox asset, set `PULSE_CHANNEL_TOKEN` in the process environment and run `connect-channel` with `--tenant-id`, `--channel`, `--account-id`, and `--display-name`. Do not put access tokens in command arguments or commit them. The account IDs must be the Page ID, Instagram account ID, and WhatsApp phone number ID that appear in the corresponding webhook payloads.

## Staging

The approved target is an Ubuntu 22.04 VPS with two HTTPS hostnames. Fill `.env` with the remote Supabase project keys, `PULSE_APP_HOST`, `PULSE_API_HOST`, `PULSE_WEB_ORIGIN=https://<app-host>`, and the three `NEXT_PUBLIC_*` values. The existing `SUPABASE_ANON_KEY` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` settings accept a new `sb_publishable_` key; `SUPABASE_SERVICE_ROLE_KEY` accepts a server-only `sb_secret_` key. Never put the secret key in a `NEXT_PUBLIC_*` variable. Configure the Supabase Auth site URL and allowed redirect URL as `https://<app-host>/auth/callback`. Apply pending migrations with the Supabase CLI, then run `docker compose up -d --build` on the VPS. Point both DNS records at the VPS before expecting Caddy certificates.

Meta webhook callback: `https://<api-host>/webhooks/meta`. Set the same verify token in Meta and `.env`, configure the three channel subscriptions, and connect each sandbox asset with the operator CLI. Instagram uses Instagram Login directly. A real inbound and one human text reply must succeed on all three channels before staging acceptance. Meta app review and broader production messaging permissions are separate from sandbox acceptance.

## Verification

Run `PYTHONPATH=apps/api apps/api/.venv/bin/pytest -q apps/api/tests`, `npm run typecheck`, and `npm run build` in `apps/web`. With local Supabase, Redis, and the Celery worker running, `PYTHONPATH=apps/api apps/api/.venv/bin/python apps/api/tests/integration_local.py` exercises Auth, RLS, webhook deduplication, worker processing, inbox reads, owner invites, WebSocket ticket creation, and failed outbound visibility. It creates uniquely named fixture users and tenants in the local database. Real Meta delivery still requires the sandbox credentials and staging hostnames.

Phase 2's database flow can be checked against a local PostgreSQL server with `psql -X -v ON_ERROR_STOP=1 postgres -f apps/api/tests/commerce_postgres.sql`. This applies both migrations in a transaction, checks stock, payment, cancellation, tenant isolation, and product restoration, then rolls the transaction back.
With local Supabase running and the Phase 2 migration applied, `PYTHONPATH=apps/api apps/api/.venv/bin/python apps/api/tests/integration_commerce_local.py` exercises Auth, tenant isolation, catalog, CSV preview and import, order confirmation, stock reservation and restoration, payment history, and archive/restore through the HTTP API. It creates uniquely named local fixture users and tenants.

Phase 3's database checks are `apps/api/tests/agent_postgres.sql` and `apps/api/tests/agent_rls_postgres.sql`; both wrap synthetic records in a transaction and roll back. The first checks fragment coalescing, idempotent replies, media handoff, and human takeover. The second checks tenant isolation, test-before-publish, immutable versions, and enabling live AI. The configured `qwen3` endpoint was checked with a short non-sensitive prompt. A real Meta round trip remains a separate sandbox acceptance check.

The workspace checks are `docker exec -i supabase_db_pulse-local psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 < apps/api/tests/workspace_postgres.sql` from the repository root. They roll back synthetic CRM, ticket, comment, Admin Agent, analytics, metering, and tenant-isolation records. The dashboard, all five inbox tabs, and Admin Agent were also inspected in a local signed-in browser session. These checks do not verify Meta delivery.

With local Supabase and the configured model endpoint available, `PYTHONPATH=apps/api apps/api/.venv/bin/python apps/api/tests/integration_agent_local.py` exercises Auth, draft save, private model preview, publish gating, live enablement, fragment coalescing, and a queued AI reply through the HTTP API and database. It creates a uniquely named local fixture account and tenant; it does not send to Meta.

## Agent workflow

In **Agent Studio**, an owner enters business identity and voice, policies, FAQs, and the attachment handoff reply. Save a draft, test it privately in the phone panel, then publish. A saved edit invalidates the previous test until the new draft is tested. Publishing stores an immutable version; live AI stays off until the owner enables it. If live AI is already on, publishing the tested draft updates live replies immediately after the confirmation in the dashboard.

Inbound text waits for three seconds of quiet, up to eight seconds from the first fragment. The worker reads only tenant-scoped published knowledge and current active catalog prices and stock, then asks the configured local model for a response. Media and inference failures are handed to a human with the configured holding reply. A human reply takes over the conversation; staff can explicitly return it to AI in **Inbox**. The database checks ownership again before an AI reply is queued. The existing outbound worker enforces Meta's response window.

The model adapter uses no additional Docker image. The current supplied ngrok model endpoint is configured only in the ignored local `.env`; it is an external dependency and may change. Do not enable customer AI until the model has been evaluated on real authorized Bangla and Banglish examples. Model output can still be wrong despite grounding instructions.

## Sandbox readiness

The new workspace migrations have been applied locally, not to the remote Supabase project. The remote project has no verified owner, tenant, channel connection, or real Meta message. A valid owner login, Meta app secret, webhook verify token and Graph API version, each test Page/Instagram/WhatsApp asset ID and token, and an HTTPS callback reachable by Meta are needed for sandbox acceptance. The operator CLI takes channel tokens from `PULSE_CHANNEL_TOKEN`, not command arguments. Verify the inbound webhook, human send, AI reply, public comment reply, handoff, and analytics against actual sandbox events before enabling live customer replies. The configured model endpoint is an external dependency.

For platform operations, grant an existing authorized user access with `PYTHONPATH=apps/api apps/api/.venv/bin/python -m pulse_api.operator grant-operator --user-id <uuid>` and open `/ops`. This is separate from a tenant owner role. The `Settings` page reports 7/30/90-day usage counts; Pulse has no commercial pricing or payment collection yet.

## Commerce workflow

Open **Catalog** to select the workspace currency before adding data. Owners can choose BDT, USD, EUR, or GBP; it locks when the first product or order exists. Owners and staff can add draft products, set variants and prices, attach a JPEG/PNG/WebP upload or public HTTPS image URL, then activate the product. Existing stock is adjusted with a reason, creating an audit movement. The CSV template has one row per variant; preview reports row errors, and import commits all products in one database transaction. Product handles and SKUs must be unique within the workspace.

Open **Orders** to create a manual draft from active catalog variants. Submit it for confirmation, then confirm to recheck prices and stock and reserve units. Continue through processing and completion. Cancellation before completion restores reserved units once. Payments are manual records; cancelling a paid order keeps those records and shows the amount due for a refund. Pulse does not process the refund. Unreferenced products can be removed; products used by an order are archived and may be restored as drafts. See [Phase 2 design](docs/plans/2026-10-16-phase-2-commerce-design.md) for the approved boundary and reference evidence.

## Operational behavior

- Webhooks are HMAC verified and stored before acknowledgment. Celery processes them idempotently; beat requeues pending records.
- Human sends are queued in Postgres. A timeout or worker death yields an **uncertain** state; staff must check the channel before sending again. Explicit retry is available only for known failures.
- The inbox uses WebSocket refresh notifications with 15-second polling as fallback.
- A daily worker task deletes private media after 30 days and message records after 365 days.
