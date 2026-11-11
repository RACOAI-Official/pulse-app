# Owner onboarding and self-serve channel connect

## Flow
Sign-up (email code) → `/onboarding`:

1. **Business**: `POST /tenants/{id}/onboarding/business` renames the tenant and syncs `agent_configs.draft.business_name`.
2. **AI setup**: the shared `AgentEditor` (`variant="onboarding"`) is shown with save and the private test phone. Publishing stays on `/agent`.
3. **Delivery**: `PUT /tenants/{id}/delivery` saves to `delivery_settings`, which holds:
   - the inside and outside Dhaka fee and days;
   - COD;
   - the free-delivery threshold;
   - notes.
4. **Plan**:
   - **Free** = the 7-day trial. `POST .../onboarding/free` finishes onboarding and opens `/dashboard`.
   - **Pro** = checkout with `return_to: "onboarding"`. The gateway returns to `/onboarding?return=...`, which polls `GET .../onboarding/flow` until `paid` is true.
5. **Integrations** (paid only): Messenger, Instagram and WhatsApp OAuth, plus the optional Pathao credentials.
6. **Inbox intro** → `POST .../onboarding/complete` → `/dashboard`.

State lives in `tenants.onboarding_step` and `onboarding_completed_at` (migration `20261112000100_phase_10_onboarding.sql`). Existing tenants are backfilled to `done`. `WorkspaceShell` sends owners of unfinished tenants to `/onboarding`; non-owners see a "setup in progress" panel.

`integrations`/`inbox` steps, all OAuth connect routes and Pathao credential saves require an **active paid plan** (`billing.require_paid`); the trial is not enough.

## Delivery fees on orders
The AI prompt gets the zones as `BUSINESS CONFIG.delivery`, and the order marker now includes `delivery_zone`. After `pulse_agent_create_order`, the worker calls `pulse_agent_apply_delivery_zone`, which re-prices the draft order with the zone fee and waives it at or above the threshold. With no `delivery_settings` row, the per-product fee stays.

## Meta app setup (required before connect works)

### Environment (API)
```
META_APP_ID=...                 # Facebook app ID
META_APP_SECRET=...             # already required (webhook signatures + OAuth)
META_LOGIN_CONFIG_ID=...        # optional: Facebook Login for Business configuration
META_WHATSAPP_CONFIG_ID=...     # WhatsApp Embedded Signup configuration ID
INSTAGRAM_APP_ID=...            # Instagram app ID (Instagram API with Instagram Login)
INSTAGRAM_APP_SECRET=...        # already used for Instagram webhooks
PULSE_API_PUBLIC_URL=https://api.example.com
PULSE_CREDENTIAL_KEY=...        # Fernet key, already required
```

### Valid OAuth redirect URIs
- Facebook Login: `{PULSE_API_PUBLIC_URL}/oauth/meta/callback`
- Instagram Login: `{PULSE_API_PUBLIC_URL}/oauth/instagram/callback`
- Facebook JS SDK (WhatsApp Embedded Signup): add the web origin (`PULSE_WEB_ORIGIN`) to **Allowed Domains for the JavaScript SDK**. HTTPS is required.

### Permissions (Advanced Access needs App Review)
- Messenger: `pages_show_list`, `pages_messaging`, `pages_manage_metadata`, `business_management`
- Instagram: `instagram_business_basic`, `instagram_business_manage_messages`, `instagram_business_manage_comments`
- WhatsApp: `whatsapp_business_management`, `whatsapp_business_messaging`

Until App Review passes, only people with a role on the Meta app (admins, developers and testers) can connect.

### What connect does
- **Messenger**:
  1. The code is exchanged for a long-lived user token.
  2. `/me/accounts` lists the Pages, and the owner picks which ones to connect.
  3. Each picked Page is subscribed (`subscribed_apps`: messages, postbacks, feed) and its non-expiring Page token is stored encrypted.
- **Instagram**:
  1. The code is exchanged for a short-lived token, then a long-lived 60-day token.
  2. The account is subscribed to messages and comments.
  3. Celery beat (`pulse.refresh_instagram_tokens`, daily) refreshes tokens that expire within 7 days.
- **WhatsApp**:
  1. Embedded Signup returns `code`, `waba_id` and `phone_number_id`.
  2. The code is exchanged for a business token and the WABA is subscribed.
  3. The number is stored with its `phone_number_id` as `external_account_id`. New numbers may still need registering (`POST /{phone_number_id}/register`) in WhatsApp Manager.
- An account already linked to another Pulse workspace is refused with a 409.
- Disconnect sets `status='disconnected'`, and webhooks then ignore that account.
