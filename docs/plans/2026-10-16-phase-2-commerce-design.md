# Pulse Phase 2 commerce design

Approved 2026-10-16 for implementation on `dev/init`. Phase 2 in the build sequence is the local commerce module: catalog, variants, stock, CSV and manual orders. The website widget, bundles, custom order lines, chatbot order fields, AI and external commerce connectors are later work. Local Supabase and browser verification are the acceptance environment; staging needs separate infrastructure.

## Evidence and boundary

Authenticated REA observations: dashboard `ev_bfecc6810aa232ee569c2004281c11e2ff91b0eba861b8517dcc4e6668916e05`, products `ev_0cecf0e053634f0a82b5513e5daeebc62427ed0eda35c41311a83da2ab76bd47`, orders `ev_70ff48be0917ecff927b2d92e151d98f31bd9f1cd89c21e355d6552a9ee029ab`, inbox `ev_f8275028b68eddf0e193b9037ef96b29df2ee0e16823c38b945d943c30ee185c`, integrations `ev_549d2e8267f46c26dc6434b94d17787a24466400c5c47dc2c7f5ca70a0a4a985`, training content `ev_25ca2efde070bc226fbda165e83b260ec7d5631a59455ceedac37463249606bf`. These establish visible UI and routes, not Presswayy persistence or server contracts. The account had no products or orders; no write was submitted.

## Domain rules

- Owner and staff can manage commerce. Tenant currency is selected from BDT, USD, EUR, GBP before commerce data exists, then locked. Amounts are exact integer minor units with no conversion.
- Local products retain provenance fields for later external authority. A simple product has one default variant; configurable products have option-value combinations. Each sellable variant has a unique tenant SKU, price and stock. Image-free drafts are allowed; activation requires an uploaded image or validated HTTPS image URL.
- Stock changes are audited. Unreferenced products can be deleted after confirmation; referenced products are archived and restorable.
- CSV preview validates all rows and returns errors. Commit revalidates the file and imports all rows in one database transaction. One row represents one variant under a product grouping key.
- Manual catalog orders follow Draft → Pending Confirmation → Confirmed → Processing → Completed; cancellation exits before completion. Draft/pending do not reserve stock. Confirmation atomically rechecks price and availability, commits stock and immutable item-price snapshots. Cancellation restores committed units exactly once. Price/stock conflicts keep the order unconfirmed for review.
- Payment method and amounts are recorded separately. Cancelling a paid order keeps payment history and flags refund due; Pulse does not transfer money.

## Implementation shape

Keep Next.js/FastAPI/Supabase. Add tenant-scoped Catalog and Orders screens and API operations. Use RLS and narrowly scoped database functions for state transitions and concurrent stock changes. Store uploaded catalog media in Supabase Storage; CSV HTTPS image references stay external. Add local integration and browser checks, then commit schema, API, UI and verification milestones on `dev/init`.
