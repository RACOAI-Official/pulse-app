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
    monkeypatch.setattr(main, "with_delivery", lambda config, _: config)
    monkeypatch.setattr(main, "config_for_tenant", fake_config)
    monkeypatch.setattr(main, "catalog_facts", lambda *args: [])
    monkeypatch.setattr(main, "generate_reply", fake_generate)
    result = await main.test_agent(tenant, main.AgentTestRequest(prompt="Hello"),
                                   ("token", {"id": "user"}))
    assert result["response"] == "Draft answer"
    assert result["tested_revision"] == 3
    assert seen == ["agent_test_runs", "rpc/pulse_mark_agent_tested"]


def test_extract_order_parses_marker_and_rejects_bad_proposals():
    reply = ('ORDER_CONFIRMED {"items":[{"sku":"TEE-BLK-L","quantity":3}],"customer_name":"Rahim",'
             '"customer_phone":"01700000000","delivery_address":"Dhaka"}')
    assert agent.extract_order(reply) == {"items": [{"sku": "TEE-BLK-L", "quantity": 3}],
        "customer_name": "Rahim", "customer_phone": "01700000000", "delivery_address": "Dhaka"}
    assert agent.extract_order("Total is 2,550 BDT. Shall I confirm?") is None
    with pytest.raises(ValueError):
        agent.extract_order('ORDER_CONFIRMED {"items":[{"sku":"X","quantity":0}],"customer_name":"A",'
                            '"customer_phone":"1","delivery_address":"B"}')
    with pytest.raises(ValueError):
        agent.extract_order('ORDER_CONFIRMED {"items":[{"sku":"X","quantity":1}],"customer_name":"A"}')


def test_place_agent_order_creates_draft_order(monkeypatch):
    from pulse_api import tasks
    calls = []

    def fake_store(method, path, **kwargs):
        calls.append((path, kwargs))
        if path == "product_variants":
            return [{"id": "variant-1", "sku": "TEE-BLK-L"}]
        return {"order_id": "abcdef12-0000", "total_minor": 255000, "delivery_minor": 0,
                "currency": "BDT", "existing": False,
                "lines": [{"title": "Pulse Cotton Tee", "options": {"Color": "Black", "Size": "L"},
                           "quantity": 3, "line_total_minor": 255000}]}
    monkeypatch.setattr(agent, "service_request", fake_store)
    monkeypatch.setattr(tasks, "service_request", fake_store)
    job = {"id": "job-1", "tenant_id": "tenant-1", "conversation_id": "conv-1"}
    proposal = {"items": [{"sku": "tee-blk-l", "quantity": 3}], "customer_name": "Rahim",
                "customer_phone": "017", "delivery_address": "Dhaka"}
    reply, handoff = tasks._place_agent_order(job, proposal, bengali=True)
    assert not handoff
    assert "#ABCDEF12" in reply and "2,550 BDT" in reply and "গ্রহণ" in reply
    rpc = calls[-1]
    assert rpc[0] == "rpc/pulse_agent_create_order"
    assert rpc[1]["body"]["p_items"] == [{"variant_id": "variant-1", "quantity": 3}]
    assert rpc[1]["body"]["p_agent_job_id"] == "job-1"
    assert calls[0][1]["params"]["tenant_id"] == "eq.tenant-1"


def test_place_agent_order_hands_off_on_unknown_sku(monkeypatch):
    from pulse_api import tasks
    monkeypatch.setattr(agent, "service_request", lambda *a, **k: [])
    reply, handoff = tasks._place_agent_order(
        {"id": "j", "tenant_id": "t", "conversation_id": "c"},
        {"items": [{"sku": "NOPE", "quantity": 1}], "customer_name": "A",
         "customer_phone": "1", "delivery_address": "B"}, bengali=False)
    assert handoff and "team member" in reply


def test_known_customer_details_reach_prompt():
    profile = {"display_name": "Rahim", "phone": "01700000000", "delivery_address": "Mirpur, Dhaka"}
    system = agent._messages({"business_name": "T"}, "order again", [], [], profile)[0]["content"]
    assert "KNOWN CUSTOMER" in system and "Mirpur, Dhaka" in system and "01700000000" in system
    blank = agent._messages({"business_name": "T"}, "hi", [], [],
                            {"display_name": "Customer", "phone": "", "delivery_address": ""})[0]["content"]
    assert "KNOWN CUSTOMER (" not in blank


def test_draft_confirmation_does_not_claim_confirmed():
    result = {"order_id": "abcdef12", "currency": "BDT", "delivery_minor": 0, "total_minor": 100,
              "lines": [{"title": "Tee", "options": {}, "quantity": 1, "line_total_minor": 100}]}
    text = agent.order_confirmation(result, bengali=False)
    assert "received" in text and "confirmed!" not in text


def test_catalog_without_product_match_returns_overview(monkeypatch):
    def fake_store(method, path, **kwargs):
        if path == "tenants":
            return [{"currency_code": "BDT"}]
        if path == "products":
            return [{"id": "p1", "title": "Canvas tote", "description": "Bag"},
                    {"id": "p2", "title": "Desk clock", "description": "Clock"}]
        return [{"product_id": "p1", "regular_price_minor": 185000, "offer_price_minor": None, "stock": 4},
                {"product_id": "p2", "regular_price_minor": 125000, "offer_price_minor": 99000, "stock": 0}]
    monkeypatch.setattr(agent, "service_request", fake_store)
    facts = agent.catalog_facts("tenant-1", "hi, how much is delivery?")
    assert facts == [
        {"title": "Canvas tote", "from_price": "1850.00 BDT", "in_stock": True, "overview": True},
        {"title": "Desk clock", "from_price": "990.00 BDT", "in_stock": False, "overview": True},
    ]


def test_prompt_hides_handoff_text_and_drops_which_product_loop():
    config = {**agent.DEFAULT_DRAFT, "business_name": "Nook", "media_reply": "HANDOFF-SENTENCE",
              "media_reply_bangla": "BANGLA-HANDOFF"}
    system = agent._messages(config, "hello", [], [])[0]["content"]
    assert "HANDOFF-SENTENCE" not in system and "BANGLA-HANDOFF" not in system
    assert "ask which product the customer means" not in system
    assert "Never repeat one of your earlier replies" in system


def test_banglish_rule_follows_language_settings():
    base = {**agent.DEFAULT_DRAFT, "business_name": "Nook"}
    assert "Banglish" not in agent._messages(base, "hi", [], [])[0]["content"]
    on = agent._messages({**base, "language_v2": True}, "hi", [], [])[0]["content"]
    assert "reply in Bangla script" in on
    english = agent._messages({**base, "language": "english", "language_v2": True}, "hi", [], [])[0]["content"]
    assert "Always reply in English" in english and "reply in Bangla script" not in english


def test_unclosed_think_block_is_stripped(monkeypatch):
    settings = SimpleNamespace(pulse_llm_chat_url="https://model.example/v1/chat/completions",
        pulse_llm_model="qwen3", pulse_llm_api_key="", pulse_llm_disable_thinking=False)
    monkeypatch.setattr(agent, "get_settings", lambda: settings)
    content = "<think>a</think>Hello there!<think>still thinking about"
    transport = httpx.MockTransport(lambda request: httpx.Response(
        200, json={"choices": [{"message": {"content": content}}]}))
    real_client = httpx.Client
    monkeypatch.setattr(agent.httpx, "Client", lambda **kwargs: real_client(transport=transport))
    assert agent.generate_reply({**agent.DEFAULT_DRAFT, "business_name": "Test"}, "Hi", []) == "Hello there!"


def test_draft_keeps_language_fields():
    draft = main.AgentDraft(business_name="Nook", language_v2=True,
                            media_reply_bangla="একজন সদস্য সাহায্য করবেন", media_reply_english="A teammate will help")
    dumped = draft.model_dump()
    assert dumped["language_v2"] is True
    assert dumped["media_reply_bangla"] and dumped["media_reply_english"]


def test_media_reply_uses_configured_language():
    config = {"media_reply": "default", "media_reply_bangla": "বাংলা", "media_reply_english": "english"}
    assert agent.media_reply_for({**config, "language": "bangla"}) == "বাংলা"
    assert agent.media_reply_for({**config, "language": "english"}) == "english"
    assert agent.media_reply_for({**config, "language": "auto"}, "দাম কত?") == "বাংলা"
    assert agent.media_reply_for({**config, "language": "auto"}, "price?") == "default"
    assert agent.media_reply_for({"media_reply": "default", "language": "bangla"}) == "default"
    assert agent.media_reply_for(None) == "I am passing this to a team member who can help."


def test_banglish_turn_gets_language_hint():
    config = {**agent.DEFAULT_DRAFT, "business_name": "Nook", "language_v2": True}
    assert agent.looks_banglish("delivery charge koto?")
    assert not agent.looks_banglish("what is the delivery charge?")
    assert not agent.looks_banglish("ডেলিভারি চার্জ কত?")
    assert "LATEST MESSAGE IS BANGLISH" in agent._messages(config, "tote ta ache?", [], [])[0]["content"]
    assert "LATEST MESSAGE IS BANGLISH" not in agent._messages(config, "is the tote available?", [], [])[0]["content"]
    off = agent._messages({**config, "language_v2": False}, "tote ta ache?", [], [])
    assert "LATEST MESSAGE IS BANGLISH" not in off[0]["content"] and len(off) == 2


def test_auto_language_follows_latest_message():
    config = {**agent.DEFAULT_DRAFT, "business_name": "Nook"}
    assert "LATEST MESSAGE IS ENGLISH" in agent._messages(config, "do you have the speaker?", [], [])[0]["content"]
    assert "LATEST MESSAGE IS BANGLA" in agent._messages(config, "স্পিকার আছে?", [], [])[0]["content"]
    fixed = agent._messages({**config, "language": "bangla"}, "do you have the speaker?", [], [])[0]["content"]
    assert "LATEST MESSAGE IS" not in fixed
