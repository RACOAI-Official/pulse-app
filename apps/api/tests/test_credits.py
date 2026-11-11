import pytest

from pulse_api import billing, tasks

JOB = {"id": "job-1", "tenant_id": "tenant-1", "conversation_id": "conv-1", "kind": "text",
       "first_at": "2026-11-11T00:00:00Z"}


@pytest.fixture
def worker(monkeypatch):
    state = {"requests": [], "consumed": [], "refunded": [], "tickets": [], "llm": 0,
             "balance": 1, "llm_error": False, "access": True}

    def service_request(method, path, **kwargs):
        state["requests"].append((method, path, kwargs.get("body")))
        if path == "rpc/pulse_claim_agent_job":
            return dict(JOB)
        if path == "messages":
            return [{"id": "m1", "body": "price of tee?", "created_at": JOB["first_at"]}]
        if path == "rpc/pulse_complete_agent_job":
            return None
        return []

    def consume(tenant, source):
        state["consumed"].append(source)
        if state["balance"] <= 0:
            return False
        state["balance"] -= 1
        return True

    def generate_reply(*_args):
        state["llm"] += 1
        if state["llm_error"]:
            raise RuntimeError("model down")
        return "It costs 500 taka."

    monkeypatch.setattr(tasks, "service_request", service_request)
    monkeypatch.setattr(billing, "has_access", lambda _: state["access"])
    monkeypatch.setattr(billing, "consume_credit", consume)
    monkeypatch.setattr(billing, "refund_credit", lambda tenant, source: state["refunded"].append(source))
    monkeypatch.setattr(tasks, "config_for_tenant", lambda _: {"enabled": True, "published": {"x": 1}})
    monkeypatch.setattr(tasks, "recent_history", lambda *_: [])
    monkeypatch.setattr(tasks, "catalog_facts", lambda *_: [])
    monkeypatch.setattr(tasks, "_customer_profile", lambda _: None)
    monkeypatch.setattr(tasks, "generate_reply", generate_reply)
    monkeypatch.setattr(tasks, "extract_order", lambda _: None)
    monkeypatch.setattr(tasks, "_handoff_ticket", lambda tenant, conv: state["tickets"].append(conv))
    monkeypatch.setattr(tasks, "_dispatch_outbound", lambda _: None)
    monkeypatch.setattr(tasks, "_publish", lambda _: None)
    return state


def test_ai_reply_spends_one_credit(worker):
    tasks.process_agent_job("job-1")
    assert worker["consumed"] == ["job-1"] and worker["llm"] == 1 and worker["balance"] == 0
    assert worker["refunded"] == []


def test_out_of_credits_pauses_ai_and_hands_off(worker):
    worker["balance"] = 0
    tasks.process_agent_job("job-1")
    assert worker["llm"] == 0
    assert ("PATCH", "agent_jobs", {"status": "cancelled"}) in worker["requests"]
    assert worker["tickets"] == ["conv-1"]


def test_model_failure_refunds_credit(worker):
    worker["llm_error"] = True
    tasks.process_agent_job("job-1")
    assert worker["refunded"] == ["job-1"]


def test_expired_plan_skips_ai_without_charging(worker):
    worker["access"] = False
    tasks.process_agent_job("job-1")
    assert worker["consumed"] == [] and worker["llm"] == 0


def test_roll_cycles_sends_configured_allowances(monkeypatch):
    sent = {}
    monkeypatch.setattr(billing, "service_request", lambda method, path, **kw: sent.update(path=path, **kw) or 3)
    assert billing.roll_credit_cycles() == 3
    assert sent["path"] == "rpc/pulse_credit_roll_cycles"
    assert sent["body"] == {"p_allowances": {"pro": 4000, "enterprise": 15000}}
