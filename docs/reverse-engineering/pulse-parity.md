# Pulse parity and scope map

The comparison baseline is [Pulse-documentation.md](../../Pulse-documentation.md), especially “Scope for v1” and the eleven recorded decisions. **Reference** names a visible Presswayy area; **Pulse target** is an existing commitment or a proposed phase. This matrix does not revise the brief by itself.

| Capability | Presswayy evidence | Pulse target | Decision or gap |
| --- | --- | --- | --- |
| Tenant dashboard and business switching | Dashboard and business selector observed | v1 | Implement tenant-scoped metrics and business context; selector semantics need specification if one user has multiple tenants. |
| Unified Messenger/Instagram/WhatsApp inbox | Tabs and channel filters observed; no live chats | v1, with Messenger/Instagram launch first | Follow Pulse's explicit AI/human handoff rule. Connected-message behavior still needs test evidence. |
| Public comments and inbox tickets | Tabs and FAQ statement | Candidate later phase | Existing v1 brief focuses on direct messaging; decide whether comments and customer tickets belong in v1 before implementation. |
| Facebook and Instagram connection | Detail pages and setup entry observed | v1 | Meta review and connected-account flows are already in the brief. |
| WhatsApp connection | Standard gate, capability statement | v1 after provider approval | Pulse sequence already separates release timing from implementation scope. |
| Products, variants and stock | Manual form and three-product Free gate observed | v1 | Pulse owns commerce until a later external connector is attached. |
| Combos and offers | Tab and bundle description observed | Candidate later phase | No explicit v1 combo pricing rule in the brief. |
| Order capture and manual entry | Form, statuses, field editor observed | v1 | Use Pulse's confirmation-time revalidation, stock commitment and immutable order snapshot; map UI statuses deliberately. |
| Product CSV import | Import tab observed | v1 brief | Downstream mapping/error flow unobserved; design from Pulse needs, not assumed reference behavior. |
| AI training chat and test phone | Controls observed | v1 | Keep draft/test/publish separation and two-agent architecture from the brief. |
| Page-post training and image matching | Train Content description only | Later phase | v1 brief excludes image interpretation. |
| Voice notes, image understanding | AI Setup controls and integration copy | Later phase | v1 brief requires human fallback for unsupported media. |
| Analytics and chat summaries | Dashboard metrics; Standard previews | Basic tenant analytics v1; deeper insights later | Define event and metric contracts before reproducing chart labels. |
| Team roles and activity log | Settings/help statements; Standard gate | Roles/audit v1 for safe operations; richer team console later | Pulse's admin-agent authorization and audit decisions stand. |
| Billing and plan gates | Free balance, subscription prices and gates observed | Metering/ops v1; commercial tiers to decide | Do not copy Presswayy pricing. Pulse brief leaves prices open. |
| Shopify, WooCommerce, Custom Store, Nuport | Standard-gated cards and claims | v2 | External commerce authority supersedes Pulse's local catalog when connected, per brief. |
| Couriers and parcels | Standard-gated preview | Later phase | Fulfilment status is separate from order and payment status in Pulse. |
| Website widget | Standard-gated card | Phase 2 | Already excluded from v1. |
| AdsFlow, broadcasts and ad creative | Standard preview or Premium unavailable notice | Later phase | No internals verified; do not treat menu presence as a build-ready specification. |
| AI calls and recordings | Premium notice or Standard gate | Later phase | Telephony is outside the current v1 brief. |
| Support tickets and tutorials | UI observed | Product decision later | Could be handled operationally at launch without cloning the reference UI. |
| Sign-in, logout, security settings | Initial sign-in and settings UI observed; logout untested | v1 platform foundation | Specify session, recovery and tenant access based on Pulse security needs. |

## Existing Pulse decisions to preserve

The brief decides: separate customer/admin agents; backend role enforcement; confirmation and diff for every admin-agent write; external commerce authority after connector setup; live price/stock revalidation before order confirmation; a short message-coalescing window; human escalation for unsupported media; model-agnostic evaluation for Bangla/Banglish; predictable subscription tiers with granular internal metering; a distinct order lifecycle with payment/fulfilment separated; confirmation-time inventory commitment; and explicit human-to-AI hand-back. These are Pulse requirements even where Presswayy behaves differently or cannot be observed.

## Highest-value next evidence

1. Connect a test Facebook or Instagram asset and inspect one incoming message, human reply, AI reply, comment and handoff.
2. Create disposable product and order records to verify validation, persistence, status transitions and metrics.
3. Inspect training draft, test and publish with disposable content.
4. Use Standard access to validate currently gated screens before turning inferred premium flows into implementation requirements.
