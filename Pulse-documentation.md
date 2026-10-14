# RACO Pulse — Project Brief

## Building brief

A multi-tenant SaaS platform that answers a client's Facebook Messenger, Instagram and WhatsApp customers with a self-hosted AI agent, captures orders, and records every interaction in a unified CRM.

The business owner manages everything from our dashboard: catalogue, stock, prices, knowledge base, agent personality. They can do it through the UI or by talking to a separate admin agent in plain language.

One clarification worth settling with the team: this is not an app that runs inside Facebook. A Meta app is a set of API credentials and permissions registered with Meta, with no user-facing surface in Facebook or Business Manager. What we build is a normal web dashboard on our own domain. The only part a client ever sees of the Meta app is the Connect Facebook popup during onboarding.

## **Feature Lists/ Functional Requirements**

### 1. Admin Side & Product Management

- **Dual Product Upload Mechanism:**
- **Bulk Upload (CSV):** Allows business owners to upload products in bulk using a CSV file, including product names, prices, variants, quantities, and image links.
- **Manual Chat Upload:** Allows owners to input product details one by one through a chat interface (specifying name, price, variants, quantity, and multiple colors with all associated images and many more..).

### 2. Agent Training & Behavior Customization

- **Human-Like Behavior Training:** Train the agent to interact with customers naturally like a human.
- **Gender-Based Addressing:** Set logic to address male customers as "Bhaiya / Brother" and female customers as "Apu / Sister".
- **Language Preference Detection:** Instruct the agent to identify the customer's preferred language (Bangla, English, or others) before starting the main conversation.

### 3. Omnichannel Integration

- **Social Media & Messaging Connectivity:** Once trained, the agent can be linked with a single click to:
    - **Facebook Messenger** (with page selection options)
    - **Instagram** (with page selection options)
    - **WhatsApp Business** (via phone number entry)
- **Website Integration (Phase 2):** Embedding the trained agent into the business owner's existing website is slated for **Phase 2**.

### 4. In-App Preview & Testing Window

- **Real-Time Demo Window:** A compact mobile-view interface inside the business owner's dashboard where they can act as a customer and test how the agent replies *before* going live.
- **Safe Iteration & Update Mechanism:** When an agent is retrained, it does not go live immediately. The owner tests the updated agent in the demo window first and only pushes it live by clicking an **"Update Agent"** button when satisfied.

### 5. Customer-Facing Features & Automation

- **Multimedia Queries (Image-Based Search):** Customers can send a product image in the chat to ask about price, availability, or alternative variants.
- **Stock-Out Recovery & Auto-Notification:** If an item is out of stock, the agent informs the customer. Once that product is restocked, an automated notification message is sent to those specific customers (e.g., *"Hi, this product is now available in our stock..."*).

### 6. Business Analytics & Intelligence

- **Dedicated Analytics Agent:** A separate chat-based agent with which business owners can converse directly to query business metrics (e.g., top-selling products, stock status, high-demand variants, target customer regions). ()
- **Visual Analytics Dashboard:** A dedicated dashboard displaying continuous analytics alongside Machine Learning (ML)-driven future projections and recommendations.
- **Stock Alert for Admin**: Automated alerts sent to the business owner (via Messenger, WhatsApp, and the admin dashboard) when a product's inventory drops low, prompting timely stock replenishment.

## Scope for v1

**Channels:** Facebook Messenger, Instagram DM and WhatsApp, all direct on Meta's APIs. No Twilio or other BSP. **Text messages only.**

**Commerce lives with us.** There is no external system in v1, so products, variants, prices, stock and orders are held in our own database. This is not a smaller v1 than a connector build, it is a different one: we are writing a commerce module.

**Client-facing features:** unified inbox across all three channels, AI agent with read-only tool calling, catalogue and stock management by dashboard or by conversation with an admin agent, knowledge base, agent personality and policy config, order capture, cross-channel CRM timeline, per-tenant analytics.

**Our side:** self-serve onboarding, central ops console across all tenants, usage metering.

**Out of scope for v1:** WooCommerce and Shopify connectors (v2), voice notes and images, website chat widget, marketing broadcast campaigns, payment gateway, courier integration, multi-warehouse, agent mobile app.

**Media fallback.** Customers in this market send voice notes and payment screenshots constantly. Text-only cannot mean silence. Non-text messages auto-escalate to the human inbox with a holding reply. Cheap to build, and it stops the agent looking broken on day one.

**Sequencing note.** Messenger and Instagram need only Business Verification and App Review. WhatsApp additionally needs Tech Provider status. The fastest route to paying clients is to ship Messenger and Instagram first and add WhatsApp when Tech Provider clears, which could be six to eight weeks earlier to market.

## Architecture

Diagrams for the runtime flow, the platform layers, client onboarding and the two-agent split are on the [Miro board](https://miro.com/app/board/uXjVHlOm15s=/).

**Runtime, one message:** Meta webhook lands on the ingest API, which verifies the signature, dedupes on message ID and acknowledges fast. The message goes to a queue. A worker resolves the tenant from the page ID, Instagram ID or phone number ID. Non-text messages branch to the human inbox. Text goes to the customer agent, which calls read-only tools against our commerce module and knowledge base, generates a grounded reply, and sends it back through the channel adapter within the 24-hour window.

**Layers:** channel adapters, edge (ingest, queue, outbound sender), core services (tenant resolver, conversation, CRM, customer agent, admin agent, commerce module, knowledge base, metering), data (Postgres with row-level security, Redis, media store, encrypted token vault, audit log), and two interfaces — the client dashboard and our central ops console.

**The two-agent rule.** Conversational admin is a good feature and a dangerous one. Build two separate runtimes with separate tool registries, not one agent with a permission flag.

- *Customer agent*: read-only tools only — search products, check stock, get policy, get order status, create order, escalate. It has no write tool for catalogue, config or knowledge base. Ever.
- *Admin agent*: reachable only from an authenticated dashboard session, scoped to that tenant and that user's role. Every write confirms before executing and shows a diff. Deletes are soft with a restore window. Every AI-executed action lands in the audit log with the prompt that caused it.

Without this separation, a customer typing "set the price of the black shirt to 1 taka" is a live exploit. A permission check inside a shared agent is not enough — the customer agent must not hold the tool at all.

**The one rule that does not bend:** the AI is never the source of truth. Prices, stock, order status and policies come from a tool call or the client's stored config, never from the model.

## Meta requirements

Development needs none of this. A Meta developer account, an app in Development mode, a free WhatsApp test number with up to five verified recipients, a test Page for Messenger, and a professional Instagram account linked to it cover the entire build in sandbox. One app covers all three channels. Use a System User token, not the 24-hour token from the Getting Started panel.

For publishing, these are gates, not tasks, and they are the longest lead time in the project.

| Requirement | Needed for | Notes |
| --- | --- | --- |
| Our business verification | All three channels | 2 days to 3 weeks; rejections over name mismatches are common |
| App Review, Advanced Access | All three channels | 1 to 3 weeks, expect one rejection |
| Tech Provider status | WhatsApp only | Advanced Access to whatsapp_business_management; without it, calls on client WABAs fail with error 200 |
| Access Verification | Scaling onboarding | Raises the cap from 10 to 200 new clients per week |

**Permissions to request:** pages_messaging, pages_manage_metadata, pages_read_engagement, instagram_basic, instagram_manage_messages, whatsapp_business_messaging, whatsapp_business_management, business_management.

**How clients connect after publishing:** Messenger and Instagram through Facebook Login for Business, where the client grants our app access to their Page and its linked Instagram account. WhatsApp through Embedded Signup v4. Build v4 directly; v2 is deprecated in October 2026.

**Tech Provider, not Solution Partner.** Tech Providers carry no credit line, so each client supplies their own payment method and Meta bills them directly for WhatsApp message fees. We never front USD, which removes the forex problem.

**Instagram specifics:** the client's account must be professional and linked to their Page, with message access enabled in IG settings. Outside the 24-hour window only the human agent tag works — there is no template equivalent.

**We cannot lock clients in.** Businesses onboarded through Embedded Signup own their WhatsApp assets and keep full WhatsApp Manager access. The product is the moat.

## Cost model

Under Tech Provider, clients pay Meta directly for WhatsApp message fees. That is off our books. Messenger has no per-message fee at all.

Our monthly costs at roughly 50 tenants:

| Item | Monthly |
| --- | --- |
| App servers, workers, Postgres, Redis, media storage | 150 to 400 USD |
| GPU for self-hosted inference | 400 to 900 USD rented |
| Monitoring, error tracking, backups | 50 to 100 USD |

The GPU is the real cost and the one that scales with peak concurrency rather than average load.

For context on the client's side: Messenger and Instagram cost them nothing per message. A client running 1,000 orders a month pays Meta roughly 40 to 100 USD in WhatsApp fees, depending on how much traffic sits on WhatsApp versus the free channels. Marketing broadcast templates are billed per recipient with no free tier and are the largest variable in any client's bill. Clients will assume broadcasts are free because they are in the WhatsApp Business app. Raise it during sales, not after.

## Build sequence

Roughly four to six months to a sellable v1 with backend, frontend and someone owning AI quality. Dropping the commerce connectors saves time; building our own commerce module and the admin agent gives most of it back.

| Phase | What ships | Rough duration |
| --- | --- | --- |
| 0 | Meta paperwork started, sandbox app, webhook receiver with signature verification, all three channels echoing | 2 weeks |
| 1 | Tenant model, conversation store, unified inbox with humans replying | 3 to 4 weeks |
| 2 | Commerce module: products, variants, stock, orders, and the dashboard CRUD for them | 4 weeks |
| 3 | Knowledge base, agent config, customer agent with read-only tools, guardrails, test console | 5 weeks |
| 4 | Admin agent: write tools, confirmation flow, diff preview, soft delete, audit log, undo | 3 to 4 weeks |
| 5 | Order capture in conversation, CRM timeline, per-tenant analytics | 3 weeks |
| 6 | Onboarding: Facebook Login for Messenger and Instagram, self-serve wizard, ops console | 3 weeks |
| 7 | Embedded Signup for WhatsApp, once Tech Provider clears | 2 weeks |
| 8 | Hardening: tenant isolation testing, admin agent abuse testing, load, failure, reply quality evaluation | 3 weeks |

Two ordering rules worth holding to. Get the inbox working with humans replying before adding AI, so a client can run their business from our panel even if verification drags. And ship Messenger and Instagram to paying clients before WhatsApp is ready rather than waiting for all three.

## Team

| Role | Owns |
| --- | --- |
| Backend | Ingest, queue, tenant isolation, conversation and CRM services, commerce module, Meta integration |
| Frontend | Client dashboard, unified inbox, catalogue management, agent config UI, analytics, ops console |
| AI engineer | Both agent runtimes, tool design, guardrails, admin agent safety, Bangla and Banglish quality, evaluation harness |
| DevOps, part-time | GPU hosting, CI/CD, monitoring, backups, security review |

The AI role is not optional and is not a prompt-writing job. Reply quality on Banglish is what clients will judge the product on, and it needs someone running evaluations against real chat logs continuously, not once.

## Key risks

**Tenant isolation.** A webhook resolving to the wrong tenant means one client sees another's customer conversations. Enforce at the database with row-level security, not in application code. This is the failure that ends the business, not just the project.

**The admin agent as an attack surface.** Conversational write access is the most dangerous thing in the product. Mitigated by the two-agent split, confirmation before execution, soft deletes and a full audit trail. Test it adversarially before launch: try to reach a write tool from a customer message.

**The v2 migration trap.** Because v1 holds the catalogue, connecting WooCommerce or Shopify later raises the question of who owns stock. Decide now, not in v2. The right answer for almost every client is that the external system wins and our catalogue becomes a read cache. Design the v1 product tables as a cache that can be superseded, and v2 is a connector. Skip this and v2 is a rewrite.

**Meta verification delays.** Each rejection costs one to two weeks. Mitigated by building in sandbox meanwhile and by shipping Messenger and Instagram first.

**Banglish quality on a self-hosted model.** Smaller open models handle Bangla and code-switched Banglish noticeably worse than frontier APIs. Benchmark against real chat logs before the architecture is locked on local inference. If quality fails, the cost model changes.

**Text-only in a voice-note market.** Customers here send voice notes and payment screenshots as a matter of course. The media fallback has to be in v1, not deferred.

**Support load against unit economics.** At the price point this market bears, high-touch support inverts the margin. Onboarding has to be genuinely self-serve.

**Client account health.** One client sending unsolicited templates degrades their own WhatsApp quality rating, and a repeated pattern across tenants draws Meta attention to our app. We need per-tenant sending controls enforced by the platform.

## Open decisions

These need answers before build starts, because each one changes code.

- [x]  Stock ownership on v2 connect: does WooCommerce win, do we win, or is it a one-time import? Decide now, it shapes the v1 schema.

###

**Decision: The external commerce platform becomes the source of truth once connected.**

For v1, when a merchant doesn't have an external commerce system connected, Pulse owns the catalogue, variants, prices, inventory, and orders. Pulse is therefore the source of truth.

Later, when we introduce Shopify, WooCommerce, or another commerce integration, we don't want Pulse and the external store fighting over which stock number or price is correct.

So once an external commerce platform is connected, that platform becomes authoritative for the commerce information it manages. Pulse synchronizes that information and can maintain a local cache for fast reads, AI tool calls, analytics, and resilience, but Pulse does not independently overwrite the authoritative information.

In simple terms:

**No external store → Pulse is the source of truth.**

**External store connected → external commerce system is the source of truth, and Pulse becomes the synchronized conversational commerce layer.**

We should therefore design the v1 commerce schema with this future transition in mind. Products and variants should know where their authoritative data comes from rather than assuming Pulse will always own them.

This doesn't prevent us from training or improving our AI. Live merchant facts—prices, inventory, order status, etc.—shouldn't be trained into the model anyway. The model handles language, reasoning, Banglish, customer intent and conversation. Current business information is retrieved through tools.

---

###

- [x]  Admin agent scope: which roles can use it, and are there actions it may never take even for an owner?

**Decision: Role-based Admin Agent access, with backend-enforced permissions and some protected actions that AI can never perform.**

We don't want to make the Admin Agent owner-only because Pulse should eventually work for businesses with teams.

For v1, we'll start with three broad roles:

**Owner** gets full Admin Agent access for normal business administration—products, stock, pricing, knowledge base, AI configuration, and other permitted management actions.

**Manager** gets operational Admin Agent access. They can manage the things necessary to run the business day-to-day—products, inventory, orders, knowledge and similar operations—but don't automatically receive sensitive account-level powers.

**Staff** won't initially receive the write-capable Admin Agent. They'll use the inbox and whatever normal dashboard permissions the business gives them.

There should also be a category of **protected actions that the AI cannot perform at all**, even if the owner asks. Things like transferring account ownership, bypassing the permission system, permanently destroying audit history, and certain critical security operations should require dedicated UI flows.

Most importantly, authorization cannot depend on the model behaving correctly.

If a manager tells the Admin Agent, “Make me the owner,” we don't want the LLM deciding whether that's okay. The backend authorization system rejects the tool call because that user doesn't have permission.

We're also keeping the original **two-agent architecture**: customer agent and Admin Agent are separate runtimes with separate tool registries. The customer-facing AI simply never possesses catalogue/configuration write tools.

- [x]  Does the admin agent execute on confirmation only, or can trusted owners enable direct execution?

**Decision: In v1, every Admin Agent write requires explicit confirmation and a diff/preview before execution.**

If the owner says:

“Raise the price of every T-shirt by 10%.”

Pulse doesn't immediately change 100 products.

It calculates the intended changes and shows the owner what is about to happen: which products are affected, their current values, their proposed new values, and any other relevant consequences.

Only after the user confirms does Pulse execute the change.

Early in the product's life, that extra confirmation is worth the friction. We're still learning how users communicate with the agent, discovering ambiguous instructions, and evaluating how reliably the AI translates natural-language instructions into actions.

An incorrectly interpreted sentence should not immediately alter hundreds of products.

Every AI-executed write also needs an audit record: who requested it, what they asked, what Pulse proposed, what was confirmed, what actually changed, when it happened, and where applicable whether it can be undone.

Later, we can introduce **risk-based auto-execution**. Low-risk, easily reversible operations might eventually be allowed to execute automatically if the owner enables it. High-impact actions can continue requiring confirmation.

But for v1:

**AI proposes → human reviews → human confirms → system executes → action is audited.**

- [x]  Price-change policy: if stock or price changes after the agent quoted it, do we honour the quote or correct it?

**Decision: A conversational quote is informational until the customer confirms the order. At confirmation, Pulse revalidates price and inventory and then locks the confirmed order snapshot.**

Suppose Pulse tells someone:

“Black XL is available for 2,000 BDT.”

Five minutes later, the merchant changes it to 2,200 BDT—or someone else buys the last XL.

We don't automatically treat that earlier message as an indefinite contractual reservation.

Until the order is confirmed, the current authoritative price and inventory win.

When the customer says they want to place the order, Pulse checks the commerce system again. If the product is still available at the quoted price, everything continues normally.

If something changed, Pulse tells the customer before creating the order. For example:

“The price has changed from 2,000 BDT to 2,200 BDT. Would you still like to continue?”

Once the customer confirms and the commerce system successfully creates the order, we snapshot the transaction details: product, variant, quantity, agreed unit price and other relevant information.

A catalogue price change tomorrow therefore doesn't rewrite yesterday's confirmed order.

The rule is:

**Before confirmation → current price and availability win.**

**At confirmation → revalidate price and stock atomically.**

**After confirmation → the order snapshot wins.**

Later, we could introduce explicit time-limited quote reservations, but that's unnecessary complexity for v1.

- [x]  Message coalescing window: how long do we wait before replying to a customer sending fragments?

**Decision: 3-second sliding message-coalescing window, with an approximately 8-second maximum from the first fragment and fast paths for clear transactional actions.**

People don't communicate with businesses like they're writing emails.

Someone might send:

“Hi”

then:

“black shirt ta”

then:

“XL ase?”

If Pulse immediately processes every individual message, the AI could generate three responses while the customer is still trying to finish one thought.

So when a message arrives, Pulse waits approximately three seconds. If another message from that customer arrives during those three seconds, the timer resets and Pulse combines the fragments.

After three seconds of silence, the combined message is sent to the agent.

We also don't want someone who continuously sends fragments to keep the system waiting forever, so we'll have a maximum window of roughly eight seconds from the first message.

There can also be fast paths. Clear transactional actions such as “Yes, confirm the order” don't necessarily need to sit around waiting for additional fragments.

And importantly, these values should be **configuration rather than hard-coded assumptions**. Once we have thousands of real Pulse conversations, we can measure actual messaging behavior and tune them.

- [x]  Media fallback wording, and whether it differs by channel.

**Decision: Acknowledge → escalate to human → pause AI → human handles → explicit hand-back to AI.**

Pulse v1 is text-based, but our customers aren't going to behave according to our product scope.

They're going to send voice notes, screenshots, payment confirmations, product photographs and other media.

Pulse should never pretend it understood media that the current agent can't process.

Instead, unsupported media automatically triggers a human escalation.

The customer gets one short holding response along the lines of:

“Thanks! I've received that. I'm passing this to a team member who can take a look and help you.”

The exact wording shouldn't be globally hard-coded. Merchants should be able to customize it according to their brand personality, including Bangla/Banglish.

The underlying behavior remains consistent across Messenger, Instagram and WhatsApp rather than us building three different media-handling systems for v1.

Once the escalation happens, the AI pauses on that conversation. We don't want a human examining a payment screenshot while the AI simultaneously continues talking to the customer.

The human resolves the issue and then explicitly returns the conversation to AI.

- [x]  Which LLM, and does it clear the Banglish bar on real chat logs?

**Decision: Pulse will be model-agnostic. We will benchmark models against real Bangla/Banglish commerce conversations before choosing the production model.**

We're deliberately **not locking Pulse to one LLM before we have evidence**.

Banglish is too important to the product. Formal Bengali benchmark performance doesn't necessarily tell us how well a model handles something like a real customer mixing Romanized Bengali, English, abbreviations, spelling mistakes, slang and commerce terminology.

We'll therefore build the AI layer so the underlying model can be swapped.

Before production, we create a proper Pulse evaluation dataset using appropriately authorized/anonymized commerce conversations. It should cover Bangla, Banglish and English; product discovery; vague questions; negotiation; order capture; tool selection; customer corrections; escalation; and adversarial cases.

Then we benchmark several strong self-hosted/open-weight candidates against a strong frontier API baseline.

We're evaluating more than whether the responses “sound good.” We care about Banglish comprehension, correct tool selection, factual grounding, hallucination rate, order-capture accuracy, escalation behavior, latency, throughput and cost.

If an open model meets the quality threshold, we self-host it.

If it doesn't, we shouldn't sacrifice the product experience just to say we're self-hosted. We can launch with a stronger API model while continuing to improve and evaluate our own/self-hosted solution.

The important architectural decision is therefore:

**Pulse owns the orchestration and evaluation layer; the underlying LLM is replaceable.**

And live merchant facts still don't live inside the model. The model uses tools to retrieve current prices, inventory, policies and order status.

- [x]  Billing unit: per active customer, per conversation, or flat tier?

**Decision: Tiered monthly SaaS subscriptions with included usage allowances, while Pulse internally meters usage much more granularly.**

We don't want merchants feeling like every customer message is running up a meter.

Pulse should commercially feel like a predictable SaaS product.

So the customer-facing structure will eventually look something like **Starter / Growth / Pro**, with each tier containing defined allowances and capabilities.

The allowance could incorporate things such as AI-handled conversations/messages, connected channels, team seats and feature access. Once a merchant consistently exceeds their allowance, they either upgrade or pay a clearly defined overage.

We haven't chosen the actual prices yet.

That's intentional.

Before fixing price points, we need pilot merchants so we can understand real usage, cost-to-serve, inference costs, willingness to pay and the amount of support each merchant requires.

Internally, however, Pulse should meter aggressively from day one: messages, conversations, active customers, inference/tokens, tool calls, orders captured, channel usage and preferably approximate inference cost per tenant.

That gives us the data required to design profitable tiers later.

Meta WhatsApp charges remain separate. Under the proposed Tech Provider model in the brief, clients pay Meta directly, rather than those charges going through Pulse. file

## Additional Decisions We Made

---

These weren't among the eight explicit open questions in the original brief, but we identified them as decisions that engineering needs before implementation.

### Decision 9 — What is the Pulse order lifecycle?

**Decision: Draft → Pending Confirmation → Confirmed → Processing → Completed, with Cancelled as an exit state.**

**Draft** means Pulse is still building the order. Maybe it knows the customer wants a black shirt but still needs the size, quantity, address or another required field.

Nothing is committed yet.

**Pending Confirmation** means Pulse believes it has everything required. It presents the final order summary to the customer—products, variants, quantities, prices and other relevant details—and asks the customer to confirm.

When the customer confirms, Pulse performs the price-and-stock validation from Decision 4.

If validation succeeds, the order becomes **Confirmed**. This is where the transaction details become an immutable order snapshot rather than merely reflecting the live catalogue.

**Processing** means the merchant is operationally handling the order.

**Completed** means the merchant considers the order fulfilled.

**Cancelled** is an exit state and should include a structured cancellation reason where possible—customer request, merchant cancellation, unavailable inventory, duplicate order and so forth.

We also decided not to make one enormous status field responsible for everything.

The data model should keep **order status**, **payment status**, and eventually **fulfilment status** separate.

That way, when Pulse later adds payment gateways and courier integrations—which the current brief explicitly leaves outside v1—we don't need to redesign the entire order state machine. file

---

### Decision 10 — When does Pulse reserve/deduct inventory?

**Decision: Inventory is committed when the customer confirms the order—not while they're merely chatting or building a draft.**

We don't want a customer saying:

“Do you have black XL?”

and effectively locking one unit of inventory.

We also don't want abandoned draft orders holding stock that another genuine customer could purchase.

So **Draft** and **Pending Confirmation** do not reserve stock.

When the customer explicitly confirms, Pulse performs the final authoritative stock and price check.

If sufficient stock exists, the confirmation and stock operation need to happen safely as one transaction: Pulse creates/confirms the order and commits the relevant inventory.

If another customer bought the final item just before confirmation, Pulse doesn't create an impossible order. It tells the customer that availability changed.

This aligns neatly with Decision 4:

**Conversation/quote → no reservation.**

**Customer confirmation → revalidate.**

**Successful confirmation → commit stock + snapshot order.**

Later, payment gateways or external commerce systems may change exactly how reservations work, but that's the cleanest model for Pulse's v1 text-based order capture.

---

### Decision 11 — How does human ↔ AI handoff work?

**Decision: AI is active by default. Human takeover immediately pauses AI for that conversation. Returning to AI requires an explicit hand-back.**

We don't want the system trying to be clever about guessing whether a human has “finished.”

Normally, the Pulse AI owns the conversation.

If a staff member presses **Take Over**, or if a rule such as unsupported media triggers human escalation, the conversation enters human-control mode.

At that point, the AI immediately stops sending customer-facing responses.

Any AI response that was queued but hasn't been sent should be cancelled where technically possible. New incoming customer messages are still stored in the unified conversation history, but they're presented to the human rather than generating automatic AI replies.

The human handles the customer for as long as necessary.

When they're finished, they explicitly select something like **Return to AI**.

Only then does automated responding resume.

This gives us a very predictable state:

**AI Active → Human Takeover → Human Active → Explicit Hand-back → AI Active.**

The key principle is that **there should never be uncertainty over who currently owns the conversation**. Pulse shouldn't have a human and an AI unknowingly replying to the same customer simultaneously.

---

## **Where we've landed**

Taken together, these decisions give Pulse a fairly coherent philosophy.

# “AI handles intelligence and conversation. Business systems hold truth. Humans retain authority over consequential actions.”

Pulse retrieves live commerce facts rather than memorizing them; external commerce platforms can become authoritative without breaking our architecture; Admin Agent writes require human approval; confirmed orders become stable snapshots; stock isn't held hostage by abandoned conversations; unsupported situations cleanly reach humans; and the underlying LLM can improve or change without rebuilding the product.

# Those are the **11 decisions we've made so far**.
