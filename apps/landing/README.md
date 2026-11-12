# Pulse — marketing website (2.0 prototype)

Public marketing site for **Pulse**, the AI-powered social commerce workspace by
RACO AI Technologies. The product itself lives at <https://pulse.racoai.io>; this
repository is only the marketing frontend.

## Run it

```bash
npm ci
npm run dev        # http://localhost:3000
npm run build      # production build
npm run lint
```

## Structure

| Path | What it is |
| --- | --- |
| `content/pulse.ts` | **All copy, links and demo data.** Edit text here, not in components. |
| `components/home/*` | The six homepage sections, navigation, beta status and footer. |
| `components/ui/primitives.tsx` | Logo, CTA buttons, channel icons, AI tag, demo label. |
| `components/ui/mocks.tsx` | Illustrative reconstructions of the Pulse interface (inbox, AI setup, catalogue, orders, analytics). |
| `public/media/products/` | Optimised WebP product photos used as merchant demo products. |

## Homepage sections

1. **Hero** (`Hero.tsx`) — pinned 420vh scroll: wordmark → card expands into the workspace → message, AI reply, order draft → floating cards.
2. **From chaos to clarity** (`IntroReveal`, `FragmentStrips`, `Convergence`).
3. **Product showcase** (`ProductShowcase.tsx`) — five accessible tabs.
4. **How it works** (`OrderWorkflow.tsx`) — stacked cards following one order.
5. **Use cases** (`UseCases.tsx`) — hover previews on desktop, tap/Enter to expand everywhere.
6. **Closing CTA** (`ClosingCTA.tsx`) + **Beta status** (`BetaStatus.tsx`).

## Content rules

- All people, products, prices and orders are **fictional demo data**; visuals are labelled as illustrative.
- Only features available in the beta are presented as available. Unfinished modules are listed under "In development".
- Every link points to a verified destination (see `LINKS` in `content/pulse.ts`).
- Animations respect `prefers-reduced-motion`.

See [`docs/HANDOFF.md`](docs/HANDOFF.md) for context, decisions and open items.
