# Pulse Phase 0+1 design

Approved in the planning conversation on 2026-10-14. The implementation boundary is the Pulse brief's Phase 0 and Phase 1: three Meta sandbox channels, verified webhooks, tenant-safe storage, and a shared human inbox. AI, commerce, tickets, comments, and self-serve channel onboarding follow later.

Next.js owns the Pulse UI and Supabase Auth session. FastAPI is the sole app API, validates Supabase JWTs, and uses the caller's token for PostgREST reads so tenant RLS remains active. A narrowly scoped SQL RPC creates human replies after checking membership. A trusted worker processes verified webhook records and sends queued replies using operator-managed channel credentials. Redis/Celery handles work dispatch; persisted pending records allow reconciliation after queue loss. FastAPI WebSockets notify clients to refresh after commits.

The inbox is a compact, dark graphite interface with channel filters, search, unread counts, open/resolved state, inbound text/media, and outbound human text. Owner and staff share the inbox. An operator creates tenants and channel connections; owners can invite staff. Media remains private and is purged after 30 days; message text after 12 months.

REA's official Codex MCP and workflow skill are used to capture authenticated Presswayy actions in a separate Chrome debugging profile. Evidence records observations, inferences, and unknowns separately. The current Free Presswayy account has no connected conversations; this limits comparison of populated flows.

Acceptance requires local automated checks of auth, RLS, signature verification, replay/deduplication, send states, and WebSocket authorization, then real inbound and human reply on Messenger, Instagram DM, and WhatsApp Meta sandbox assets in staging.
