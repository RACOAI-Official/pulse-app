from uuid import uuid4

import httpx
import pytest

from pulse_api import admin, billing, main

TENANT = "00000000-0000-0000-0000-000000000001"


async def fake_session():
    return ("token", {"id": "user-1", "email": "op@example.com"})


@pytest.fixture
def client(monkeypatch):
    main.app.dependency_overrides[main.session] = fake_session

    async def no_limit(*_):
        return 0
    monkeypatch.setattr("pulse_api.ratelimit.retry_after", no_limit)
    monkeypatch.setattr(main, "retry_after", no_limit)
    yield httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app), base_url="http://test")
    main.app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_non_operator_gets_404_and_no_rpc(client, monkeypatch):
    calls = []

    async def fake_request(method, path, token, **kwargs):
        calls.append(path)
        return []  # not in platform_operators
    monkeypatch.setattr(admin, "user_request", fake_request)
    async with client:
        for path in ("/admin/overview", "/admin/businesses", f"/admin/businesses/{TENANT}", "/admin/users",
                     "/admin/payments", "/admin/credits", "/admin/audit"):
            response = await client.get(path, headers={"authorization": "Bearer t"})
            assert response.status_code == 404, path
        response = await client.post(f"/admin/businesses/{TENANT}/credits", headers={"authorization": "Bearer t"},
                                     json={"amount": 5, "note": "promo", "idempotency_key": str(uuid4())})
        assert response.status_code == 404
    assert calls and all(path == "platform_operators" for path in calls)


@pytest.mark.asyncio
async def test_operator_adjust_credits_passes_validated_body(client, monkeypatch):
    seen = {}

    async def fake_request(method, path, token, **kwargs):
        if path == "platform_operators":
            return [{"user_id": "user-1"}]
        seen[path] = kwargs["body"]
        return {"bonus_balance": 5, "replayed": False}
    monkeypatch.setattr(admin, "user_request", fake_request)
    key = str(uuid4())
    async with client:
        response = await client.post(f"/admin/businesses/{TENANT}/credits", headers={"authorization": "Bearer t"},
                                     json={"amount": 5, "note": "  promo  ", "idempotency_key": key})
    assert response.status_code == 200 and response.json()["bonus_balance"] == 5
    assert seen["rpc/pulse_admin_adjust_credits"] == {
        "p_tenant_id": TENANT, "p_amount": 5, "p_note": "promo", "p_idempotency_key": key}


@pytest.mark.asyncio
@pytest.mark.parametrize("body", [
    {"amount": 0, "note": "promo"},
    {"amount": 1_000_001, "note": "promo"},
    {"amount": 5, "note": "  "},
    {"amount": 5, "note": "x" * 501},
])
async def test_adjust_credits_validation(client, monkeypatch, body):
    async def fake_request(method, path, token, **kwargs):
        if path == "platform_operators":
            return [{"user_id": "user-1"}]
        raise AssertionError("RPC must not run for invalid input")
    monkeypatch.setattr(admin, "user_request", fake_request)
    async with client:
        response = await client.post(f"/admin/businesses/{TENANT}/credits", headers={"authorization": "Bearer t"},
                                     json={**body, "idempotency_key": str(uuid4())})
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_list_filters_are_validated(client, monkeypatch):
    async def fake_request(method, path, token, **kwargs):
        return [{"user_id": "user-1"}] if path == "platform_operators" else {"total": 0, "rows": []}
    monkeypatch.setattr(admin, "user_request", fake_request)
    async with client:
        assert (await client.get("/admin/businesses?status=bogus", headers={"authorization": "Bearer t"})).status_code == 422
        assert (await client.get("/admin/payments?state=refunded", headers={"authorization": "Bearer t"})).status_code == 422
        assert (await client.get("/admin/users?page=0", headers={"authorization": "Bearer t"})).status_code == 422
        assert (await client.get("/admin/businesses?status=suspended&page=2",
                                 headers={"authorization": "Bearer t"})).status_code == 200


@pytest.mark.asyncio
async def test_suspended_workspace_is_read_only_including_plan(client, monkeypatch):
    async def suspended(*_):
        return {"role": "owner", "tenants": {"suspended_at": "2026-11-14T00:00:00Z"}}
    monkeypatch.setattr(main, "membership", suspended)
    monkeypatch.setattr(billing, "has_access", lambda _: True)
    async with client:
        for path in (f"/tenants/{TENANT}/commerce/media", f"/tenants/{TENANT}/billing/checkout"):
            response = await client.post(path, headers={"authorization": "Bearer valid"}, content=b"x")
            assert response.status_code == 403, path
            assert "suspended" in response.json()["detail"]
