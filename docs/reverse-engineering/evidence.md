# Evidence log and limits

## Sources and method

| ID | Source | What it supports | Limit |
| --- | --- | --- | --- |
| B1 | [Signed-in dashboard](https://app.presswayy.com/) and sidebar | Navigation tree, dashboard controls, business context and logout control. | Free-plan account; current business has no channel or conversation data. |
| B2 | [Inbox](https://app.presswayy.com/omnichat) | Tabs, channel filters, empty state, connection prompt. | No conversation detail or message send could be inspected. |
| B3 | [Integrations](https://app.presswayy.com/integrations) and its eleven detail routes | Provider catalog, visible connection checks, and Standard gates. | OAuth/configuration and actual sync not exercised. |
| B4 | [Orders](https://app.presswayy.com/orders), [Products](https://app.presswayy.com/products), [Parcels](https://app.presswayy.com/parcels) | Filters, field editor, manual-order and product forms, offers tab, courier preview. | No writes, imports, bookings or populated records. |
| B5 | [AI Setup](https://app.presswayy.com/test-arena), [Train Content](https://app.presswayy.com/content) | Training/test controls, setup guide and content description. | No training message, published version, or test response captured. |
| B6 | [Calls](https://app.presswayy.com/call-recordings), [Marketing](https://app.presswayy.com/live-campaigns), and [Insights](https://app.presswayy.com/analytics) | Recording, AdsFlow and analytics preview gates; other menu items produced Premium notices. | Premium and Standard internals remain unknown. |
| B7 | [Billing](https://app.presswayy.com/billing), [Settings](https://app.presswayy.com/settings), [Tutorials](https://app.presswayy.com/tutorials), [Support](https://app.presswayy.com/support) | Account tabs, billing offer, security UI, support FAQ and ticket entry. | No payment, password change, ticket or account mutation. |
| B8 | [Public sign-in](https://app.presswayy.com/login) | Phone/email modes and initial challenge. | Credential, OTP, successful login and logout transitions not exercised. |
| R1 | [REA source repository](https://github.com/morluto/rea) and [browser guide](https://rea.tools/guides/browser/) | REA's CDP target discovery and passive page inspection method. | Tool capability is not evidence of Presswayy backend behavior. |
| P1 | [Pulse project brief](../../Pulse-documentation.md) | Existing v1 and eleven Pulse product decisions. | Pulse intent, not Presswayy evidence. |

## REA execution record

REA `rea-agents@6.4.0` was run via `npx` against a separate headless Chrome 155 profile on a local debugging port. `list-browser-targets` found the public `https://app.presswayy.com/login` target (evidence ID `ev_5f3cd334404a2e11dc1d6db8b0138bccf462f8fa487a6f5e7ca185b7c78d22db`). `inspect-web-page` confirmed that target, its DOM/accessibility structure and same-origin script metadata (one bundled application script was reported; evidence ID `ev_de0bfddef0acfc9a3b4f319474e8bbc265466a63ad5ef54e02815332ccc6934d`). Raw script text, cookies and storage values are not stored in this repository.

The passive capture began after page load, so it saw no prior network requests. A reload during a longer capture returned a browser-observation error; therefore no Presswayy API route, request body, response shape, authentication mechanism or internal data model is asserted from REA. REA was used as requested, but its present evidence is limited to the public login page. The authenticated route inventory above comes from the existing browser extension session.

On 2026-10-14, the official REA 6.4.0 setup configured Codex MCP and installed its matching workflow skill. The setup dry run showed a backup of `~/.codex/config.toml`; setup then reported both actions applied and its doctor marked the Codex registration and skill healthy. A separate Chrome 155 debugging profile was launched on loopback port 9222, and `list-browser-targets` connected successfully (evidence ID `ev_541fdd8303c77a5f0688f1a329c53f3d2891291581f82f6409114fef75aed0ee`). The target page `https://app.presswayy.com/login` was opened afterward. The current agent session must restart to expose the new REA MCP tools; the same official REA CLI remains available meanwhile. An authenticated capture still requires signing in to that separate profile.

## Evidence rules for future passes

- Record source URL, account tier, date, action and resulting state for each observation. A visible label is evidence of a control, not proof that it works.
- Capture network behavior only in an authorized session, with targeted actions. Keep request paths and value-free JSON shapes; exclude cookies, tokens, customer messages, phone numbers and raw response bodies.
- Use a connected test business and disposable sample data for write-flow verification. Record before/after state, error cases and cleanup separately.
- Revisit all **unknown** and **inferred** entries with a Standard account or authoritative product material before claiming behavioral parity.
