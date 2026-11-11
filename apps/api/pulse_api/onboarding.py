"""Owner onboarding wizard: business -> ai -> delivery -> plan -> (Pro) integrations -> inbox -> done."""

import asyncio
from datetime import datetime, timezone
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from .agent import config_for_tenant
from .main import Session, membership, owner
from .store import eq, service_request, user_request

router = APIRouter(prefix="/tenants/{tenant_id}", tags=["onboarding"])

STEPS = ("business", "ai", "delivery", "plan", "integrations", "inbox", "done")
PAID_STEPS = ("integrations", "inbox")
Step = Literal["business", "ai", "delivery", "plan", "integrations", "inbox"]


class FlowInput(BaseModel):
    step: Step


class BusinessInput(BaseModel):
    name: str = Field(min_length=1, max_length=120)


class DeliveryInput(BaseModel):
    inside_dhaka_fee_minor: int = Field(ge=0, le=100_000_00)
    outside_dhaka_fee_minor: int = Field(ge=0, le=100_000_00)
    inside_dhaka_days: int = Field(ge=0, le=60)
    outside_dhaka_days: int = Field(ge=0, le=60)
    cod_enabled: bool = True
    free_delivery_threshold_minor: int | None = Field(default=None, ge=0, le=100_000_000_00)
    notes: str = Field(default="", max_length=1000)


def tenant_row(tenant_id: str) -> dict:
    found = service_request("GET", "tenants", params={
        "id": eq(tenant_id), "select": "id,name,onboarding_step,onboarding_completed_at", "limit": "1",
    })
    if not found:
        raise HTTPException(404, "Tenant not found")
    return found[0]


def set_step(tenant_id: str, step: str) -> dict:
    body: dict = {"onboarding_step": step}
    if step == "done":
        body["onboarding_completed_at"] = datetime.now(timezone.utc).isoformat()
    service_request("PATCH", "tenants", params={"id": eq(tenant_id)}, body=body)
    return {"step": step, "completed": step == "done"}


def open_wizard(tenant_id: str) -> dict:
    row = tenant_row(tenant_id)
    if row["onboarding_step"] == "done":
        raise HTTPException(409, "Onboarding is already complete")
    return row


@router.get("/onboarding/flow")
async def flow(tenant_id: UUID, auth: Session) -> dict:
    await membership(tenant_id, auth[0])
    from .billing import account, is_active
    tenant = str(tenant_id)
    row, current = await asyncio.gather(asyncio.to_thread(tenant_row, tenant),
                                        asyncio.to_thread(account, tenant))
    return {"step": row["onboarding_step"], "completed": row["onboarding_step"] == "done",
            "business_name": row["name"], "plan_state": (current or {}).get("state"),
            "plan_key": (current or {}).get("plan_key"), "paid": is_active(current)}


@router.put("/onboarding/flow")
async def move(tenant_id: UUID, data: FlowInput, auth: Session) -> dict:
    await owner(tenant_id, auth[0])
    tenant = str(tenant_id)
    await asyncio.to_thread(open_wizard, tenant)
    if data.step in PAID_STEPS:
        from .billing import require_paid
        await asyncio.to_thread(require_paid, tenant)
    return await asyncio.to_thread(set_step, tenant, data.step)


@router.post("/onboarding/business")
async def business(tenant_id: UUID, data: BusinessInput, auth: Session) -> dict:
    await owner(tenant_id, auth[0])
    tenant, name = str(tenant_id), data.name.strip()
    if not name:
        raise HTTPException(422, "Business name is required")
    await asyncio.to_thread(service_request, "PATCH", "tenants", params={"id": eq(tenant)}, body={"name": name})
    current = await asyncio.to_thread(config_for_tenant, tenant)
    draft = dict(current["draft"])
    if draft.get("business_name") != name:
        draft["business_name"] = name
        await user_request("POST", "rpc/pulse_save_agent_draft", auth[0], body={
            "p_tenant_id": tenant, "p_draft": draft,
        })
    row = await asyncio.to_thread(tenant_row, tenant)
    if row["onboarding_step"] == "business":
        await asyncio.to_thread(set_step, tenant, "ai")
    return {"name": name}


@router.get("/delivery")
async def get_delivery(tenant_id: UUID, auth: Session) -> dict | None:
    await membership(tenant_id, auth[0])
    found = await asyncio.to_thread(service_request, "GET", "delivery_settings", params={
        "tenant_id": eq(str(tenant_id)), "select": "*", "limit": "1",
    })
    return found[0] if found else None


@router.put("/delivery")
async def save_delivery(tenant_id: UUID, data: DeliveryInput, auth: Session) -> dict:
    await owner(tenant_id, auth[0])
    body = {**data.model_dump(), "notes": data.notes.strip(), "tenant_id": str(tenant_id),
            "updated_at": datetime.now(timezone.utc).isoformat()}
    saved = await asyncio.to_thread(service_request, "POST", "delivery_settings", body=body,
                                    params={"on_conflict": "tenant_id"},
                                    prefer="resolution=merge-duplicates,return=representation")
    return saved[0]


@router.post("/onboarding/free")
async def choose_free(tenant_id: UUID, auth: Session) -> dict:
    """Free = the 7-day trial: AI setup and preview only. Onboarding ends on the dashboard."""
    await owner(tenant_id, auth[0])
    tenant = str(tenant_id)
    await asyncio.to_thread(open_wizard, tenant)
    return await asyncio.to_thread(set_step, tenant, "done")


@router.post("/onboarding/complete")
async def complete(tenant_id: UUID, auth: Session) -> dict:
    await owner(tenant_id, auth[0])
    tenant = str(tenant_id)
    row = await asyncio.to_thread(tenant_row, tenant)
    if row["onboarding_step"] == "done":
        return {"step": "done", "completed": True}
    if row["onboarding_step"] not in PAID_STEPS:
        raise HTTPException(409, "Choose a plan before finishing onboarding")
    return await asyncio.to_thread(set_step, tenant, "done")
