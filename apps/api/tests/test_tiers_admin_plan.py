from datetime import datetime, timedelta, timezone
from uuid import UUID

import httpx
import pytest
from fastapi import HTTPException

from pulse_api import account, admin, billing, main, meta_oauth
from pulse_api.store import StoreError

TENANT = "00000000-0000-0000-0000-000000000001"
AUTH_HEADER = {"authorization": "Bearer t"}


async def fake_session():
    return ("token", {"id": "user-1", "email": "owner@example.com"})


@pytest.fixture
def client(monkeypatch):
    main.app.dependency_overrides[main.session] = fake_session

    async def no_limit(*_):
        return 0
    monkeypatch.setattr("pulse_api.ratelimit.retry_after", no_limit)
    monkeypatch.setattr(main, "retry_after", no_limit)
    monkeypatch.setattr(billing, "live_prices", lambda fresh=False: {})
    yield httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app), base_url="http://test")
    main.app.dependency_overrides.clear()


def operator_rpc(monkeypatch, result=None):
    seen = {}

    async def fake_request(method, path, token, **kwargs):
        if path == "platform_operators":
            return [{"user_id": "user-1"}]
        seen[path] = kwargs["body"]
        return result or {}
    monkeypatch.setattr(admin, "user_request", fake_request)
    return seen


# Admin plan assignment

@pytest.mark.asyncio
async def test_assign_plan_passes_months_reason_and_plan_allowance(client, monkeypatch):
    seen = operator_rpc(monkeypatch, {"plan_key": "pro", "access_until": "2027-02-18T00:00:00Z"})
    async with client:
        response = await client.post(f"/admin/businesses/{TENANT}/plan", headers=AUTH_HEADER,
                                     json={"plan": "pro", "months": 3, "reason": "  pilot partner  "})
    assert response.status_code == 200
    assert seen["rpc/pulse_admin_assign_plan"] == {"p_tenant_id": TENANT, "p_plan": "pro", "p_months": 3,
                                                   "p_reason": "pilot partner", "p_allowance": 4000}


@pytest.mark.asyncio
@pytest.mark.parametrize("body", [
    {"plan": "gold", "months": 3, "reason": "pilot"},
    {"plan": "pro", "months": 0, "reason": "pilot"},
    {"plan": "pro", "months": 25, "reason": "pilot"},
    {"plan": "pro", "months": 3, "reason": "x"},
])
async def test_assign_plan_rejects_invalid_input(client, monkeypatch, body):
    seen = operator_rpc(monkeypatch)
    async with client:
        response = await client.post(f"/admin/businesses/{TENANT}/plan", headers=AUTH_HEADER, json=body)
    assert response.status_code == 422 and not seen


@pytest.mark.asyncio
async def test_revoke_plan_requires_reason_and_calls_rpc(client, monkeypatch):
    seen = operator_rpc(monkeypatch, {"revoked": "enterprise", "effective_plan": None})
    async with client:
        bad = await client.post(f"/admin/businesses/{TENANT}/plan/revoke", headers=AUTH_HEADER, json={})
        good = await client.post(f"/admin/businesses/{TENANT}/plan/revoke", headers=AUTH_HEADER,
                                 json={"reason": "trial over"})
    assert bad.status_code == 422 and good.status_code == 200
    assert seen["rpc/pulse_admin_revoke_plan"] == {"p_tenant_id": TENANT, "p_reason": "trial over"}


@pytest.mark.asyncio
async def test_non_operator_cannot_assign_plan(client, monkeypatch):
    async def fake_request(method, path, token, **kwargs):
        assert path == "platform_operators"
        return []
    monkeypatch.setattr(admin, "user_request", fake_request)
    async with client:
        response = await client.post(f"/admin/businesses/{TENANT}/plan", headers=AUTH_HEADER,
                                     json={"plan": "enterprise", "months": 12, "reason": "pilot"})
    assert response.status_code == 404


# Tiers and gates

def test_status_lists_three_plans_with_tier_prices(monkeypatch):
    monkeypatch.setattr(billing, "live_prices", lambda fresh=False: {})
    monkeypatch.setattr(billing, "rows", lambda *_a, **_k: [])
    monkeypatch.setattr(billing, "account", lambda _: None)
    monkeypatch.setattr(billing, "credits", lambda _: None)
    monkeypatch.setattr(billing, "has_access", lambda _: True)
    monkeypatch.setattr(billing, "effective_plan", lambda _: None)
    monkeypatch.setattr(billing, "providers", lambda: {"stripe": False, "sslcommerz": True})
    result = billing._status(UUID(TENANT), ("t", {}))
    plans = {plan["key"]: plan for plan in result["plans"]}
    assert [plan["name"] for plan in result["plans"]] == ["Starter", "Business", "Enterprise"]
    assert plans["starter"]["prices"]["month"]["BDT"] == 499900
    assert plans["pro"]["prices"]["year"]["BDT"] == 6499000
    assert plans["enterprise"]["credits"] == 12000
    assert result["seat_limit"] == 3 and result["grant"] is None


def test_status_offers_quotes_for_each_higher_plan(monkeypatch):
    now = datetime.now(timezone.utc)
    current = {"plan_key": "starter", "state": "active", "provider": "sslcommerz", "billing_interval": "month",
               "currency_code": "BDT", "term_start": (now - timedelta(days=15)).isoformat(),
               "paid_through": (now + timedelta(days=15)).isoformat()}
    monkeypatch.setattr(billing, "live_prices", lambda fresh=False: {})
    monkeypatch.setattr(billing, "rows", lambda *_a, **_k: [])
    monkeypatch.setattr(billing, "account", lambda _: current)
    monkeypatch.setattr(billing, "credits", lambda _: None)
    monkeypatch.setattr(billing, "has_access", lambda _: True)
    monkeypatch.setattr(billing, "effective_plan", lambda _: "starter")
    monkeypatch.setattr(billing, "providers", lambda: {"stripe": False, "sslcommerz": True})
    result = billing._status(UUID(TENANT), ("t", {}))
    assert set(result["upgrade_quotes"]) == {"pro", "enterprise"}
    assert result["seat_limit"] == 1


def test_change_direction_is_checked_by_rank():
    active = {"state": "active", "plan_key": "pro",
              "paid_through": (datetime.now(timezone.utc) + timedelta(days=9)).isoformat()}
    assert billing.require_change(active, "enterprise", higher=True) is active
    assert billing.require_change(active, "starter", higher=False) is active
    for target, higher in (("starter", True), ("enterprise", False), ("pro", True)):
        with pytest.raises(HTTPException) as error:
            billing.require_change(active, target, higher=higher)
        assert error.value.status_code == 409


def test_seat_limits_per_plan():
    assert [billing.seat_limit(plan) for plan in (None, "starter", "pro", "enterprise")] == [3, 1, 3, None]


@pytest.mark.asyncio
async def test_starter_invite_is_blocked_at_seat_limit(client, monkeypatch):
    async def member(*_):
        return {"role": "owner"}
    monkeypatch.setattr(main, "membership", member)
    monkeypatch.setattr(billing, "has_access", lambda _: True)
    monkeypatch.setattr(billing, "effective_plan", lambda _: "starter")
    monkeypatch.setattr(main, "service_request", lambda method, table, **kw: [{"user_id": "owner"}])
    monkeypatch.setattr(main, "service_auth_request",
                        lambda *_a, **_k: (_ for _ in ()).throw(AssertionError("must not invite")))
    async with client:
        response = await client.post(f"/tenants/{TENANT}/invites", headers=AUTH_HEADER,
                                     json={"email": "staff@example.com"})
    assert response.status_code == 402 and "Starter plan includes 1 team member" in response.json()["detail"]


@pytest.mark.asyncio
async def test_whatsapp_needs_business_plan(monkeypatch):
    async def owner(*_):
        return {"role": "owner"}
    monkeypatch.setattr(meta_oauth, "owner", owner)
    monkeypatch.setattr(billing, "effective_plan", lambda _: "starter")
    with pytest.raises(HTTPException) as error:
        await meta_oauth.whatsapp_complete(UUID(TENANT), meta_oauth.WhatsAppInput.model_construct(), ("t", {}))
    assert error.value.status_code == 402 and "Business plan" in error.value.detail


def test_grant_unlocks_paid_access(monkeypatch):
    monkeypatch.setattr(billing, "service_request", lambda *_a, **_k: "enterprise")
    assert billing.effective_plan(TENANT) == "enterprise" and billing.paid_access(TENANT)
    monkeypatch.setattr(billing, "service_request", lambda *_a, **_k: None)
    assert not billing.paid_access(TENANT)


# Password change

@pytest.fixture
def password_calls(monkeypatch):
    calls = {"updated": [], "logout": 0, "valid": "old-secret"}
    monkeypatch.setattr(account, "_password_matches", lambda email, password: password == calls["valid"])

    def update(method, path, **kw):
        calls["updated"].append((method, path, kw["body"]))
    monkeypatch.setattr(account, "service_auth_request", update)

    def logout(token):
        calls["logout"] += 1
    monkeypatch.setattr(account, "_sign_out_others", logout)
    return calls


@pytest.mark.asyncio
async def test_password_change_happy_path(client, password_calls):
    async with client:
        response = await client.post("/me/password", headers=AUTH_HEADER,
                                     json={"current_password": "old-secret", "new_password": "new-secret-1"})
    assert response.status_code == 200 and response.json() == {"status": "updated"}
    assert password_calls["updated"] == [("PUT", "admin/users/user-1", {"password": "new-secret-1"})]
    assert password_calls["logout"] == 1


@pytest.mark.asyncio
async def test_password_change_rejects_wrong_current_and_reuse(client, password_calls):
    async with client:
        wrong = await client.post("/me/password", headers=AUTH_HEADER,
                                  json={"current_password": "guess", "new_password": "new-secret-1"})
        same = await client.post("/me/password", headers=AUTH_HEADER,
                                 json={"current_password": "old-secret", "new_password": "old-secret"})
        short = await client.post("/me/password", headers=AUTH_HEADER,
                                  json={"current_password": "old-secret", "new_password": "short"})
    assert wrong.status_code == 400 and wrong.json()["detail"] == "Current password is incorrect"
    assert same.status_code == 422 and short.status_code == 422
    assert password_calls["updated"] == [] and password_calls["logout"] == 0


@pytest.mark.asyncio
async def test_password_change_surfaces_weak_password_message(client, password_calls, monkeypatch):
    def weak(*_a, **_k):
        raise StoreError(422, "Password is known to be weak")
    monkeypatch.setattr(account, "service_auth_request", weak)
    async with client:
        response = await client.post("/me/password", headers=AUTH_HEADER,
                                     json={"current_password": "old-secret", "new_password": "password123"})
    assert response.status_code == 422 and response.json()["detail"] == "Password is known to be weak"
