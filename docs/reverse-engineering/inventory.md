# Feature and route inventory

All paths below are relative to `https://app.presswayy.com`. **Observed** means the route or control was opened in the signed-in Free-plan session unless another label is shown. Plan prices and limits are snapshots, not Pulse pricing decisions.

## Global shell and access

| Area | Route or control | Visible behavior and subdivisions | Evidence |
| --- | --- | --- | --- |
| Public entry | `/` when signed out | Marketing page, business-name onboarding entry, pricing comparison, Sign in, language switch, Terms, Privacy. | Observed |
| Sign in | `/login` | Phone number by default; switch to email; Continue. Phone view displayed a Cloudflare challenge. The later credential or OTP step was not reached. | Observed |
| Dashboard shell | All signed-in pages | Collapsible sidebar; Dashboard, Inbox, Integrations, Sales, Calls, Marketing, AI Training, Insights, Account, Help; business selector; English/Bangla; Settings; Logout; phone preview button. | Observed |
| Logout | Sidebar button | Control exists. Post-click redirect and session invalidation were not exercised. | Observed control; outcome unknown |
| Business selector | Top bar | Current business shown; multiple-business behavior was not tested. | Observed control; outcome unknown |

## Dashboard, Inbox, and integrations

| Area | Route or control | Visible behavior and subdivisions | Evidence |
| --- | --- | --- | --- |
| Dashboard | `/` signed in | Five-step AI setup guide; wallet balance and AI on/off/schedule; today’s sales, customers, orders; chat performance; connected channels; business snapshot; monthly reply breakdown; top customers/products; message and order charts. Current account has empty metrics and unconnected channels. | Observed |
| Inbox | `/omnichat` | Messages, Orders, Unreplied, Tickets, Comments tabs; All/Facebook/Instagram/WhatsApp/Web/Voice filters; search; conversation list and detail pane. No conversations available. A Facebook-connect prompt appeared. | Observed |
| Inbox message/comment behavior | `/support` FAQ | Private messages and public post comments share the inbox but have separate tabs; a comment reply is described as public on the original post. Bot/manual mode can be switched per conversation. | Stated |
| Integrations catalog | `/integrations` | Cards for Facebook, Instagram, WhatsApp, Shopify, WordPress/WooCommerce, Custom Store, Google Sheets, Steadfast, Pathao, Nuport, Website Chatbot. Free plan advertises one Facebook or Instagram channel; the other cards show Standard gates. | Observed |
| Facebook | `/integrations/facebook` | Messenger and page comments; connection-status check and setup-guide entry. A completed OAuth flow was not observed. | Observed |
| Instagram | `/integrations/instagram` | DM and comments; connection-status check. FAQ says a Professional account linked to a Facebook Page is needed. | Observed; requirement stated |
| WhatsApp | `/integrations/whatsapp` | Business number, chats, media and templates described; Standard upgrade gate. | Observed gate; capability stated |
| Commerce connectors | `/integrations/shopify`, `/integrations/wordpress`, `/integrations/custom-store`, `/integrations/nuport` | Shopify and WooCommerce advertise two-way product, inventory, order sync; Custom Store advertises SDK/REST sync; Nuport advertises price/stock sync. All detail pages show Standard upgrade gates. | Observed gates; sync stated |
| Other connectors | `/integrations/google-sheets`, `/integrations/steadfast`, `/integrations/pathao`, `/integrations/website-chatbot` | Sheets activity-log export, courier booking/tracking/invoices, and website widget are described. All detail pages show Standard upgrade gates. | Observed gates; capability stated |

## Sales, Calls, Marketing, and AI Training

| Area | Route or control | Visible behavior and subdivisions | Evidence |
| --- | --- | --- | --- |
| Sales → Orders | `/orders` | Date presets and custom range; metrics; View orders, In Progress, Order fields; channel filters; status filter, sort, search; Add order. Export is Standard gated; Free page says last seven days. | Observed |
| Orders → Order fields | `/orders` tab | New field: unique lowercase key, customer-facing question, text/number input, validation type, required flag. Existing fields are read-only in current UI. | Observed |
| Orders → Add order | `/orders` dialog | Customer name, phone, address, catalog or custom items, discount, delivery charge, totals, payment method, paid amount, status, remarks. Submission was not performed. | Observed |
| Sales → Products | `/products` | Products and Combos & Offers tabs; search and add. Free plan shows a three-product limit. Add products has manual, WordPress, and CSV tabs. | Observed |
| Products → manual entry | `/products` dialog | Title, category, description, media, attachments, variants, optional own delivery charge, SKU, regular/offer price, stock. No product was saved. | Observed |
| Products → Combos & Offers | `/products` tab | Search and Add combo; bundle pricing described. Creation details not opened. | Observed; quote behavior stated |
| Sales → Parcels | `/parcels` | Total, in transit, delivered, returned, and parcel list preview. Standard gate. | Observed gate |
| Calls → AI Calls | Sidebar button | Premium notice says the plan is not available for sale. No functional route. | Observed gate |
| Calls → Recordings | `/call-recordings` | Call recording/history described; Standard gate. | Observed gate |
| Marketing → AdsFlow | `/live-campaigns` | Ad spend, messages, orders, sales, and campaigns preview; Standard gate. | Observed gate |
| Marketing → Creative Studio, Ad Launcher, Broadcast | Sidebar buttons | Each opens a Premium feature notice; the Premium plan was described as not available. | Observed gates |
| AI Training → AI Setup | `/test-arena` | Training chat, five setup steps, test phone, photo/voice controls, Rulebook, Share, live-status control, tutorial and expert help. Training input and phone reply were not submitted. | Observed |
| AI Training → Train Content | `/content` | Page posts, photos, videos/reels, and product attachment described. The observed account displayed the introductory text without usable content controls. | Observed; capability stated |

## Insights, Account, and Help

| Area | Route or control | Visible behavior and subdivisions | Evidence |
| --- | --- | --- | --- |
| Insights → Analytics | `/analytics` | Sales/conversation insights, timing by day/hour, usage/cost preview; Standard gate. | Observed gate |
| Insights → Performance | `/team-performance` | Team replies, response times, chats handled and member preview; Standard gate. | Observed gate |
| Insights → Activity Log | `/activity-log` | Account logins and changes described; Standard gate. | Observed gate |
| Insights → Chat Summary | `/chat-summary` | Conversation summary and next-action preview; Standard gate. | Observed gate |
| Account → Billing | `/billing` | Free-plan balance, recharge, subscription options and transaction-history tabs. At observation: Standard monthly ৳3,000 and yearly ৳29,500; payment flow was not entered. | Observed |
| Account → Settings: Profile | `/settings` | Contact name, phone, business type, appearance, team-members gate, account deletion control. No settings were changed. | Observed |
| Settings: Security | `/settings` tab | Current-password verification before new password; team-members gate. | Observed |
| Settings: Voice & Calling, AI Follow-up, Comments | `/settings` tabs | Each describes its capability and shows Standard upgrade. | Observed gates |
| Settings: AI Behavior | `/settings` tab | Chat Summary toggle description; summary after five quiet minutes and wallet charge stated. AI Reply Limit description and loading/disabled control seen. | Observed; timing stated |
| Settings: Notifications | `/settings` tab | Tab exists; content showed loading during inspection. Final controls unknown. | Observed tab; details unknown |
| Help → Tutorials | `/tutorials` | One visible video tutorial, “How to train Presswayy AI.” | Observed |
| Help → Support | `/support` | Support contact information, ticket list/New ticket, supported-feature summary, eight FAQ questions. Ticket creation was not submitted. | Observed |

## Gated-feature planning hypotheses

These are **inferences for Pulse**, not verified Presswayy behavior: a parcel workflow would need courier booking, tracking-event reconciliation and label/invoice handling; AdsFlow would need ad-attribution joins across conversations and orders; Broadcast would need audience selection, templates, opt-out and delivery status; AI Calls would need telephony provisioning, call routing, transcripts/recordings and consent rules; store connectors would need authority and conflict handling. Treat these as candidate requirements until access or independent product evidence verifies them.
