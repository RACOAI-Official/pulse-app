import json
from uuid import UUID

import pytest
from fastapi import HTTPException

from pulse_api import agent, billing, meta_oauth, onboarding

TENANT = UUID("00000000-0000-0000-0000-000000000001")
AUTH = ("token", {"id": "user-1", "email": "owner@shop.com"})


class FakeRedis:
    def __init__(self):
        self.data = {}

    async def set(self, key, value, ex=None):
        self.data[key] = value
        return True

    async def get(self, key):
        return self.data.get(key)

    async def getdel(self, key):
        return self.data.pop(key, None)

    async def aclose(self):
        pass


@pytest.fixture
def owner_ok(monkeypatch):
    async def fake_owner(tenant_id, token):
        return {"role": "owner"}
    monkeypatch.setattr(onboarding, "owner", fake_owner)
    monkeypatch.setattr(onboarding, "membership", fake_owner)
    monkeypatch.setattr(meta_oauth, "owner", fake_owner)


def tenant_store(monkeypatch, step="plan"):
    state = {"step": step, "patches": []}

    def service_request(method, path, **kw):
        if path == "tenants" and method == "GET":
            return [{"id": str(TENANT), "name": "Shop", "onboarding_step": state["step"],
                     "onboarding_completed_at": None}]
        if path == "tenants" and method == "PATCH":
            state["patches"].append(kw["body"])
            state["step"] = kw["body"].get("onboarding_step", state["step"])
            return None
        raise AssertionError(path)
    monkeypatch.setattr(onboarding, "service_request", service_request)
    return state


@pytest.mark.asyncio
async def test_trial_cannot_enter_paid_steps(monkeypatch, owner_ok):
    state = tenant_store(monkeypatch)
    monkeypatch.setattr(billing, "account", lambda _: {"state": "trialing", "paid_through": None})
    with pytest.raises(HTTPException) as blocked:
        await onboarding.move(TENANT, onboarding.FlowInput(step="integrations"), AUTH)
    assert blocked.value.status_code == 402 and state["step"] == "plan"
    result = await onboarding.move(TENANT, onboarding.FlowInput(step="delivery"), AUTH)
    assert result == {"step": "delivery", "completed": False}


@pytest.mark.asyncio
async def test_paid_owner_reaches_integrations_and_completes(monkeypatch, owner_ok):
    state = tenant_store(monkeypatch)
    monkeypatch.setattr(billing, "account", lambda _: {"state": "active", "paid_through": "2999-01-01T00:00:00+00:00"})
    await onboarding.move(TENANT, onboarding.FlowInput(step="integrations"), AUTH)
    assert state["step"] == "integrations"
    result = await onboarding.complete(TENANT, AUTH)
    assert result["completed"] and state["patches"][-1]["onboarding_completed_at"]


@pytest.mark.asyncio
async def test_free_finishes_and_complete_needs_plan(monkeypatch, owner_ok):
    state = tenant_store(monkeypatch, step="delivery")
    with pytest.raises(HTTPException) as early:
        await onboarding.complete(TENANT, AUTH)
    assert early.value.status_code == 409
    assert (await onboarding.choose_free(TENANT, AUTH))["completed"]
    with pytest.raises(HTTPException) as again:
        await onboarding.move(TENANT, onboarding.FlowInput(step="ai"), AUTH)
    assert again.value.status_code == 409 and state["step"] == "done"


def test_delivery_input_rejects_bad_values():
    with pytest.raises(ValueError):
        onboarding.DeliveryInput(inside_dhaka_fee_minor=-1, outside_dhaka_fee_minor=0,
                                 inside_dhaka_days=1, outside_dhaka_days=2)
    with pytest.raises(ValueError):
        onboarding.DeliveryInput(inside_dhaka_fee_minor=0, outside_dhaka_fee_minor=0,
                                 inside_dhaka_days=1, outside_dhaka_days=99)


def test_delivery_facts_reach_the_prompt(monkeypatch):
    def service_request(method, path, **kw):
        if path == "delivery_settings":
            return [{"inside_dhaka_fee_minor": 6000, "outside_dhaka_fee_minor": 12000,
                     "inside_dhaka_days": 1, "outside_dhaka_days": 3, "cod_enabled": True,
                     "free_delivery_threshold_minor": 300000, "notes": "No Friday delivery"}]
        if path == "tenants":
            return [{"currency_code": "BDT"}]
        raise AssertionError(path)
    monkeypatch.setattr(agent, "service_request", service_request)
    config = agent.with_delivery({"business_name": "Shop"}, str(TENANT))
    assert config["delivery"]["inside_dhaka"] == {"fee": "60.00 BDT", "days": 1}
    assert config["delivery"]["free_delivery_from_order_total"] == "3000.00 BDT"
    system = agent._messages(config, "hi", [], None)[0]["content"]
    assert "DELIVERY:" in system and "No Friday delivery" in system


def test_delivery_absent_keeps_config(monkeypatch):
    monkeypatch.setattr(agent, "service_request", lambda *a, **k: [])
    config = {"business_name": "Shop"}
    assert agent.with_delivery(config, str(TENANT)) is config
    assert "DELIVERY:" not in agent._messages(config, "hi", [], None)[0]["content"]


def test_order_proposal_keeps_valid_zone_only():
    base = ('ORDER_CONFIRMED {"items":[{"sku":"A","quantity":1}],"customer_name":"N",'
            '"customer_phone":"017","delivery_address":"Dhaka"')
    assert agent.extract_order(base + ',"delivery_zone":"inside_dhaka"}')["delivery_zone"] == "inside_dhaka"
    assert "delivery_zone" not in agent.extract_order(base + ',"delivery_zone":"mars"}')


def test_checkout_return_path_whitelist(monkeypatch):
    with pytest.raises(ValueError):
        billing.CheckoutInput(plan="pro", return_to="https://evil.example")
    assert billing.CheckoutInput(plan="pro", return_to="onboarding").return_to == "onboarding"
    sent = {}
    monkeypatch.setattr(billing, "stripe_price_id", lambda *a: "price_1")
    monkeypatch.setattr(billing, "stripe", lambda method, path, data=None, key=None: sent.update(data) or {})
    billing.stripe_session({"id": "c1", "tenant_id": str(TENANT), "plan_key": "pro", "billing_interval": "month",
                            "currency_code": "USD", "auto_renew": True, "return_path": "/onboarding"}, "cus_1")
    assert sent["success_url"].endswith("/onboarding?return=success")
    assert sent["cancel_url"].endswith("/onboarding?return=cancel")


def test_oauth_state_is_signed():
    state = meta_oauth.make_state("abc123nonce")
    assert meta_oauth.read_state(state) == "abc123nonce"
    with pytest.raises(HTTPException):
        meta_oauth.read_state("abc123nonce.deadbeef")
    with pytest.raises(HTTPException):
        meta_oauth.read_state("other.nonce" + state[state.index("."):])


@pytest.mark.asyncio
async def test_oauth_state_is_single_use(monkeypatch):
    store = FakeRedis()
    monkeypatch.setattr(meta_oauth, "_redis", lambda: store)
    store.data["oauth:state:n1"] = json.dumps({"tenant": str(TENANT), "user": "user-1",
                                                "provider": "messenger", "return_to": "onboarding"})
    state = meta_oauth.make_state("n1")
    assert (await meta_oauth._consume_state(state, "messenger"))["tenant"] == str(TENANT)
    with pytest.raises(HTTPException) as replay:
        await meta_oauth._consume_state(state, "messenger")
    assert replay.value.status_code == 400


def test_save_connection_encrypts_and_blocks_other_tenant(monkeypatch):
    calls = []

    def service_request(method, path, **kw):
        calls.append((method, kw))
        if method == "GET":
            return [{"id": "c1", "tenant_id": "someone-else"}] if kw["params"]["external_account_id"] == "eq.taken" else []
        return [{"id": "new-1"}]
    monkeypatch.setattr(meta_oauth, "service_request", service_request)
    with pytest.raises(HTTPException) as taken:
        meta_oauth.save_connection(str(TENANT), "messenger", "taken", "Page", "tok")
    assert taken.value.status_code == 409
    saved = meta_oauth.save_connection(str(TENANT), "messenger", "page-1", "My Page", "secret-token")
    body = calls[-1][1]["body"]
    assert saved["id"] == "new-1" and body["connected_via"] == "oauth"
    assert "secret-token" not in body["credential_ciphertext"]
    assert meta_oauth._fernet().decrypt(body["credential_ciphertext"].encode()).decode() == "secret-token"


@pytest.mark.asyncio
async def test_page_pick_is_bound_to_owner(monkeypatch, owner_ok):
    store = FakeRedis()
    monkeypatch.setattr(meta_oauth, "_redis", lambda: store)
    store.data["oauth:pick:p1"] = json.dumps({"tenant": str(TENANT), "user": "user-1",
                                               "pages": [{"id": "9", "name": "Shop Page", "token": "t"}]})
    assert await meta_oauth.pick_pages(TENANT, "p1", AUTH) == [{"id": "9", "name": "Shop Page"}]
    with pytest.raises(HTTPException):
        await meta_oauth.pick_pages(TENANT, "p1", ("t", {"id": "intruder"}))
