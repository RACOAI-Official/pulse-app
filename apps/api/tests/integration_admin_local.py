"""Opt-in admin dashboard check against a local Supabase + Redis stack.

Run from the repository root with `PYTHONPATH=apps/api apps/api/.venv/bin/python
apps/api/tests/integration_admin_local.py`. Creates uniquely named local fixture users and a tenant.
"""

import asyncio
from uuid import uuid4

import httpx

from pulse_api.billing import consume_credit, effective_plan, has_access
from pulse_api.main import app
from pulse_api.settings import get_settings
from pulse_api.store import eq, service_auth_request, service_request


def account(email: str, password: str = "") -> tuple[str, str]:
    settings = get_settings()
    password = password or f"Local-test-{uuid4().hex}!"
    user = service_auth_request("POST", "admin/users", body={"email": email, "password": password, "email_confirm": True})
    token = httpx.post(f"{settings.supabase_url}/auth/v1/token?grant_type=password",
                       headers={"apikey": settings.supabase_anon_key},
                       json={"email": email, "password": password}).json()["access_token"]
    return user["id"], token


async def main():
    settings = get_settings()
    assert settings.supabase_url.startswith("http://127.0.0.1:"), "Local stack only"
    suffix = uuid4().hex[:8]
    operator_id, operator_token = account(f"admin-op-{suffix}@example.test")
    service_request("POST", "platform_operators", body={"user_id": operator_id})
    owner_password = f"Local-owner-{uuid4().hex}!"
    owner_id, owner_token = account(f"admin-owner-{suffix}@example.test", owner_password)
    tenant = service_request("POST", "tenants", body={"name": f"Admin Probe {suffix}"},
                             prefer="return=representation")[0]
    service_request("POST", "memberships", body={"tenant_id": tenant["id"], "user_id": owner_id, "role": "owner"})
    tid = tenant["id"]
    op = {"Authorization": f"Bearer {operator_token}"}
    own = {"Authorization": f"Bearer {owner_token}"}

    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://local") as c:
        # Non-operators cannot see the admin API at all.
        for path in ("/admin/me", "/admin/overview", "/admin/businesses", f"/admin/businesses/{tid}"):
            assert (await c.get(path, headers=own)).status_code == 404, path
        assert (await c.post(f"/admin/businesses/{tid}/credits", headers=own,
                             json={"amount": 5, "note": "x" * 5, "idempotency_key": str(uuid4())})).status_code == 404
        assert (await c.get("/admin/overview")).status_code == 401

        me = (await c.get("/admin/me", headers=op)).json()
        assert me["operator"] is True
        overview = (await c.get("/admin/overview", headers=op)).json()
        assert overview["businesses"] >= 1 and "revenue_30d" in overview
        found = (await c.get("/admin/businesses", headers=op, params={"q": f"admin probe {suffix}"})).json()
        assert found["total"] == 1 and found["rows"][0]["owner_email"] == f"admin-owner-{suffix}@example.test", found
        users = (await c.get("/admin/users", headers=op, params={"q": f"admin-op-{suffix}"})).json()
        assert users["rows"][0]["is_operator"] is True
        assert (await c.get("/admin/payments", headers=op, params={"state": "paid"})).status_code == 200

        # Bonus credits: grant, idempotent replay, overdraw rejected, deduct.
        key = str(uuid4())
        grant = await c.post(f"/admin/businesses/{tid}/credits", headers=op,
                             json={"amount": 50, "note": "launch promo", "idempotency_key": key})
        assert grant.json() == {"bonus_balance": 50, "replayed": False}, grant.text
        replay = await c.post(f"/admin/businesses/{tid}/credits", headers=op,
                              json={"amount": 50, "note": "launch promo", "idempotency_key": key})
        assert replay.json() == {"bonus_balance": 50, "replayed": True}, replay.text
        over = await c.post(f"/admin/businesses/{tid}/credits", headers=op,
                            json={"amount": -51, "note": "too much", "idempotency_key": str(uuid4())})
        assert over.status_code == 400 and "bonus balance" in over.json()["detail"], over.text
        deduct = await c.post(f"/admin/businesses/{tid}/credits", headers=op,
                              json={"amount": -10, "note": "correction", "idempotency_key": str(uuid4())})
        assert deduct.json()["bonus_balance"] == 40

        # Spend order: drain plan credits, then bonus is used.
        service_request("PATCH", "credit_accounts", params={"tenant_id": eq(tid)}, body={"balance": 0})
        assert consume_credit(tid, f"admin-probe-{suffix}")
        ledger = service_request("GET", "credit_ledger", params={
            "tenant_id": eq(tid), "reason": "eq.ai_reply", "select": "bucket"})
        assert ledger == [{"bucket": "bonus"}], ledger
        detail = (await c.get(f"/admin/businesses/{tid}", headers=op)).json()
        assert detail["credits"]["bonus_balance"] == 39 and len(detail["ledger"]) >= 3
        assert detail["members"][0]["email"] == f"admin-owner-{suffix}@example.test"

        # Owner sees bonus on their Plan page payload.
        plan = (await c.get(f"/tenants/{tid}/billing", headers=own)).json()
        assert plan["credits"]["bonus_balance"] == 39, plan.get("credits")

        # Suspend: owner writes blocked (Plan too), reads still work, worker access off.
        assert (await c.post(f"/admin/businesses/{tid}/suspend", headers=op, json={"reason": ""})).status_code == 422
        suspended = await c.post(f"/admin/businesses/{tid}/suspend", headers=op, json={"reason": "chargeback review"})
        assert suspended.json()["suspended_at"], suspended.text
        blocked = await c.post(f"/tenants/{tid}/commerce/currency", headers=own, json={"currency": "USD"})
        assert blocked.status_code == 403 and "suspended" in blocked.json()["detail"], blocked.text
        blocked_plan = await c.post(f"/tenants/{tid}/billing/checkout", headers=own, json={"plan": "pro"})
        assert blocked_plan.status_code == 403, blocked_plan.text
        assert (await c.get(f"/tenants/{tid}/commerce/config", headers=own)).status_code == 200
        mine = (await c.get("/me/tenants", headers=own)).json()
        assert mine[0]["tenants"]["suspended_reason"] == "chargeback review", mine
        assert has_access(tid) is False
        listed = (await c.get("/admin/businesses", headers=op, params={"status": "suspended", "q": tid})).json()
        assert listed["total"] == 1

        restored = await c.post(f"/admin/businesses/{tid}/unsuspend", headers=op, json={})
        assert restored.json()["suspended_at"] is None, restored.text
        assert has_access(tid) is True
        ok = await c.post(f"/tenants/{tid}/commerce/currency", headers=own, json={"currency": "USD"})
        assert ok.status_code == 200, ok.text

        audit = (await c.get("/admin/audit", headers=op)).json()
        mine_audit = [row["action"] for row in audit["rows"] if row["tenant_id"] == tid]
        assert mine_audit == ["unsuspend", "suspend", "credits_deduct", "credits_grant"], mine_audit
        assert all(row["actor_email"] == f"admin-op-{suffix}@example.test" for row in audit["rows"]
                   if row["tenant_id"] == tid)
        credits = (await c.get("/admin/credits", headers=op, params={"tenant_id": tid, "reason": "admin_grant"})).json()
        assert credits["total"] == 1 and credits["rows"][0]["note"] == "launch promo"

        # Assigned plans: Starter for 2 months gates seats and WhatsApp; revoke drops to free.
        assert effective_plan(tid) is None
        bad = await c.post(f"/admin/businesses/{tid}/plan", headers=op, json={"plan": "pro", "months": 30, "reason": "pilot"})
        assert bad.status_code == 422
        assert (await c.post(f"/admin/businesses/{tid}/plan", headers=own,
                             json={"plan": "pro", "months": 1, "reason": "self"})).status_code == 404
        assigned = await c.post(f"/admin/businesses/{tid}/plan", headers=op,
                                json={"plan": "starter", "months": 2, "reason": "pilot partner"})
        assert assigned.status_code == 200 and assigned.json()["plan_key"] == "starter", assigned.text
        assert effective_plan(tid) == "starter"
        page = (await c.get(f"/tenants/{tid}/billing", headers=own)).json()
        assert page["grant"]["plan_key"] == "starter" and page["effective_plan"] == "starter", page
        assert page["credits"]["balance"] == 1000 and page["seat_limit"] == 1
        assert [plan["key"] for plan in page["plans"]] == ["starter", "pro", "enterprise"]
        seat = await c.post(f"/tenants/{tid}/invites", headers=own, json={"email": f"staff-{suffix}@example.test"})
        assert seat.status_code == 402 and "Starter" in seat.json()["detail"], seat.text
        upgraded = await c.post(f"/admin/businesses/{tid}/plan", headers=op,
                                json={"plan": "enterprise", "months": 6, "reason": "upgrade pilot"})
        assert upgraded.json()["plan_key"] == "enterprise" and effective_plan(tid) == "enterprise"
        detail = (await c.get(f"/admin/businesses/{tid}", headers=op)).json()
        assert detail["operator_grant"]["plan_key"] == "enterprise" and detail["operator_grant"]["months"] == 6
        assert detail["credits"]["balance"] == 12000
        assert (await c.post(f"/admin/businesses/{tid}/plan/revoke", headers=op, json={})).status_code == 422
        revoked = await c.post(f"/admin/businesses/{tid}/plan/revoke", headers=op, json={"reason": "pilot ended"})
        assert revoked.json()["revoked"] == "enterprise" and revoked.json()["effective_plan"] is None, revoked.text
        assert effective_plan(tid) is None
        page = (await c.get(f"/tenants/{tid}/billing", headers=own)).json()
        assert page["grant"] is None and page["credits"]["balance"] == 0
        again = await c.post(f"/admin/businesses/{tid}/plan/revoke", headers=op, json={"reason": "pilot ended"})
        assert again.status_code >= 400
        audit = (await c.get("/admin/audit", headers=op)).json()
        assert [row["action"] for row in audit["rows"] if row["tenant_id"] == tid][:3] == [
            "plan_revoke", "plan_assign", "plan_assign"]

        # Password change: wrong current rejected; new password works, old one fails.
        wrong = await c.post("/me/password", headers=own, json={"current_password": "nope", "new_password": "Brand-new-pass-1"})
        assert wrong.status_code == 400, wrong.text
        new_password = f"Changed-{uuid4().hex}!"
        changed = await c.post("/me/password", headers=own,
                               json={"current_password": owner_password, "new_password": new_password})
        assert changed.json() == {"status": "updated"}, changed.text
        async with httpx.AsyncClient() as raw:
            login = lambda pw: raw.post(f"{settings.supabase_url}/auth/v1/token?grant_type=password",
                                        headers={"apikey": settings.supabase_anon_key},
                                        json={"email": f"admin-owner-{suffix}@example.test", "password": pw})
            assert (await login(owner_password)).status_code == 400
            fresh = await login(new_password)
            assert fresh.status_code == 200
            owner_token = fresh.json()["access_token"]

        # Owner cannot read the audit table or call admin RPCs directly through PostgREST.
        async with httpx.AsyncClient() as raw:
            headers = {"apikey": settings.supabase_anon_key, "Authorization": f"Bearer {owner_token}"}
            direct = await raw.get(f"{settings.supabase_url}/rest/v1/admin_audit_log", headers=headers)
            assert direct.status_code in (401, 403), direct.status_code
            rpc = await raw.post(f"{settings.supabase_url}/rest/v1/rpc/pulse_admin_adjust_credits", headers=headers,
                                 json={"p_tenant_id": tid, "p_amount": 999, "p_note": "self grant",
                                       "p_idempotency_key": str(uuid4())})
            assert rpc.status_code == 403 and "Operator" in rpc.text, (rpc.status_code, rpc.text)
    print("PASS: operator gate, lists, bonus grant/replay/deduct, spend order, suspend/unsuspend, audit, "
          "plan assign/upgrade/revoke, seat gate, password change, direct-DB denial")


if __name__ == "__main__":
    asyncio.run(main())
