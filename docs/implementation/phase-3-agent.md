# Phase 3 customer agent: implementation record

As of 17 October 2026, Phase 3 code is committed on `dev/init`. The approved behavior is in [the design](../plans/2026-10-17-phase-3-agent-design.md); observed Presswayy controls and their limits are in [the reference investigation](../reverse-engineering/workflows.md). This record describes Pulse's implementation, not a claim about Presswayy's private backend.

## What was built

| Area | Shipped behavior | Code |
| --- | --- | --- |
| Agent Studio | Owner edits business identity, behavior, language, addressing, policies, FAQs, and attachment handoff text. Members can view and privately test; only owners can save, publish, or enable live AI. A native confirmation dialog precedes publishing. | `apps/web/app/agent/page.tsx` |
| Private test | Authenticated tenant member asks the draft a question, with up to eight prior turns. The test reads current catalog facts, stores the prompt and response with the draft revision, and never sends to Meta. | `apps/api/pulse_api/main.py`, `apps/api/pulse_api/agent.py` |
| Live agent | A published snapshot and explicit tenant enablement are both required. The customer runtime can read current active products, variants, prices, and stock; it has no commerce or configuration write tools. Missing facts are handled through the prompt policy, but model accuracy remains an evaluation task. | `apps/api/pulse_api/agent.py`, `apps/api/pulse_api/tasks.py` |
| Inbox handoff | A human reply switches that conversation to human control. Staff can take over or return a conversation to AI. Attachment and model failures queue a holding reply and hand control to a human. | `apps/web/app/inbox/page.tsx`, `apps/api/pulse_api/main.py`, `apps/api/pulse_api/tasks.py` |
| Durable jobs | Inbound message inserts create tenant-scoped jobs only when AI is enabled and the conversation belongs to AI. Text fragments wait for three seconds of quiet, capped at eight seconds. New fragments replace pending jobs; a monotonic sequence prevents older work from replying after newer work. Pausing AI cancels pending work. | `supabase/migrations/20261017000100_phase_03_agent.sql` through `20261017000400_phase_03_pause_jobs.sql` |

The database has `agent_configs` (current draft, published snapshot, revisions, enabled flag), immutable `agent_versions`, per-user `agent_test_runs`, `agent_jobs`, and a per-conversation `responder`. RLS limits member reads to their tenant and private test runs to their author. Owner and member checks also run in the write RPCs. The service worker alone can claim and complete jobs. Completion rechecks AI ownership and enablement and queues at most one reply per job. The existing outbound worker checks Meta's 24-hour response window. Queued sends survive broker dispatch failure through the existing reconciler; uncertain Meta sends are not automatically repeated.

## HTTP API

All routes require a Supabase bearer session. `{tenant_id}` is a UUID, and membership is checked against that tenant.

| Route | Allowed role | Result |
| --- | --- | --- |
| `GET /tenants/{tenant_id}/agent` | Member | Current draft, published snapshot/version, revisions, enabled flag. |
| `PUT /tenants/{tenant_id}/agent/draft` | Owner | Validates and saves the draft; increments its revision. |
| `POST /tenants/{tenant_id}/agent/test` | Member | Runs the draft privately, records the result, marks its revision tested if unchanged. |
| `POST /tenants/{tenant_id}/agent/publish` | Owner | Requires a saved, currently tested draft with a business name; creates an immutable version. |
| `POST /tenants/{tenant_id}/agent/enabled` | Owner | Enables only after publication, or pauses AI and pending jobs. |
| `POST /tenants/{tenant_id}/conversations/{conversation_id}/responder` | Member | Switches a tenant conversation between `human` and `ai`. |

The API validates prompt and reply lengths and accepts up to 30 policies and 100 FAQs. Staff tests can mark a saved revision as tested; publishing remains owner only. Editing a draft does not alter the published snapshot. Publishing while enabled changes the snapshot used by subsequent jobs.

## Runtime and configuration

Set `PULSE_LLM_CHAT_URL` to an HTTPS `/v1/chat/completions` endpoint (loopback HTTP is also accepted), `PULSE_LLM_MODEL` to its served model, and `PULSE_LLM_API_KEY` if required. The supplied `qwen3` endpoint was configured in ignored local `.env`; no key is committed. `PULSE_LLM_DISABLE_THINKING=true` sends `chat_template_kwargs.enable_thinking=false` for compatible Qwen3 servers. The adapter uses a 30-second request timeout, bounded history, and a 450-token output cap. Empty or oversized model output fails closed to human handoff. The model server is an external dependency; Pulse does not start or maintain it.

Run the FastAPI process, Redis, Celery worker, and Celery beat as described in the [README](../../README.md). Beat reconciles due agent jobs every two seconds and stale processing jobs after two minutes. The daily retention task removes private test runs after 30 days. Neither test replies nor unpublished drafts are sent to Meta.

## Verification performed

- Four Phase 3 SQL migrations were applied to local and supplied remote Supabase projects. Transactional database checks in `apps/api/tests/agent_postgres.sql` and `agent_rls_postgres.sql` passed and rolled back their fixtures. They cover coalescing, idempotency, media handoff, owner gates, tenant isolation, and immutable versions. Pausing AI was exercised in the browser walkthrough.
- `PYTHONPATH=apps/api apps/api/.venv/bin/pytest -q apps/api/tests --disable-warnings` passed 15 tests. `npm run build` in `apps/web` passed. React Doctor found no issues in the final changed Agent Studio file.
- `PYTHONPATH=apps/api apps/api/.venv/bin/python apps/api/tests/integration_agent_local.py` passed against local Supabase and the configured model: Auth, draft, private reply, publish gate, enablement, fragment coalescing, and a queued AI message. It uses uniquely named fixtures and does not send to Meta.
- The local browser walkthrough confirmed save, private model reply, publish confirmation, enable, and pause. The test workspace was left with live AI paused. The supplied model returned a short grounded answer to the local test question. This is not a language quality or production safety evaluation.

## Unfinished external setup and limits

The remote project had no owner Auth account or tenant at the last check. Supabase rejected the supplied four-character password; a valid password is needed to finish this bootstrap. No Meta channel has been connected, and no real inbound or outbound Meta sandbox message has been observed. Real testing needs the app credentials, each test asset ID and token, correct subscriptions, and a public HTTPS callback for this API. An app key and secret alone are insufficient. Meta app review and production permissions are separate.

This phase implements the customer reply agent. It does not implement the separate write-capable admin agent, image interpretation, page-post training import, or full Bangla/Banglish evaluation. The ngrok model endpoint may change or go offline; customer AI should stay paused until the model and channel round trips are evaluated with authorized examples.
