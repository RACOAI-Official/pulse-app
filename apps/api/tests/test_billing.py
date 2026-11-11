import hashlib
import hmac
import json
import time
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from uuid import UUID

import httpx
import pytest
from fastapi import HTTPException

from pulse_api import billing, main

TENANT = "00000000-0000-0000-0000-000000000001"
NOW = datetime(2026, 11, 11, tzinfo=timezone.utc)


def iso(value: datetime) -> str:
    return value.isoformat()


@pytest.mark.asyncio
async def test_expired_business_cannot_write_but_can_open_plan(monkeypatch):
    async def member(*_):
        return {"role": "owner"}

    monkeypatch.setattr(main, "membership", member)
    monkeypatch.setattr(billing, "has_access", lambda _: False)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app), base_url="http://test") as client:
        denied = await client.post(f"/tenants/{TENANT}/commerce/media",
                                   headers={"authorization": "Bearer valid"}, content=b"image")
        # The gate skips billing routes; the route itself then asks for a session (401, not 402).
        plan_checkout = await client.post(f"/tenants/{TENANT}/billing/checkout", json={})
    assert denied.status_code == 402
    assert plan_checkout.status_code != 402


def test_price_matrix_defaults_give_two_months_free_yearly():
    for plan in billing.PLANS:
        for currency in billing.CURRENCIES:
            assert billing.price(plan, "year", currency) == billing.price(plan, "month", currency) * 10
    assert billing.price("pro", "month", "USD") == 3000
    assert billing.price("enterprise", "month", "GBP") == 8000
    assert billing.price("pro", "month", "BDT") == 350000
    assert billing.allowance("pro") == 4000 and billing.allowance("enterprise") == 15000


def test_currency_picks_gateway():
    assert billing.provider_for("BDT") == "sslcommerz"
    assert billing.provider_for("USD") == "stripe"
    assert billing.provider_for("GBP") == "stripe"


def test_upgrade_quote_is_prorated_and_rounded_up():
    current = {"billing_interval": "month", "currency_code": "BDT",
               "term_start": iso(NOW - timedelta(days=15)), "paid_through": iso(NOW + timedelta(days=15))}
    # Half the term left: (12000 - 3500) / 2 = 4250 taka.
    assert billing.upgrade_quote(current, NOW) == 425000
    current["paid_through"] = iso(NOW + timedelta(days=10))
    current["term_start"] = iso(NOW - timedelta(days=20))
    # A third left: 8500 / 3 = 2833.33 -> 2834 taka.
    assert billing.upgrade_quote(current, NOW) == 283400
    current["paid_through"] = iso(NOW - timedelta(seconds=1))
    assert billing.upgrade_quote(current, NOW) == 0


def test_yearly_ssl_period_and_early_renewal_start():
    checkout = {"kind": "purchase", "billing_interval": "year"}
    start, end = billing.ssl_period(checkout, None, NOW)
    assert start == NOW and end == NOW.replace(year=2027)
    paid_through = NOW + timedelta(days=3)
    start, end = billing.ssl_period({"kind": "purchase", "billing_interval": "month"},
                                    {"state": "active", "paid_through": iso(paid_through)}, NOW)
    assert start == paid_through and end == paid_through.replace(month=12)


def test_ssl_upgrade_period_keeps_term_end():
    paid_through = NOW + timedelta(days=9)
    start, end = billing.ssl_period({"kind": "upgrade", "billing_interval": "month"},
                                    {"state": "active", "paid_through": iso(paid_through)}, NOW)
    assert (start, end) == (NOW, paid_through)
    with pytest.raises(HTTPException):
        billing.ssl_period({"kind": "upgrade", "billing_interval": "month"},
                           {"state": "active", "paid_through": iso(NOW - timedelta(days=1))}, NOW)


def test_stripe_signature_rejects_tampering(monkeypatch):
    monkeypatch.setattr(billing, "get_settings", lambda: SimpleNamespace(
        pulse_stripe_webhook_secret="whsec_test"))
    payload = json.dumps({"id": "evt_1", "type": "test"}).encode()
    timestamp = int(time.time())
    signature = hmac.new(b"whsec_test", f"{timestamp}.".encode() + payload, hashlib.sha256).hexdigest()
    header = f"t={timestamp},v1={signature}"
    assert billing.verify_stripe_event(payload, header)["id"] == "evt_1"
    with pytest.raises(HTTPException) as error:
        billing.verify_stripe_event(payload + b" ", header)
    assert error.value.status_code == 400


def test_unpaid_stripe_invoice_never_settles(monkeypatch):
    monkeypatch.setattr(billing, "stripe", lambda *_args, **_kwargs: (_ for _ in ()).throw(
        AssertionError("Provider should not be called")))
    billing.stripe_subscription_paid({"status": "open", "amount_paid": 3000})


def _paid_invoice_setup(monkeypatch, meta, checkout):
    calls = []
    monkeypatch.setattr(billing, "stripe", lambda method, path, **_kwargs: {
        "id": "sub_test", "customer": "cus_test", "metadata": meta, "cancel_at_period_end": False})
    monkeypatch.setattr(billing, "account", lambda _: {"stripe_customer_id": "cus_test"})

    def rows(table, **_kwargs):
        if table == "billing_invoices":
            return []
        if table == "billing_checkouts":
            return [checkout]
        raise AssertionError(table)

    monkeypatch.setattr(billing, "rows", rows)
    monkeypatch.setattr(billing, "settle", lambda row, invoice, transaction, start, end: calls.append(
        (row["id"], invoice, start.timestamp(), end.timestamp())))
    monkeypatch.setattr(billing, "service_request", lambda *_args, **_kwargs: None)
    return calls


def test_paid_gbp_yearly_invoice_uses_invoiced_period(monkeypatch):
    checkout = {"id": "checkout", "tenant_id": TENANT, "plan_key": "pro", "provider": "stripe",
                "kind": "purchase", "state": "pending", "amount_minor": 25000}
    calls = _paid_invoice_setup(monkeypatch, {"tenant_id": TENANT, "plan_key": "pro", "interval": "year",
                                              "checkout_id": "checkout", "auto_renew": "true"}, checkout)
    billing.stripe_subscription_paid({"id": "in_test", "status": "paid", "amount_paid": 25000,
        "currency": "gbp", "customer": "cus_test", "subscription": "sub_test", "billing_reason": "subscription_create",
        "lines": {"data": [{"amount": 25000, "period": {"start": 1700000000, "end": 1731536000}}]}})
    assert calls == [("checkout", "in_test", 1700000000, 1731536000)]


def test_stripe_invoice_with_wrong_amount_is_rejected(monkeypatch):
    _paid_invoice_setup(monkeypatch, {"tenant_id": TENANT, "plan_key": "enterprise", "interval": "month"}, {})
    with pytest.raises(HTTPException) as error:
        billing.stripe_subscription_paid({"id": "in_test", "status": "paid", "amount_paid": 3000,
            "currency": "usd", "customer": "cus_test", "subscription": "sub_test"})
    assert error.value.status_code == 422


def test_stripe_bdt_invoice_is_rejected(monkeypatch):
    _paid_invoice_setup(monkeypatch, {"tenant_id": TENANT, "plan_key": "pro", "interval": "month"}, {})
    with pytest.raises(HTTPException):
        billing.stripe_subscription_paid({"id": "in_test", "status": "paid", "amount_paid": 350000,
            "currency": "bdt", "customer": "cus_test", "subscription": "sub_test"})


def test_stripe_upgrade_invoice_settles_enterprise_until_term_end(monkeypatch):
    paid_through = datetime.now(timezone.utc) + timedelta(days=12)
    current = {"stripe_customer_id": "cus_test", "stripe_subscription_id": "sub_test",
               "paid_through": iso(paid_through), "billing_interval": "month", "auto_renew": True}
    created, settled = [], []
    monkeypatch.setattr(billing, "account", lambda _: current)
    monkeypatch.setattr(billing, "rows", lambda *_a, **_k: [])
    monkeypatch.setattr(billing, "create_checkout", lambda tenant, **kw: created.append(kw) or {"id": "up", **kw})
    monkeypatch.setattr(billing, "settle", lambda row, invoice, txn, start, end: settled.append((row["kind"], invoice, end)))
    billing.stripe_upgrade_paid({"id": "in_up", "status": "paid", "billing_reason": "subscription_update",
                                 "currency": "usd", "amount_paid": 2800},
                                {"id": "sub_test", "customer": "cus_test",
                                 "metadata": {"tenant_id": TENANT, "plan_key": "enterprise"}})
    assert created[0]["plan"] == "enterprise" and created[0]["amount"] == 2800 and created[0]["kind"] == "upgrade"
    assert settled == [("upgrade", "in_up", paid_through)]


@pytest.mark.asyncio
async def test_checkout_requires_policy_consent(monkeypatch):
    async def owner(*_):
        return {"role": "owner"}

    monkeypatch.setattr(billing, "owner", owner)
    monkeypatch.setattr(billing, "providers", lambda: {"stripe": True, "sslcommerz": True})
    with pytest.raises(HTTPException) as error:
        await billing.checkout(UUID(TENANT), billing.CheckoutInput(plan="pro", currency="GBP"),
                               ("user", {"email": "owner@example.com"}))
    assert error.value.status_code == 422


@pytest.mark.asyncio
async def test_checkout_blocks_new_purchase_while_plan_active(monkeypatch):
    async def owner(*_):
        return {"role": "owner"}

    active = {"state": "active", "provider": "stripe", "plan_key": "pro",
              "paid_through": iso(datetime.now(timezone.utc) + timedelta(days=20))}
    monkeypatch.setattr(billing, "owner", owner)
    monkeypatch.setattr(billing, "providers", lambda: {"stripe": True, "sslcommerz": True})
    monkeypatch.setattr(billing, "account", lambda _: active)
    with pytest.raises(HTTPException) as error:
        await billing.checkout(UUID(TENANT), billing.CheckoutInput(plan="enterprise", currency="USD",
                               accepted_policies=True), ("user", {"email": "owner@example.com"}))
    assert error.value.status_code == 409


@pytest.mark.asyncio
async def test_ssl_downgrade_is_scheduled_for_renewal(monkeypatch):
    async def owner(*_):
        return {"role": "owner"}

    patches = []
    paid_through = iso(datetime.now(timezone.utc) + timedelta(days=20))
    monkeypatch.setattr(billing, "owner", owner)
    monkeypatch.setattr(billing, "account", lambda _: {"state": "active", "provider": "sslcommerz",
        "plan_key": "enterprise", "paid_through": paid_through})
    monkeypatch.setattr(billing, "service_request", lambda method, table, **kw: patches.append((method, table, kw["body"])))
    result = await billing.downgrade(UUID(TENANT), ("user", {}))
    assert result == {"status": "scheduled", "effective_at": paid_through}
    assert patches == [("PATCH", "billing_accounts", {"pending_plan_key": "pro"})]


@pytest.mark.asyncio
async def test_upgrade_requires_active_pro(monkeypatch):
    async def owner(*_):
        return {"role": "owner"}

    monkeypatch.setattr(billing, "owner", owner)
    monkeypatch.setattr(billing, "account", lambda _: {"state": "trialing", "plan_key": None})
    with pytest.raises(HTTPException) as error:
        await billing.upgrade(UUID(TENANT), ("user", {}))
    assert error.value.status_code == 409
