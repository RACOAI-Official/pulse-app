"""Opt-in check of admin plan prices, trial credits, the header credit status and owner alerts
against a local Supabase + Redis stack. Email/WhatsApp transports are stubbed; nothing is sent.

Run from the repository root with `PYTHONPATH=apps/api apps/api/.venv/bin/python
apps/api/tests/integration_plans_alerts_local.py`. Creates uniquely named local fixture users and tenants,
and restores the trial-credit setting and any price it changed.
"""

import asyncio
import os
from uuid import uuid4

os.environ["PULSE_NOTIFICATIONS_ENABLED"] = "true"
os.environ.setdefault("RESEND_API_KEY", "re_local_stub")

import httpx  # noqa: E402

from pulse_api import billing, notification_delivery  # noqa: E402
from pulse_api.billing import consume_credit  # noqa: E402
from pulse_api.main import app  # noqa: E402
from pulse_api.settings import get_settings  # noqa: E402
from pulse_api.store import eq, service_auth_request, service_request  # noqa: E402


def account(email: str) -> tuple[str, str]:
    settings = get_settings()
    password = f"Local-test-{uuid4().hex}!"
    user = service_auth_request("POST", "admin/users", body={"email": email, "password": password, "email_confirm": True})
    token = httpx.post(f"{settings.supabase_url}/auth/v1/token?grant_type=password",
                       headers={"apikey": settings.supabase_anon_key},
                       json={"email": email, "password": password}).json()["access_token"]
    return user["id"], token


def tenant_for(owner_id: str, name: str) -> str:
    tenant = service_request("POST", "tenants", body={"name": name}, prefer="return=representation")[0]
    service_request("POST", "memberships", body={"tenant_id": tenant["id"], "user_id": owner_id, "role": "owner"})
    return tenant["id"]


def deliveries(tenant_id: str, kind: str) -> list[dict]:
    return service_request("GET", "notification_deliveries", params={
        "tenant_id": eq(tenant_id), "kind": eq(kind), "select": "id,channel,status,destination,summary"})


async def main():
    settings = get_settings()
    assert settings.supabase_url.startswith("http://127.0.0.1:"), "Local stack only"
    suffix = uuid4().hex[:8]
    op_id, op_token = account(f"plans-op-{suffix}@example.test")
    service_request("POST", "platform_operators", body={"user_id": op_id})
    owner_id, owner_token = account(f"plans-owner-{suffix}@example.test")
    staff_id, staff_token = account(f"plans-staff-{suffix}@example.test")
    op, own, staff = ({"Authorization": f"Bearer {t}"} for t in (op_token, owner_token, staff_token))
    sent: list[tuple[str, str]] = []
    notification_delivery.send_email = lambda to, subject, *_: sent.append((to, subject)) or "resend"

    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://local") as c:
        # Plans: operator only; BDT price change shows on the owner's Plan page; replay is harmless.
        assert (await c.get("/admin/plans", headers=own)).status_code == 404
        plans = (await c.get("/admin/plans", headers=op)).json()
        row = next(r for r in plans["prices"] if (r["plan"], r["interval"], r["currency"]) == ("pro", "month", "BDT"))
        original_price, original_trial = row["amount_minor"], plans["trial_credits"]
        new_price = original_price + 12300
        key = str(uuid4())
        body = {"plan": "pro", "interval": "month", "currency": "BDT", "amount_minor": new_price, "request_id": key}
        assert (await c.put("/admin/plans/price", headers=op, json=body)).json()["replayed"] is False
        billing.clear_price_cache()
        assert (await c.put("/admin/plans/price", headers=op, json=body)).status_code == 409  # now current
        try:
            # Trial credits apply to businesses created after the change only.
            old_tid = tenant_for(owner_id, f"Plans Old {suffix}")
            assert (await c.put("/admin/plans/trial-credits", headers=op, json={"credits": 120})).status_code == 200
            tid = tenant_for(owner_id, f"Plans Probe {suffix}")
            service_request("POST", "memberships", body={"tenant_id": tid, "user_id": staff_id, "role": "staff"})
            old_credits = (await c.get(f"/tenants/{old_tid}/billing/credits", headers=own)).json()
            credits = (await c.get(f"/tenants/{tid}/billing/credits", headers=staff)).json()
            assert old_credits["allowance"] == original_trial and credits["allowance"] == 120, (old_credits, credits)
            assert credits == {"available": 120, "allowance": 120, "bonus_balance": 0,
                               "cycle_end": credits["cycle_end"], "low": False}, credits
            plan_page = (await c.get(f"/tenants/{tid}/billing", headers=own)).json()
            pro = next(p for p in plan_page["plans"] if p["key"] == "pro")
            assert pro["prices"]["month"]["BDT"] == new_price, pro
            history = (await c.get("/admin/plans", headers=op)).json()
            assert history["history"][0]["amount_minor"] == new_price
            assert history["history"][0]["actor_email"] == f"plans-op-{suffix}@example.test"
        finally:
            await c.put("/admin/plans/trial-credits", headers=op, json={"credits": original_trial})
            billing.clear_price_cache()
            await c.put("/admin/plans/price", headers=op, json={**body, "amount_minor": original_price,
                                                                 "request_id": str(uuid4())})
            billing.clear_price_cache()

        # Default alert settings: owner's sign-in email, enabled; staff cannot read them.
        prefs = (await c.get(f"/tenants/{tid}/notifications", headers=own)).json()["settings"]
        assert prefs["email"] == f"plans-owner-{suffix}@example.test" and prefs["email_enabled"], prefs
        assert (await c.get(f"/tenants/{tid}/notifications", headers=staff)).status_code == 403

        # Credits low (<=10% of 120 = 12) turns the header red and queues one alert per cycle.
        service_request("PATCH", "credit_accounts", params={"tenant_id": eq(tid)}, body={"balance": 13})
        assert consume_credit(tid, f"plans-{suffix}-1") and consume_credit(tid, f"plans-{suffix}-2")
        chip = (await c.get(f"/tenants/{tid}/billing/credits", headers=staff)).json()
        assert chip["available"] == 11 and chip["low"] is True, chip
        assert len(deliveries(tid, "credits_low")) == 1
        service_request("PATCH", "credit_accounts", params={"tenant_id": eq(tid)}, body={"balance": 1})
        assert consume_credit(tid, f"plans-{suffix}-3") and not consume_credit(tid, f"plans-{suffix}-4")
        assert len(deliveries(tid, "credits_empty")) == 1

        # Order confirmed (trigger) and AI drafted (worker RPC) alerts.
        order = service_request("POST", "commerce_orders", prefer="return=representation", body={
            "tenant_id": tid, "currency_code": "BDT", "customer_name": "Rahim", "total_minor": 255000,
            "created_by": owner_id, "state": "draft", "agent_job_id": str(uuid4())})[0]
        service_request("POST", "rpc/pulse_notify_order_drafted", body={"p_tenant": tid, "p_order": order["id"]})
        service_request("PATCH", "commerce_orders", params={"id": eq(order["id"])}, body={"state": "confirmed"})
        confirmed = deliveries(tid, "order_confirmed")
        assert len(confirmed) == 1 and confirmed[0]["summary"]["customer"] == "Rahim", confirmed
        assert len(deliveries(tid, "order_drafted")) == 1

        # Trial ending in 2 days, once.
        service_request("PATCH", "billing_accounts", params={"tenant_id": eq(tid)},
                        body={"trial_ends_at": "2099-01-01T00:00:00Z"})
        from datetime import datetime, timedelta, timezone
        soon = (datetime.now(timezone.utc) + timedelta(days=2)).isoformat()
        service_request("PATCH", "billing_accounts", params={"tenant_id": eq(tid)}, body={"trial_ends_at": soon})
        service_request("POST", "rpc/pulse_notify_billing_deadlines", body={})
        service_request("POST", "rpc/pulse_notify_billing_deadlines", body={})
        assert len(deliveries(tid, "plan_ending")) == 1

        # The worker sends every queued alert exactly once (transport stubbed).
        notification_delivery.reconcile(notification_delivery.deliver)
        for kind in ("credits_low", "credits_empty", "order_confirmed", "order_drafted", "plan_ending"):
            assert [d["status"] for d in deliveries(tid, kind)] == ["accepted"], (kind, deliveries(tid, kind))
        mine = [subject for to, subject in sent if to == f"plans-owner-{suffix}@example.test"]
        assert len(mine) == 5, mine
        notification_delivery.reconcile(notification_delivery.deliver)
        assert len([s for to, s in sent if to == f"plans-owner-{suffix}@example.test"]) == 5

        # Owner history shows them; turning email off suppresses queued ones.
        history = (await c.get(f"/tenants/{tid}/notifications/deliveries", headers=own)).json()
        assert {row["kind"] for row in history} >= {"credits_low", "order_confirmed", "plan_ending"}
        saved = await c.put(f"/tenants/{tid}/notifications", headers=own, json={
            "email": prefs["email"], "whatsapp": "+8801712345678", "email_enabled": False,
            "whatsapp_enabled": True, "language": "english", "consent": True})
        assert saved.status_code == 200, saved.text
        after = saved.json()["settings"]
        assert after["email_enabled"] is False and after["whatsapp_enabled"] is False  # WhatsApp unverified
    print("PASS: plan prices, trial credits, header credits, low/empty/confirmed/drafted/ending alerts, delivery once")


if __name__ == "__main__":
    asyncio.run(main())
