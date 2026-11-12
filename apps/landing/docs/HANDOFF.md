# Pulse Website 2.0 — handoff notes

Context for whoever (person or AI assistant) picks this branch up next.

## Where things stand

- Branch `pulse-website-2.0` holds the full rebuild; `main` is the old creative-agency template.
- Tag `checkpoint/pre-pulse-2.0` marks the old site (commit `bda9033`).
- Stack is unchanged: Next.js 16, React 19, Tailwind CSS v4, framer-motion. No GSAP (the old GSAP files were never loaded and were removed).
- `npm run build`, `npx tsc --noEmit` and `npm run lint` all pass.

## Where to edit what

| What | Where |
| --- | --- |
| All copy, links, demo data | `content/pulse.ts` (components read from it; avoid hard-coding text) |
| Verified destinations | `LINKS` in `content/pulse.ts` |
| Brand mark (traced from the supplied logo) | `components/ui/PulseMark.tsx`, `public/brand-mark.svg`, `app/icon.svg` |
| Product UI reconstructions | `components/ui/mocks.tsx` |
| Colours, gradients, focus styles | `app/globals.css` (`@theme` tokens, `.bg-mesh-*`, `.hero-top-shade`) |

## Homepage, top to bottom

1. **Hero** (`components/home/Hero.tsx`): dark green shade at the top; headline + one line of copy above a giant PULSE wordmark. On scroll the camera zooms into the "U" and the dashboard grows out of it, then the conversation plays (question, AI reply with product card, order draft), floating cards arc in, and only then the CTAs (Request beta access / See how it works) fade in. Timings live in the `T` object at the top of the file.
2. **What is Pulse** (`IntroReveal.tsx`): three-beat headline with live UI chips; then `FragmentStrips.tsx` (two marquee rows of "chaos"); then `Convergence.tsx` (pinned: fragments snap into a workspace while problems get crossed off).
3. **Product showcase** (`ProductShowcase.tsx`): five accessible tabs (Inbox, AI Setup, Catalog, Orders, Analytics). Arrow keys work; the nav "Features" dropdown deep-links to a tab.
4. **How it works** (`OrderWorkflow.tsx`): four stacked cards following order #PL-1042. Step 1 is a bottle-green card with the Pulse mark; steps 1–2 carry an "Instant response" badge. No progress bar or step numbers (removed on request).
5. **Use cases** (`UseCases.tsx`): hover preview follows the cursor on desktop; tap / Enter expands an inline preview.
6. **Closing CTA** (`ClosingCTA.tsx`) with the Pulse mark, then **Beta status** (`BetaStatus.tsx`) and the footer.

Header (`Navbar.tsx`): desktop has the Pulse mark in the centre of the nav pill and "Try Pulse" on the right; the header turns white-on-dark while the hero's dark shade is behind it. "Sign in" lives only in the footer.

## Decisions to keep

- Only beta features are shown as available; unfinished modules (AI Calls, Recordings, Broadcast, Chat Summary, AdsFlow, Creative Studio, Ad Launcher) are listed under "In development".
- All people, products, prices and orders are fictional demo data (customer Nadia Rahman, merchant "Nook & Thread", order #PL-1042, Tk 3,530). The footer says product visuals are illustrative.
- Prices use "Tk" (the taka glyph `৳` renders poorly with Inter). Change `CURRENCY` in `content/pulse.ts` if wanted.
- Links were checked to return HTTP 200: `pulse.racoai.io/signup` (Request access / Try Pulse), `pulse.racoai.io/login`, `racoai.io/contact` (Book a demo, Contact), `racoai.io/privacy-policy`, `racoai.io/terms`. `raco.ai` returned 502 and is not used.
- Animations respect `prefers-reduced-motion` (static versions of the pinned sections).

## Open items

- Real Pulse screenshots or recordings to replace the reconstructions (the dashboard needs a login).
- Licence check for the product photos in `public/media/products/` (they came from the old Styler Webflow template); the original pastel-sneaker photo was dropped because it showed a Nike logo.
- A dedicated demo-booking URL (currently the RACO AI contact page) and Pulse-specific privacy/terms pages.

## Static preview build (for hosts that serve from a sub-path)

`scripts/export-static.sh` builds a static copy into `.static-export/`. It also renames `_next` to `nxt`, because some hosts reserve paths starting with `_`. That rename must include the Turbopack runtime's `./_next/` chunk base, otherwise the page renders but no JavaScript runs.
