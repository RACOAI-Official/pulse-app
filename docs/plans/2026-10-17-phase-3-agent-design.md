# Pulse Phase 3: customer agent

Approved 2026-10-17 for `dev/init`. Phase 3 follows the project brief: tenant knowledge, agent configuration, guarded customer replies, and private testing before publication. The runtime is a configurable OpenAI-compatible local endpoint; the supplied served model is `qwen3`. Its credential stays in local environment configuration, never in git.

## Evidence and limits

Presswayy AI Setup visibly has a teaching panel, phone preview, rulebook, behavior rules, structured business facts, FAQs, and a live action. Train Content describes page-post imports, but its controls were unavailable to this account. No training item or live action was submitted, so Presswayy persistence and backend behavior remain unknown. Pulse uses its own brief's explicit draft/test/publish and separate customer/admin runtime decisions.

## Behavior

- Each tenant has a draft and immutable published versions. Owners edit business facts, FAQs, policies, and behavior in the draft. Publishing copies a validated snapshot. Draft edits never affect live replies.
- The test console runs the draft privately. It never sends a Meta message or changes a customer conversation.
- Live automation is off by default. An owner publishes a version and enables AI before any customer reply. Human takeover pauses AI per conversation; only an explicit hand-back resumes it.
- The customer runtime gets only read-only catalog, inventory, knowledge, and policy facts. It cannot mutate catalog, orders, settings, or training. A reply must be grounded in these facts. Unsupported media or uncertain requests escalate to a human.
- An OpenAI-compatible chat-completions adapter has an explicit endpoint, model, timeout, and optional bearer key. Missing or failed inference escalates rather than fabricating a reply. No extra Docker image is required.
- The existing Meta 24-hour send window and outbound delivery handling remain authoritative. Duplicate inbound webhook processing must never generate duplicate AI replies.

## Implementation plan

1. Add versioned tenant configuration, test transcripts, conversation ownership, and RLS-backed functions. Commit schema.
2. Add guarded local-model adapter, read-only context retrieval, draft test/publish/enable endpoints, and inbound worker integration. Commit API and worker.
3. Add distinct Pulse training and test UI, ownership controls in inbox, and setup docs. Commit frontend and docs.
4. Apply migrations and verify tenant isolation, draft/live separation, idempotency, fallback, API behavior, and browser flow. Commit verification fixes.

## Sandbox boundary

The supplied model endpoint is an external runtime dependency. The user still needs to supply Meta app credentials, the specific test assets/tokens, and a reachable webhook URL for Meta sandbox traffic. Sandbox availability cannot be claimed until those are configured and a real round trip is observed.
