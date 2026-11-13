from datetime import datetime, timezone

from pulse_api import tasks


def test_new_agent_job_is_queued_for_its_due_time(monkeypatch):
    queued = []
    requested = []
    due_at = "2026-11-13T08:00:03+00:00"

    def request(method, path, **kwargs):
        requested.append((method, path, kwargs["params"]))
        return [{"id": "job-1", "due_at": due_at}]

    monkeypatch.setattr(tasks, "service_request", request)
    monkeypatch.setattr(tasks.process_agent_job, "apply_async", lambda **kwargs: queued.append(kwargs))

    tasks._dispatch_agent_job("message-1")

    assert requested == [("GET", "agent_jobs", {
        "source_message_id": "eq.message-1", "select": "id,due_at", "limit": "1",
    })]
    assert queued == [{"args": ["job-1"], "eta": datetime(2026, 11, 13, 8, 0, 3, tzinfo=timezone.utc)}]


def test_agent_dispatch_failure_leaves_job_for_reconciler(monkeypatch):
    def request(*_args, **_kwargs):
        raise RuntimeError("temporary database error")

    monkeypatch.setattr(tasks, "service_request", request)

    tasks._dispatch_agent_job("message-1")
    assert tasks.celery_app.conf.beat_schedule["reconcile-agent"]["schedule"] == 30.0


def test_webhook_dispatches_new_agent_job(monkeypatch):
    dispatched = []
    event = {"connection_id": "connection-1", "tenant_id": "tenant-1",
             "payload": {"provider_id": "provider-1", "sender_id": "customer-1", "body": "Hi"}}

    def request(method, path, **_kwargs):
        if path == "rpc/pulse_claim_webhook":
            return event
        if path == "messages":
            return []
        if path == "rpc/pulse_record_inbound":
            return "message-1"
        return None

    monkeypatch.setattr(tasks, "service_request", request)
    monkeypatch.setattr(tasks, "_connection", lambda _: {"id": "connection-1", "channel": "instagram"})
    monkeypatch.setattr(tasks, "_token", lambda _: "token")
    monkeypatch.setattr(tasks, "config_for_tenant", lambda _: {"enabled": True})
    monkeypatch.setattr(tasks, "_dispatch_agent_job", dispatched.append)
    monkeypatch.setattr(tasks, "_publish", lambda _: None)

    tasks.process_webhook("event-1")

    assert dispatched == ["message-1"]
