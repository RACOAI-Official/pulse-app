import hashlib
import hmac
import json
from uuid import UUID

import httpx
import pytest

from pulse_api import deps, main


@pytest.mark.asyncio
async def test_membership_checks_current_user_row(monkeypatch):
    seen = {}

    async def fake_auth_user(token):
        return {"id": "user-1"}

    async def fake_user_request(method, path, token, **kwargs):
        seen.update(kwargs["params"])
        return [{"tenant_id": "00000000-0000-0000-0000-000000000001", "user_id": "user-1", "role": "staff"}]

    monkeypatch.setattr(deps, "auth_user", fake_auth_user)
    monkeypatch.setattr(deps, "user_request", fake_user_request)
    result = await main.membership(UUID("00000000-0000-0000-0000-000000000001"), "token")
    assert result["role"] == "staff"
    assert seen["user_id"] == "eq.user-1"


@pytest.mark.asyncio
async def test_webhook_rejects_bad_signature_before_database(monkeypatch):
    def unexpected(*args, **kwargs):
        raise AssertionError("Database must not be accessed")

    monkeypatch.setattr(main, "service_request", unexpected)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app), base_url="http://test") as client:
        response = await client.post("/webhooks/meta", content=b"{}",
                                     headers={"x-hub-signature-256": "sha256=bad"})
    assert response.status_code == 403


@pytest.mark.asyncio
async def test_webhook_stores_each_event_once(monkeypatch):
    payload = {"object": "page", "entry": [{"id": "page-1", "messaging": [
        {"sender": {"id": "customer"}, "message": {"mid": "mid-1", "text": "Hi"}},
    ]}]}
    raw = json.dumps(payload).encode()
    signature = "sha256=" + hmac.new(b"test-secret", raw, hashlib.sha256).hexdigest()
    inserted = []
    queued = []

    def fake_store(method, path, **kwargs):
        if path == "channel_connections":
            return [{"id": "connection-1", "tenant_id": "tenant-1"}]
        if path == "webhook_events":
            inserted.append(kwargs["body"])
            return [{"id": "event-1"}] if len(inserted) == 1 else []
        raise AssertionError(path)

    monkeypatch.setattr(main, "service_request", fake_store)
    monkeypatch.setattr(main.process_webhook, "delay", lambda event_id: queued.append(event_id))
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app), base_url="http://test") as client:
        first = await client.post("/webhooks/meta", content=raw, headers={"x-hub-signature-256": signature})
        replay = await client.post("/webhooks/meta", content=raw, headers={"x-hub-signature-256": signature})
    assert first.json() == {"accepted": 1}
    assert replay.json() == {"accepted": 0}
    assert queued == ["event-1"]
    assert inserted[0]["external_event_id"] == "mid-1"
