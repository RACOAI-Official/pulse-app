"""Platform back office for Pulse operators (rows in platform_operators).

The API hides the routes from everyone else (404); each DB function re-checks the operator
and records admin_audit_log in the same transaction, with the actor taken from auth.uid().
"""

from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, field_validator

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
