# Plan tab: subscriptions and AI credits — design

This document records the decisions agreed with the product owner on 2026-11-11. The implementation is described in `docs/implementation/platform-billing.md`.

## Decisions

| Topic | Decision |
| --- | --- |
| Base | Port the `dev/payment` billing (f5ff37c) and adapt it. Do not merge the branch. |
| Plans | Pro at $30/month and Enterprise at $100/month. Light and Plus are removed, and so is the "contact sales" option. |
| Prices | A fixed table per currency, with no live FX rates:<br>• Pro: £25 / ৳3,500 per month<br>• Enterprise: £80 / ৳12,000 per month |
| Yearly | 2 months free (10× the monthly price). Credits still reset monthly. |
| Gateway | BDT → SSLCOMMERZ (prepaid, renewal available in the last 7 days). USD and GBP → Stripe (auto-renew). |
| Default currency | Chosen from the browser's time zone and language. The owner can switch, and the choice is remembered in localStorage. |
| Credit unit | 1 credit = 1 AI auto-reply. Admin-agent intent calls are free. |
| Allowance | Pro gets 4,000 credits per month and Enterprise gets 15,000. Unused credits do not roll over. |
| Out of credits | The AI pauses and the team replies from the Inbox. Banners show at 80% and 100% use. |
| No plan | A 7-day trial with 200 credits and no card. After that, the access guards apply. |
| Upgrade | Takes effect immediately and is prorated. The term end date stays the same, and credits are topped up for the rest of the current cycle. |
| Downgrade | Takes effect at the next renewal. |
| Sidebar | "Billing" becomes "Plan" at `/plan`. `/billing` redirects there. |

## Credit sizing

The industry norm is to charge per outcome (per AI reply), not per token. AI cost should stay at or below about 30–40% of the plan price.

**Pro: a business handling 10–15 customers a day**
- Usage: 15 conversations/day × about 8 AI replies each × 30 days = about 3,600 replies a month.
- Adding about 10% headroom gives **4,000 credits**.

**Tokens per reply**
- Input is about 2,500 tokens: the system prompt, catalog facts, and the last 8 history turns.
- Output is up to about 200 tokens.
- That totals about 9.7M tokens a month.

**Model cost for that volume**
- A gpt-4o-mini-class model costs about $2.
- A Haiku-class model costs about $13 (43% of $30). This is the upper bound.
- The current self-hosted Qwen3 costs only the infrastructure.

**Enterprise**
- 15,000 credits covers about 60 conversations a day.
- The cost-to-price ratio stays similar at $100.

The allowances are set in config, so they can be tuned without a migration.
