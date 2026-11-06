# Courier handoff and returns — design

Date: 2026-11-06

## Goal

Courier delivery is optional and courier-agnostic. An owner or manager can hand a
confirmed order to any courier manually, with or without a Pathao connection, and
Pulse keeps a record of every returned parcel and what it cost the business.

## Decisions

- Couriers are a fixed list plus Other: `pathao`, `steadfast`, `redx`, `paperfly`,
  `ecourier`, `sundarban`, `own_rider`, `other` (with a typed name).
- Every courier, Pathao included, uses manual handoff. The Pathao credential screen
  stays optional; automatic Pathao API booking is a later follow-up.
- Return loss = delivery fee paid + owner-typed damaged-goods loss. Order total is
  reported separately as sale value lost.
- Recording a return cancels the order ("Courier return") and restocks every unit
  except the damaged quantity the owner marks.
- The report is a "Courier returns" section on Analytics.

## Data

`commerce_shipments` (one per order): `provider` holds the courier code,
`courier_name` names an Other courier, plus `delivery_fee_minor`, `returned_at`,
`return_note`, `damage_loss_minor`. `commerce_shipment_return_items` records damaged
quantity per order item. Both are tenant-scoped with member read access only.

## Flow

1. Hand off (confirmed or processing order): courier, optional tracking/consignment,
   optional delivery fee. COD is computed from the unpaid balance. Details can be
   edited until the parcel is delivered or returned.
2. Status: picked up, in transit, delivered, failed, review. Delivered is final.
3. Record return (any state except delivered/returned): damaged items and quantities,
   damage loss amount, optional final delivery fee and note. Shipment becomes
   returned, order is cancelled, non-damaged stock is restored.

All writes are security-definer database functions gated by `pulse_admin_allowed`.

## Report

`pulse_courier_returns_report(tenant, days)` over parcels handed off in the period:
per courier — handoffs, delivered, returned, return rate, delivery fees lost, damage
loss, cash loss, sale value lost; plus a list of returned parcels with damaged items.

## API

- `GET /tenants/{t}/commerce/orders/{o}/shipment`
- `POST /tenants/{t}/commerce/orders/{o}/shipment` (handoff / edit)
- `POST /tenants/{t}/commerce/orders/{o}/shipment/status`
- `POST /tenants/{t}/commerce/orders/{o}/shipment/return`
- `GET /tenants/{t}/analytics/courier-returns?days=7|30|90`

The earlier `/integrations/pathao/orders/*` routes are removed; credential routes stay.

## Testing

Rollback-only SQL flow (handoff, status, partial-damage return, stock, cancel, report
totals, cross-tenant denial), pytest for route validation, web type-check.
