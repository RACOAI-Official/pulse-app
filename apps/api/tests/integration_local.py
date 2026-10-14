"""Opt-in integration check against a fresh local Supabase and Redis stack.

Run from the repository root with `PYTHONPATH=apps/api .venv/bin/python
apps/api/tests/integration_local.py` while the Celery worker is running.
Creates uniquely named fixture users and tenants in the local database.
"""

import asyncio
import hashlib
import hmac
import json
import time
from uuid import uuid4

import httpx
from cryptography.fernet import Fernet
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from pulse_api.main import app
from pulse_api.settings import get_settings
from pulse_api.store import service_auth_request, service_request


async def api(client, method, path, token=None, **kwargs):
    headers = kwargs.pop("headers", {})
    if token:
        headers["Authorization"] = f"Bearer {token}"
    response = await client.request(method, path, headers=headers, **kwargs)
    if response.status_code >= 400:
        raise AssertionError(f"{method} {path}: {response.status_code} {response.text}")
    return response.json()


async def main():
    settings = get_settings()
    assert settings.supabase_url.startswith("http://127.0.0.1:"), "Local stack only"
    suffix = uuid4().hex[:10]
    accounts = []
    tenants = []
    for index in range(2):
        email = f"phase1-{suffix}-{index}@example.test"
        password = f"Local-test-{uuid4().hex}!"
        user = service_auth_request("POST", "admin/users", body={
            "email": email, "password": password, "email_confirm": True,
        })
        tenant = service_request("POST", "tenants", body={"name": f"Phase 1 {suffix} {index}"},
                                 prefer="return=representation")[0]
        service_request("POST", "memberships", body={
            "tenant_id": tenant["id"], "user_id": user["id"], "role": "owner",
        })
        async with httpx.AsyncClient() as client:
            auth = await client.post(f"{settings.supabase_url}/auth/v1/token?grant_type=password",
                                     headers={"apikey": settings.supabase_anon_key},
                                     json={"email": email, "password": password})
            assert auth.status_code == 200, (auth.status_code, auth.text)
            token = auth.json()["access_token"]
        accounts.append(token)
        tenants.append(tenant["id"])

    channel = "messenger"
    account_id = f"fixture-page-{suffix}"
    service_request("POST", "channel_connections", body={
        "tenant_id": tenants[0], "channel": channel, "external_account_id": account_id,
        "display_name": "Fixture page", "status": "connected",
        "credential_ciphertext": Fernet(settings.pulse_credential_key.encode()).encrypt(
            b"fixture-invalid-meta-token").decode(),
    })
    payload = {"object": "page", "entry": [{"id": account_id, "messaging": [{
        "sender": {"id": f"customer-{suffix}"},
        "message": {"mid": f"message-{suffix}", "text": "Hello from integration test"},
    }]}]}
    raw = json.dumps(payload).encode()
    signature = "sha256=" + hmac.new(settings.meta_app_secret.encode(), raw, hashlib.sha256).hexdigest()
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://local") as client:
        received = await api(client, "POST", "/webhooks/meta", content=raw,
                             headers={"x-hub-signature-256": signature})
        assert received == {"accepted": 1}, received
        replay = await api(client, "POST", "/webhooks/meta", content=raw,
                           headers={"x-hub-signature-256": signature})
        assert replay == {"accepted": 0}, replay
        tenant_path = f"/tenants/{tenants[0]}"
        for _ in range(40):
            rows = await api(client, "GET", f"{tenant_path}/conversations", accounts[0])
            if rows:
                break
            await asyncio.sleep(0.25)
        assert len(rows) == 1, rows
        conversation_id = rows[0]["id"]
        messages = await api(client, "GET", f"{tenant_path}/conversations/{conversation_id}/messages",
                             accounts[0])
        assert len(messages) == 1 and messages[0]["body"] == "Hello from integration test", messages
        denied = await client.get(f"{tenant_path}/conversations", headers={
            "Authorization": f"Bearer {accounts[1]}"})
        assert denied.status_code == 404, (denied.status_code, denied.text)
        reply = await api(client, "POST", f"{tenant_path}/conversations/{conversation_id}/reply",
                          accounts[0], json={"body": "Human reply", "idempotency_key": str(uuid4())})
        assert reply["delivery_state"] == "queued", reply
        for _ in range(60):
            messages = await api(client, "GET", f"{tenant_path}/conversations/{conversation_id}/messages",
                                 accounts[0])
            outbound = [m for m in messages if m["direction"] == "outbound"]
            if outbound and outbound[0]["delivery_state"] in ("failed", "uncertain"):
                break
            await asyncio.sleep(0.25)
        assert len(outbound) == 1 and outbound[0]["delivery_state"] == "failed", outbound
        assert len(messages) == 2, messages
        ops = await api(client, "GET", f"{tenant_path}/operations", accounts[0])
        assert any(m["id"] == reply["message_id"] for m in ops["problem_sends"]), ops
        invite = await api(client, "POST", f"{tenant_path}/invites", accounts[0],
                           json={"email": f"phase1-staff-{suffix}@example.test"})
        assert invite["status"] == "invited", invite
        ticket = await api(client, "POST", f"{tenant_path}/ws-ticket", accounts[0])
        assert ticket["ticket"] and ticket["expires_in"] == 60, ticket
    with TestClient(app) as browser:
        try:
            with browser.websocket_connect(f"/ws?ticket={ticket['ticket']}",
                                           headers={"origin": "http://untrusted.example"}):
                raise AssertionError("Foreign origin should be refused")
        except WebSocketDisconnect as exc:
            assert exc.code == 1008, exc.code
        with browser.websocket_connect(f"/ws?ticket={ticket['ticket']}",
                                       headers={"origin": settings.pulse_web_origin}) as socket:
            assert socket.receive_json() == {"type": "heartbeat"}
        try:
            with browser.websocket_connect(f"/ws?ticket={ticket['ticket']}",
                                           headers={"origin": settings.pulse_web_origin}):
                raise AssertionError("Ticket replay should be refused")
        except WebSocketDisconnect as exc:
            assert exc.code == 1008, exc.code
    print("PASS: signed webhook, dedupe, worker, tenant RLS, inbox, reply failure, invite, WS auth")


if __name__ == "__main__":
    asyncio.run(main())
