"""Opt-in Phase 3 check using local Supabase and the configured model endpoint.

Creates a uniquely named local fixture account and tenant. No Meta request is sent.
Run from repo root with PYTHONPATH=apps/api apps/api/.venv/bin/python
apps/api/tests/integration_agent_local.py.
"""

import asyncio
from uuid import uuid4

import httpx

from pulse_api.main import app
from pulse_api.settings import get_settings
from pulse_api.store import eq, service_auth_request, service_request
from pulse_api.tasks import process_agent_job


async def request(client, method, path, token, **kwargs):
    response = await client.request(method, path,
        headers={"Authorization": f"Bearer {token}"}, **kwargs)
    assert response.status_code < 400, (path, response.status_code, response.text)
    return response.json()


async def main():
    settings = get_settings()
    assert settings.supabase_url.startswith("http://127.0.0.1:"), "Local Supabase only"
    assert settings.pulse_llm_chat_url and settings.pulse_llm_model, "Model endpoint required"
    suffix = uuid4().hex[:10]
    email = f"phase3-{suffix}@example.test"
    password = f"Local-test-{uuid4().hex}!"
    user = service_auth_request("POST", "admin/users", body={
        "email": email, "password": password, "email_confirm": True,
    })
    tenant = service_request("POST", "tenants", body={"name": f"Phase 3 {suffix}"},
                             prefer="return=representation")[0]
    service_request("POST", "memberships", body={
        "tenant_id": tenant["id"], "user_id": user["id"], "role": "owner",
    })
    async with httpx.AsyncClient() as client:
        login = await client.post(f"{settings.supabase_url}/auth/v1/token?grant_type=password",
            headers={"apikey": settings.supabase_anon_key},
            json={"email": email, "password": password})
        assert login.status_code == 200, login.status_code
        token = login.json()["access_token"]
    base = f"/tenants/{tenant['id']}/agent"
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://local") as client:
        saved = await request(client, "PUT", f"{base}/draft", token, json={
            "business_name": "Pulse Fixture Shop",
            "business_description": "A test store with no real orders.",
            "policies": [{"topic": "Delivery", "content": "We deliver in Dhaka."}],
        })
        assert saved["draft_revision"] == 1
        before_test = await client.post(f"{base}/publish",
            headers={"Authorization": f"Bearer {token}"})
        assert before_test.status_code >= 400, before_test.text
        preview = await request(client, "POST", f"{base}/test", token, json={
            "prompt": "Do you deliver in Dhaka? Reply briefly.",
        })
        assert preview["response"] and preview["tested_revision"] == 1
        published = await request(client, "POST", f"{base}/publish", token)
        assert published["published_version"] == 1 and not published["enabled"]
        enabled = await request(client, "POST", f"{base}/enabled", token,
                                json={"enabled": True})
        assert enabled["enabled"]

    connection = service_request("POST", "channel_connections", body={
        "tenant_id": tenant["id"], "channel": "messenger",
        "external_account_id": f"phase3-page-{suffix}", "display_name": "Fixture Page",
        "credential_ciphertext": "fixture-no-send", "status": "connected",
    }, prefer="return=representation")[0]
    first = service_request("POST", "rpc/pulse_record_inbound", body={
        "p_connection_id": connection["id"], "p_thread_id": "fixture-customer",
        "p_provider_id": f"{suffix}-1", "p_body": "Hi,",
    })
    second = service_request("POST", "rpc/pulse_record_inbound", body={
        "p_connection_id": connection["id"], "p_thread_id": "fixture-customer",
        "p_provider_id": f"{suffix}-2", "p_body": "do you deliver in Dhaka?",
    })
    jobs = service_request("GET", "agent_jobs", params={
        "tenant_id": eq(tenant["id"]), "select": "id,source_message_id,status",
        "order": "job_seq.asc",
    })
    assert len(jobs) == 2 and jobs[0]["source_message_id"] == first
    assert jobs[0]["status"] == "cancelled" and jobs[1]["source_message_id"] == second
    service_request("PATCH", "agent_jobs", params={"id": eq(jobs[1]["id"])},
                    body={"due_at": "2020-01-01T00:00:00Z"})
    process_agent_job(jobs[1]["id"])
    done = service_request("GET", "agent_jobs", params={
        "id": eq(jobs[1]["id"]), "select": "status,reply_message_id", "limit": "1",
    })[0]
    assert done["status"] == "done" and done["reply_message_id"], done
    reply = service_request("GET", "messages", params={
        "id": eq(done["reply_message_id"]), "select": "sender_type,delivery_state,body", "limit": "1",
    })[0]
    assert reply["sender_type"] == "ai" and reply["delivery_state"] == "queued"
    assert reply["body"]
    print("PASS: draft, private model test, publish, enable, coalescing, queued AI reply")


if __name__ == "__main__":
    asyncio.run(main())
