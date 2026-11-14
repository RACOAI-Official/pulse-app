import hashlib
import hmac
import json
from types import SimpleNamespace
from uuid import uuid4

import httpx
import pytest
from fastapi import HTTPException

from pulse_api import admin, billing, main, notification_delivery as delivery, notifications
from pulse_api.settings import get_settings

TENANT = "00000000-0000-0000-0000-000000000001"
OLD_ROW = {"plan_key": "pro", "billing_interval": "month", "currency_code": "USD",
           "amount_minor": 3500, "stripe_price_id": "price_new", "created_at": "2026-11-14T00:00:00Z"}


async def fake_session():
    return ("token", {"id": "user-1", "email": "op@example.com"})


@pytest.fixture
def client(monkeypatch):
    main.app.dependency_overrides[main.session] = fake_session

    async def no_limit(*_):
        return 0
    monkeypatch.setattr("pulse_api.ratelimit.retry_after", no_limit)
    monkeypatch.setattr(main, "retry_after", no_limit)
    billing.clear_price_cache()
    yield httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app), base_url="http://test")
    main.app.dependency_overrides.clear()
    billing.clear_price_cache()


# Prices -------------------------------------------------------------------------------------

def test_admin_price_overrides_default_and_stripe_id(monkeypatch):
    monkeypatch.setattr(billing, "live_prices", lambda fresh=False: {("pro", "month", "USD"): OLD_ROW})
    assert billing.price("pro", "month", "USD") == 3500
    assert billing.stripe_price_id("pro", "month", "USD") == "price_new"
    assert billing.price("pro", "month", "BDT") == billing.default_price("pro", "month", "BDT")


def _renewal(monkeypatch, sub_price: str):
    calls = []
    sub = {"id": "sub_test", "customer": "cus_test", "cancel_at_period_end": False,
           "metadata": {"tenant_id": TENANT, "plan_key": "pro", "interval": "month", "auto_renew": "true"},
           "items": {"data": [{"id": "si_1", "price": {"id": sub_price}}]}}
    monkeypatch.setattr(billing, "stripe", lambda *_a, **_k: sub)
    monkeypatch.setattr(billing, "account", lambda _: {"stripe_customer_id": "cus_test"})
    # The live price was raised to 3500; this subscription bought the original 3000 price.
    monkeypatch.setattr(billing, "live_prices", lambda fresh=False: {("pro", "month", "USD"): OLD_ROW})
    settings = SimpleNamespace(**{**get_settings().model_dump(),
                                  "pulse_stripe_price_pro_month_usd": "price_original"})
    monkeypatch.setattr(billing, "get_settings", lambda: settings)

    def rows(table, **_kwargs):
        if table == "plan_price_versions":
            return [{"stripe_price_id": "price_new", "amount_minor": 3500}]
        return []
    monkeypatch.setattr(billing, "rows", rows)
    monkeypatch.setattr(billing, "create_checkout", lambda tenant, **kw: {"id": "renewal", **kw})
    monkeypatch.setattr(billing, "settle", lambda row, invoice, *_a: calls.append((row["amount"], invoice)))
    monkeypatch.setattr(billing, "service_request", lambda *_a, **_k: None)
    return calls


def _invoice(amount: int) -> dict:
    return {"id": "in_renew", "status": "paid", "amount_paid": amount, "currency": "usd", "customer": "cus_test",
            "subscription": "sub_test", "billing_reason": "subscription_cycle",
            "lines": {"data": [{"amount": amount, "period": {"start": 1700000000, "end": 1702592000}}]}}


def test_grandfathered_stripe_renewal_settles_at_its_own_price(monkeypatch):
    calls = _renewal(monkeypatch, "price_original")
    billing.stripe_subscription_paid(_invoice(3000))
    assert calls == [(3000, "in_renew")]


def test_renewal_with_unknown_price_or_wrong_amount_is_rejected(monkeypatch):
    _renewal(monkeypatch, "price_attacker")
    with pytest.raises(HTTPException) as error:
        billing.stripe_subscription_paid(_invoice(3000))
    assert error.value.status_code == 422
    _renewal(monkeypatch, "price_original")
    with pytest.raises(HTTPException):
        billing.stripe_subscription_paid(_invoice(3500))


@pytest.mark.parametrize(("row", "available", "low"), [
    ({"allowance": 4000, "balance": 401, "bonus_balance": 0}, 401, False),
    ({"allowance": 4000, "balance": 300, "bonus_balance": 100}, 400, True),
    ({"allowance": 200, "balance": 0, "bonus_balance": 0}, 0, True),
    ({"allowance": 0, "balance": 0, "bonus_balance": 50}, 50, False),
    (None, 0, True),
])
def test_credit_summary_low_threshold(row, available, low):
    summary = billing.credit_summary(row)
    assert summary["available"] == available and summary["low"] is low


@pytest.mark.asyncio
async def test_credits_endpoint_for_members(client, monkeypatch):
    async def member(*_):
        return {"role": "staff"}
    monkeypatch.setattr(billing, "membership", member)
    monkeypatch.setattr(billing, "credits", lambda _: {"allowance": 200, "balance": 15, "bonus_balance": 0})
    async with client:
        response = await client.get(f"/tenants/{TENANT}/billing/credits", headers={"authorization": "Bearer t"})
    assert response.json() == {"available": 15, "allowance": 200, "bonus_balance": 0, "cycle_end": None, "low": True}


# Admin plan writes --------------------------------------------------------------------------

def _operator(monkeypatch, seen: dict):
    async def fake_request(method, path, token, **kwargs):
        if path == "platform_operators":
            return [{"user_id": "user-1"}]
        seen[path] = kwargs.get("body")
        return {"replayed": False}
    monkeypatch.setattr(admin, "user_request", fake_request)


@pytest.mark.asyncio
async def test_stripe_price_change_creates_new_stripe_price(client, monkeypatch):
    seen, stripe_calls = {}, []
    _operator(monkeypatch, seen)
    monkeypatch.setattr(billing, "live_prices", lambda fresh=False: {})
    monkeypatch.setattr(billing, "default_stripe_price_id", lambda *_: "price_original")

    def fake_stripe(method, path, **kwargs):
        stripe_calls.append((method, path, kwargs))
        return {"product": "prod_pro"} if method == "GET" else {"id": "price_created"}
    monkeypatch.setattr(billing, "stripe", fake_stripe)
    key = str(uuid4())
    async with client:
        response = await client.put("/admin/plans/price", headers={"authorization": "Bearer t"}, json={
            "plan": "pro", "interval": "month", "currency": "USD", "amount_minor": 3900, "request_id": key})
    assert response.status_code == 200, response.text
    assert stripe_calls[0][:2] == ("GET", "prices/price_original")
    created = stripe_calls[1]
    assert created[1] == "prices" and created[2]["key"] == f"pulse-price-{key}"
    assert created[2]["data"]["product"] == "prod_pro" and created[2]["data"]["unit_amount"] == "3900"
    assert created[2]["data"]["recurring[interval]"] == "month" and created[2]["data"]["currency"] == "usd"
    assert seen["rpc/pulse_admin_set_price"] == {"p_plan": "pro", "p_interval": "month", "p_currency": "USD",
        "p_amount": 3900, "p_stripe_price_id": "price_created", "p_request_id": key}


@pytest.mark.asyncio
async def test_bdt_price_change_needs_no_stripe_and_unchanged_is_rejected(client, monkeypatch):
    seen = {}
    _operator(monkeypatch, seen)
    monkeypatch.setattr(billing, "live_prices", lambda fresh=False: {})
    monkeypatch.setattr(billing, "stripe", lambda *_a, **_k: (_ for _ in ()).throw(AssertionError("no Stripe")))
    async with client:
        ok = await client.put("/admin/plans/price", headers={"authorization": "Bearer t"}, json={
            "plan": "pro", "interval": "month", "currency": "BDT", "amount_minor": 400000, "request_id": str(uuid4())})
        same = await client.put("/admin/plans/price", headers={"authorization": "Bearer t"}, json={
            "plan": "pro", "interval": "month", "currency": "BDT",
            "amount_minor": billing.default_price("pro", "month", "BDT"), "request_id": str(uuid4())})
        bad = await client.put("/admin/plans/price", headers={"authorization": "Bearer t"}, json={
            "plan": "pro", "interval": "month", "currency": "EUR", "amount_minor": 99, "request_id": "x"})
        trial = await client.put("/admin/plans/trial-credits", headers={"authorization": "Bearer t"},
                                 json={"credits": 100_001})
    assert ok.status_code == 200 and seen["rpc/pulse_admin_set_price"]["p_stripe_price_id"] is None
    assert same.status_code == 409 and bad.status_code == 422 and trial.status_code == 422


@pytest.mark.asyncio
async def test_plan_routes_hidden_from_non_operators(client, monkeypatch):
    async def fake_request(method, path, token, **kwargs):
        assert path == "platform_operators"
        return []
    monkeypatch.setattr(admin, "user_request", fake_request)
    async with client:
        for method, path, body in (("GET", "/admin/plans", None),
                                   ("PUT", "/admin/plans/trial-credits", {"credits": 50})):
            response = await client.request(method, path, headers={"authorization": "Bearer t"}, json=body)
            assert response.status_code == 404


# Alerts -------------------------------------------------------------------------------------

def _delivery(kind: str, summary: dict, language: str = "english", channel: str = "email") -> dict:
    return {"id": str(uuid4()), "claim_token": str(uuid4()), "tenant_id": TENANT, "kind": kind, "channel": channel,
            "language": language, "destination": "+8801712345678" if channel == "whatsapp" else "o@example.com",
            "attempts": 1, "summary": {"business": "Shop <b>", **summary}}


@pytest.mark.parametrize(("kind", "summary", "params"), [
    ("order_confirmed", {"order_id": "abcdef12-0000", "customer": "Rahim", "units": 2, "total_minor": 255000,
                         "currency": "BDT", "payment": "unpaid"}, 7),
    ("order_drafted", {"order_id": "abcdef12-0000", "customer": "", "units": 1, "total_minor": 100,
                       "currency": "BDT"}, 6),
    ("credits_low", {"available": 20, "allowance": 200}, 4),
    ("credits_empty", {"available": 0, "allowance": 200}, 2),
    ("plan_ending", {"plan": "trial", "ends_at": "2026-11-17T10:00:00+00:00"}, 4),
    ("plan_expired", {"plan": "pro", "ends_at": "2026-11-13T10:00:00+00:00"}, 3),
    ("test", {}, 1),
])
@pytest.mark.parametrize("language", ["english", "bangla"])
def test_every_alert_renders_with_fixed_template_params(kind, summary, params, language):
    row = _delivery(kind, summary, language)
    assert len(delivery.content(row)["params"]) == params
    subject, text, html = delivery.render_email(row)
    assert subject.startswith("Pulse — ") and "Shop <b>" in text
    assert "Shop &lt;b&gt;" in html and "Shop <b>" not in html


def test_whatsapp_without_approved_template_is_suppressed(monkeypatch):
    settings = SimpleNamespace(**{**delivery.get_settings().model_dump(), "pulse_whatsapp_phone_id": "1",
        "pulse_whatsapp_number": "+8801", "pulse_whatsapp_token": "t", "pulse_whatsapp_app_secret": "s",
        "pulse_whatsapp_template_credits_low": ""})
    monkeypatch.setattr(delivery, "get_settings", lambda: settings)
    with pytest.raises(delivery.DeliveryFailure) as error:
        delivery.send_whatsapp(_delivery("credits_low", {"available": 1, "allowance": 200}, channel="whatsapp"))
    assert error.value.kind == "suppressed"


def test_deliver_marks_accepted_and_retries_transient_failures(monkeypatch):
    monkeypatch.setattr(delivery, "get_settings", lambda: SimpleNamespace(pulse_notifications_enabled=True,
                                                                          pulse_web_origin="https://pulse.test"))
    row = _delivery("credits_empty", {"available": 0, "allowance": 200})
    patches = []

    def store(method, path, **kwargs):
        if path == "rpc/pulse_claim_notification":
            return row
        patches.append((kwargs["params"], kwargs["body"]))
    monkeypatch.setattr(delivery, "service_request", store)
    monkeypatch.setattr(delivery, "send_email", lambda *_a: "resend")
    delivery.deliver(row["id"])
    assert patches[-1][1]["status"] == "accepted" and patches[-1][0]["claim_token"] == f"eq.{row['claim_token']}"

    def flaky(*_a):
        raise delivery.DeliveryFailure("retry", "TimeoutError")
    monkeypatch.setattr(delivery, "send_email", flaky)
    delivery.deliver(row["id"])
    assert patches[-1][1]["status"] == "queued"
    row["attempts"] = delivery.MAX_ATTEMPTS
    delivery.deliver(row["id"])
    assert patches[-1][1]["status"] == "failed"


@pytest.mark.asyncio
async def test_pulse_whatsapp_webhook_requires_signature_and_handles_stop(client, monkeypatch):
    settings = SimpleNamespace(pulse_whatsapp_app_secret="wa-secret", pulse_whatsapp_phone_id="pn-1")
    monkeypatch.setattr(notifications, "get_settings", lambda: settings)
    writes = []
    monkeypatch.setattr(notifications, "service_request", lambda method, path, **kw: writes.append((path, kw)))
    payload = json.dumps({"entry": [{"changes": [{"value": {"metadata": {"phone_number_id": "pn-1"},
        "messages": [{"from": "8801712345678", "text": {"body": "STOP"}}]}}]}]}).encode()
    signature = "sha256=" + hmac.new(b"wa-secret", payload, hashlib.sha256).hexdigest()
    async with client:
        forged = await client.post("/webhooks/pulse-whatsapp", content=payload,
                                   headers={"x-hub-signature-256": "sha256=00"})
        assert forged.status_code == 403 and not writes
        ok = await client.post("/webhooks/pulse-whatsapp", content=payload, headers={"x-hub-signature-256": signature})
    assert ok.status_code == 200
    assert writes[0][0] == "notification_settings" and writes[0][1]["params"] == {"whatsapp": "eq.+8801712345678"}
    assert writes[0][1]["body"] == {"whatsapp_enabled": False, "whatsapp_consent_at": None}


@pytest.mark.asyncio
@pytest.mark.parametrize("body", [{"email": "not-an-email"}, {"whatsapp": "01712345678"},
                                  {"language": "french"}, {"email": "a@b.co\r\nBcc: x@y.z"}])
async def test_notification_preferences_are_validated(client, monkeypatch, body):
    async def is_owner(*_):
        return {"role": "owner", "tenants": {}}
    monkeypatch.setattr(notifications, "owner", is_owner)
    monkeypatch.setattr(main, "membership", is_owner)
    async with client:
        response = await client.put(f"/tenants/{TENANT}/notifications", json=body,
                                    headers={"authorization": "Bearer t"})
    assert response.status_code == 422
