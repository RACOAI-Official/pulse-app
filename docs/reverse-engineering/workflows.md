# Workflows and candidate Pulse contracts

The first part of each workflow describes what the browser showed. A **Pulse candidate** is an implementation interface to refine later; it is not a discovered Presswayy API. No order, product, message, payment, ticket, or account setting was created or changed during this pass.

## Access, business context, and onboarding

**Observed:** Signed-out entry offers a business-name start and a Sign in action. `/login` accepts a phone number or switches to email. The signed-in shell shows a current-business selector and Logout. The dashboard presents five AI setup steps, with business information first. The post-Continue authentication step and Logout result remain **unknown**.

**Pulse candidate:** Keep `User`, `Business/Tenant`, `Membership/Role`, and `Session` separate. Every dashboard read/write should resolve a tenant from the authenticated session, never from an untrusted client field. Document sign-in, sign-out, password reset, and tenant switching as separate acceptance flows when implemented.

## Unified Inbox and human handoff

**Observed:** Inbox has Messages, Orders, Unreplied, Tickets and Comments tabs, channel filters, search, list and detail panes. Current account has no connected channel or conversations; a Facebook-connect prompt appears. **Stated by FAQ:** Messages are private; comments are public. A comment reply posts publicly. Conversations can switch between Bot and manual mode.

**Pulse candidate:** `Conversation` should contain tenant, channel, external thread/customer IDs, assignment, response owner, unread/reply state, and ordered messages. `Message` should distinguish inbound, AI, human, and system origin. `CommentThread` should retain original post/comment IDs and public reply state. The existing Pulse brief already decides that human takeover pauses AI until explicit hand-back; use that rule instead of assuming Presswayy's exact automation policy.

**Important cases:** duplicate webhook delivery; simultaneous AI/human replies; channel reply-window expiry; disconnected channel; unsupported media; public comment versus private DM; retries that must not send duplicate replies. These are Pulse requirements from the brief and integration reality, not verified Presswayy flows.

## Catalog, offers, and orders

**Observed:** Products has Products and Combos & Offers. Manual product entry includes title, category, description, images/attachments, optional variants, SKU, prices, stock and delivery charge. WordPress and CSV import appear as tabs; their downstream steps were not tested. Orders exposes metrics, filters, order-field configuration, and manual order creation. Order fields use a unique key and customer-facing question. Manual orders accept customer and address data, items, discount, delivery charge, payment method, paid amount, status and remarks.

**Pulse candidate:** Model `Product`, `Variant`, `Media`, `Offer`, `Order`, `OrderItemSnapshot`, `OrderFieldDefinition`, `PaymentStatus`, and later `FulfilmentStatus`. A confirmed order stores agreed item prices and quantities as a snapshot. The Pulse brief’s confirmation-time price/stock validation and stock commitment remain authoritative. Map Presswayy's displayed statuses to Pulse's lifecycle rather than copying the labels into one overloaded status field.

**Important cases:** stock change between quote and confirmation; duplicate order creation; variant-specific stock/prices/images; zero-stock items; invalid custom field keys; discount and delivery-charge arithmetic; deleted or changed products referenced by historical orders. Verify imports with sample files only in a future test account.

## AI training and deployment

**Observed:** AI Setup combines a teaching chat, test phone, a five-step guide, Rulebook, Share, media controls and a live-status action. The phone said the AI had not learned anything yet. Train Content describes importing page posts and attaching products, but controls were not available in this account. No training message, test prompt or live toggle was submitted, so persistence, model behavior and deployment semantics are **unknown**.

**Pulse candidate:** Separate draft training material, versioned agent configuration, test sessions and published agent version. Use the existing brief's explicit test-then-publish behavior, separate customer/admin agent runtimes, read-only customer tools, and confirmation plus audit for admin writes. Store source provenance for product facts and training material so current price/stock always comes from commerce services.

**Important cases:** malformed or contradictory instructions; draft versus live drift; testing without sending a customer message; media the current model cannot interpret; Bangla/Banglish evaluation; accidental publication; prompt injection from customer text or imported content.

## Connections and external systems

**Observed:** Facebook and Instagram detail pages check connection status. WhatsApp, commerce, Sheets, courier and website cards are Standard gated. Card copy describes capabilities, not the actual configuration screens. **Stated by FAQ:** Instagram DM support requires a Professional account linked to a Facebook Page.

**Pulse candidate:** Represent each connection with tenant, provider, asset ID, health, granted capabilities, token reference, and sync cursor. Use channel adapters for messages and separate commerce/courier connectors. The Pulse brief decides that, once a later external commerce connector is enabled, the external store owns price and stock; preserve that authority rule. Do not infer Presswayy's API endpoints or sync conflict policy from marketing copy.

## Analytics, billing, and operations

**Observed:** Dashboard shows sales, customer, order and chat metrics. Insights pages preview deeper analytics and logs behind Standard. Billing shows balance, Free plan, recharge and subscription choices. Support has tickets and FAQs. Settings shows profile, security, AI behavior and several gated tabs. No payment or account change was performed.

**Pulse candidate:** Define metric events and time zones before chart implementation. Separate usage metering, wallet/credit ledger, and subscription entitlements. Maintain audit events for account changes and AI-admin writes. Build ticket records only if Pulse chooses support tickets as a product feature. Current Presswayy pricing is reference evidence, not a Pulse commercial decision.

## Inferred premium behavior: use as discovery prompts

For later access or interviews, test whether couriers book from orders and push tracking events back; whether AdsFlow attributes a message/order to a campaign; whether broadcasts enforce approved templates, audience consent, rate limits and opt-out; whether AI Calls produce transcripts and human escalation; and whether store sync is two-way with conflict resolution. None of these internal mechanics were observed. Do not implement them from this document alone.
