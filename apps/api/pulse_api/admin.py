"""Platform back office for Pulse operators (rows in platform_operators).

The API hides the routes from everyone else (404); each DB function re-checks the operator
and records admin_audit_log in the same transaction, with the actor taken from auth.uid().
"""

import asyncio
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, field_validator

from . import billing
from .deps import Session, user_limit
from .store import eq, user_request

PAGE_SIZE = 50

router = APIRouter(prefix="/admin", tags=["admin"])


async def operator(auth: Session) -> tuple[str, dict]:
    rows = await user_request("GET", "platform_operators", auth[0], params={
        "user_id": eq(auth[1]["id"]), "select": "user_id", "limit": "1",
    })
    if not rows:
        raise HTTPException(404, "Not Found")
    return auth


Operator = Annotated[tuple[str, dict], Depends(operator)]
Page = Annotated[int, Query(ge=1, le=10_000)]
Search = Annotated[str, Query(max_length=120)]


def _paging(page: int) -> dict:
    return {"p_limit": PAGE_SIZE, "p_offset": (page - 1) * PAGE_SIZE}


async def _rpc(name: str, token: str, body: dict):
    return await user_request("POST", f"rpc/{name}", token, body=body)


class CreditAdjust(BaseModel):
    amount: int = Field(ge=-1_000_000, le=1_000_000, description="Positive adds, negative deducts bonus credits")
    note: str = Field(min_length=3, max_length=500)
    idempotency_key: UUID

    @field_validator("amount")
    @classmethod
    def non_zero(cls, value: int) -> int:
        if value == 0:
            raise ValueError("Amount cannot be zero")
        return value

    @field_validator("note")
    @classmethod
    def trimmed(cls, value: str) -> str:
        value = value.strip()
        if len(value) < 3:
            raise ValueError("A reason of 3 to 500 characters is required")
        return value


class SuspendInput(BaseModel):
    reason: str = Field(min_length=3, max_length=500)


class UnsuspendInput(BaseModel):
    reason: str = Field(default="", max_length=500)


@router.get("/me")
async def me(auth: Operator) -> dict:
    return {"operator": True, "email": auth[1].get("email")}


@router.get("/overview")
async def overview(auth: Operator) -> dict:
    return await _rpc("pulse_admin_overview", auth[0], {})


@router.get("/businesses")
async def businesses(auth: Operator, q: Search = "",
                     status: Literal["all", "paid", "trialing", "expired", "suspended"] = "all",
                     page: Page = 1) -> dict:
    return await _rpc("pulse_admin_businesses", auth[0], {"p_q": q, "p_status": status, **_paging(page)})


@router.get("/businesses/{tenant_id}")
async def business(tenant_id: UUID, auth: Operator) -> dict:
    return await _rpc("pulse_admin_business", auth[0], {"p_tenant_id": str(tenant_id)})


@router.post("/businesses/{tenant_id}/credits", dependencies=[user_limit("admin-write", 60, 60)])
async def adjust_credits(tenant_id: UUID, data: CreditAdjust, auth: Operator) -> dict:
    return await _rpc("pulse_admin_adjust_credits", auth[0], {
        "p_tenant_id": str(tenant_id), "p_amount": data.amount, "p_note": data.note,
        "p_idempotency_key": str(data.idempotency_key),
    })


@router.post("/businesses/{tenant_id}/suspend", dependencies=[user_limit("admin-write", 60, 60)])
async def suspend(tenant_id: UUID, data: SuspendInput, auth: Operator) -> dict:
    return await _rpc("pulse_admin_set_suspended", auth[0], {
        "p_tenant_id": str(tenant_id), "p_suspended": True, "p_reason": data.reason.strip(),
    })


@router.post("/businesses/{tenant_id}/unsuspend", dependencies=[user_limit("admin-write", 60, 60)])
async def unsuspend(tenant_id: UUID, data: UnsuspendInput, auth: Operator) -> dict:
    return await _rpc("pulse_admin_set_suspended", auth[0], {
        "p_tenant_id": str(tenant_id), "p_suspended": False, "p_reason": data.reason.strip() or None,
    })


@router.get("/users")
async def users(auth: Operator, q: Search = "", page: Page = 1) -> dict:
    return await _rpc("pulse_admin_users", auth[0], {"p_q": q, **_paging(page)})


@router.get("/payments")
async def payments(auth: Operator,
                   provider: Literal["stripe", "sslcommerz"] | None = None,
                   state: Literal["pending", "paid", "failed", "review"] | None = None,
                   page: Page = 1) -> dict:
    return await _rpc("pulse_admin_payments", auth[0], {"p_provider": provider, "p_state": state, **_paging(page)})


@router.get("/credits")
async def credit_ledger(auth: Operator,
                        reason: Literal["trial", "cycle_grant", "upgrade_topup", "ai_reply", "refund",
                                        "admin_grant", "admin_deduct"] | None = None,
                        tenant_id: UUID | None = None, page: Page = 1) -> dict:
    return await _rpc("pulse_admin_credits", auth[0], {
        "p_reason": reason, "p_tenant_id": str(tenant_id) if tenant_id else None, **_paging(page),
    })


@router.get("/audit")
async def audit(auth: Operator, page: Page = 1) -> dict:
    return await _rpc("pulse_admin_audit", auth[0], _paging(page))


class PriceInput(BaseModel):
    plan: Literal["pro", "enterprise"]
    interval: Literal["month", "year"]
    currency: Literal["USD", "GBP", "BDT"]
    amount_minor: int = Field(ge=100, le=1_000_000_000, description="Minor units: cents, pence or paisa")
    request_id: UUID


class TrialCreditsInput(BaseModel):
    credits: int = Field(ge=0, le=100_000)


def _price_table() -> list[dict]:
    live = billing.live_prices(fresh=True)
    table = []
    for plan in billing.PLANS:
        for interval in billing.INTERVALS:
            for currency in billing.CURRENCIES:
                row = live.get((plan, interval, currency))
                table.append({
                    "plan": plan, "interval": interval, "currency": currency,
                    "amount_minor": int(row["amount_minor"]) if row else billing.default_price(plan, interval, currency),
                    "default_minor": billing.default_price(plan, interval, currency),
                    "source": "admin" if row else "default",
                    "stripe_price_id": ((row or {}).get("stripe_price_id") if row
                                        else billing.default_stripe_price_id(plan, interval, currency)) or None,
                    "updated_at": (row or {}).get("created_at"),
                })
    return table


@router.get("/plans")
async def plans(auth: Operator) -> dict:
    data = await _rpc("pulse_admin_plans", auth[0], {})
    table = await asyncio.to_thread(_price_table)
    return {"prices": table, "trial_credits": data["trial_credits"], "history": data["history"],
            "credits": {plan: billing.allowance(plan) for plan in billing.PLANS},
            "stripe_configured": billing.providers()["stripe"]}


def _new_stripe_price(data: PriceInput) -> str:
    """Stripe prices are immutable: create a new one on the plan's existing product."""
    current = billing.stripe_price_id(data.plan, data.interval, data.currency)
    if not current:
        raise HTTPException(409, "This plan has no Stripe price yet. Set its PULSE_STRIPE_PRICE_* ID first")
    product = billing.stripe("GET", f"prices/{current}").get("product")
    product = product.get("id") if isinstance(product, dict) else product
    if not product:
        raise HTTPException(502, "Could not read the Stripe product for this plan")
    created = billing.stripe("POST", "prices", key=f"pulse-price-{data.request_id}", data={
        "product": product, "unit_amount": str(data.amount_minor), "currency": data.currency.lower(),
        "recurring[interval]": data.interval, "nickname": f"Pulse {billing.NAMES[data.plan]} {data.interval}",
        "metadata[plan_key]": data.plan, "metadata[interval]": data.interval})
    return created["id"]


@router.put("/plans/price", dependencies=[user_limit("admin-write", 60, 60)])
async def set_price(data: PriceInput, auth: Operator) -> dict:
    billing.clear_price_cache()
    if data.amount_minor == await asyncio.to_thread(billing.price, data.plan, data.interval, data.currency):
        raise HTTPException(409, "That is already the current price")
    stripe_id = None
    if data.currency in billing.STRIPE_CURRENCIES:
        stripe_id = await asyncio.to_thread(_new_stripe_price, data)
    result = await _rpc("pulse_admin_set_price", auth[0], {
        "p_plan": data.plan, "p_interval": data.interval, "p_currency": data.currency,
        "p_amount": data.amount_minor, "p_stripe_price_id": stripe_id, "p_request_id": str(data.request_id)})
    billing.clear_price_cache()
    return {**result, "stripe_price_id": stripe_id}


@router.put("/plans/trial-credits", dependencies=[user_limit("admin-write", 60, 60)])
async def set_trial_credits(data: TrialCreditsInput, auth: Operator) -> dict:
    return await _rpc("pulse_admin_set_trial_credits", auth[0], {"p_credits": data.credits})
