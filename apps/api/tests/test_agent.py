from types import SimpleNamespace
from uuid import UUID

import httpx
import pytest
from fastapi import HTTPException

from pulse_api import agent, main


def test_local_model_uses_configured_endpoint_and_returns_content(monkeypatch):
    seen = {}
    settings = SimpleNamespace(pulse_llm_chat_url="https://model.example/v1/chat/completions",
        pulse_llm_model="qwen3", pulse_llm_api_key="local-test-key",
        pulse_llm_disable_thinking=True)
    monkeypatch.setattr(agent, "get_settings", lambda: settings)

    def handler(request):
        seen["url"] = str(request.url)
        seen["auth"] = request.headers["Authorization"]
        seen["body"] = __import__("json").loads(request.content)
        return httpx.Response(200, json={"choices": [{"message": {"content": "Hello!"}}]})

    transport = httpx.MockTransport(handler)
    real_client = httpx.Client
    monkeypatch.setattr(agent.httpx, "Client", lambda **kwargs: real_client(transport=transport))
    result = agent.generate_reply({**agent.DEFAULT_DRAFT, "business_name": "Test"}, "Hi", [])
    assert result == "Hello!"
    assert seen["url"] == settings.pulse_llm_chat_url
    assert seen["auth"] == "Bearer local-test-key"
    assert seen["body"]["chat_template_kwargs"] == {"enable_thinking": False}
    assert seen["body"]["messages"][-1] == {"role": "user", "content": "Hi"}


def test_catalog_lookup_always_scopes_tenant(monkeypatch):
    calls = []
    def fake_store(method, path, **kwargs):
        calls.append((path, kwargs["params"]))
        if path == "tenants":
            return [{"currency_code": "BDT"}]
        if path == "products":
            return [{"id": "product-1", "title": "Black shirt", "description": "Cotton"}]
        return [{"product_id": "product-1", "sku": "BLACK-XL", "stock": 2,
                 "regular_price_minor": 200000, "offer_price_minor": None, "options": {"size": "XL"}}]
    monkeypatch.setattr(agent, "service_request", fake_store)
    facts = agent.catalog_facts("tenant-1", "Do you have black shirt XL?")
    assert facts[0]["variants"][0]["stock"] == 2
    assert facts[0]["variants"][0]["price"] == "2000.00 BDT"
    assert all(params.get("tenant_id", params.get("id")) == "eq.tenant-1" for _, params in calls)


@pytest.mark.asyncio
async def test_staff_cannot_save_agent_draft(monkeypatch):
    async def fake_membership(*args):
        return {"role": "staff"}
    monkeypatch.setattr(main, "membership", fake_membership)
    with pytest.raises(HTTPException) as exc:
        await main.save_agent_draft(UUID("00000000-0000-0000-0000-000000000001"),
            main.AgentDraft(business_name="Test"), ("token", {"id": "user"}))
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_private_test_uses_draft_and_marks_revision(monkeypatch):
    tenant = UUID("00000000-0000-0000-0000-000000000001")
    seen = []
    async def fake_membership(*args):
        return {"role": "owner"}
    async def fake_request(method, path, token, **kwargs):
        seen.append(path)
        return True
    def fake_config(*args):
        return {"draft": {**agent.DEFAULT_DRAFT, "business_name": "Draft Store"},
                "draft_revision": 3, "published": {"business_name": "Old Store"}}
    def fake_generate(config, prompt, facts, history):
        assert config["business_name"] == "Draft Store"
        return "Draft answer"
    monkeypatch.setattr(main, "membership", fake_membership)
    monkeypatch.setattr(main, "user_request", fake_request)
    monkeypatch.setattr(main, "config_for_tenant", fake_config)
    monkeypatch.setattr(main, "catalog_facts", lambda *args: [])
    monkeypatch.setattr(main, "generate_reply", fake_generate)
    result = await main.test_agent(tenant, main.AgentTestRequest(prompt="Hello"),
                                   ("token", {"id": "user"}))
    assert result["response"] == "Draft answer"
    assert result["tested_revision"] == 3
    assert seen == ["agent_test_runs", "rpc/pulse_mark_agent_tested"]
