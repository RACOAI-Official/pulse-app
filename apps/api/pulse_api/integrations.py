"""Optional tenant courier integrations (credentials only; handoff lives in commerce)."""

import json
from datetime import datetime, timezone
from uuid import UUID

from cryptography.fernet import Fernet
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from .main import Session, membership, owner
from .settings import get_settings
from .store import eq, service_request


router = APIRouter(prefix="/tenants/{tenant_id}/integrations", tags=["integrations"])


class IntegrationInput(BaseModel):
    environment: str = Field(pattern="^(sandbox|live)$")
    credentials: dict[str, str]


def _fernet() -> Fernet:
    key = get_settings().pulse_credential_key
    if not key:
        raise HTTPException(503, "Credential encryption is not configured")
    return Fernet(key.encode())


@router.get("")
async def integrations(tenant_id: UUID, auth: Session):
    await membership(tenant_id, auth[0])
    rows = service_request("GET", "integration_connections", params={
        "tenant_id": eq(str(tenant_id)),
        "select": "provider,environment,status,updated_at",
    })
    by_provider = {row["provider"]: row for row in rows}
    return [by_provider.get("pathao", {"provider": "pathao", "status": "not_connected"})]


@router.put("/{provider}")
async def save_integration(tenant_id: UUID, provider: str, data: IntegrationInput, auth: Session):
    await owner(tenant_id, auth[0])
    required = {"pathao": {"client_id", "client_secret", "username", "password"}}
    if provider not in required or set(data.credentials) != required[provider] or any(
        not value.strip() for value in data.credentials.values()
    ):
        raise HTTPException(422, "Incomplete integration credentials")
    ciphertext = _fernet().encrypt(json.dumps(data.credentials).encode()).decode()
    service_request("POST", "integration_connections", body={
        "tenant_id": str(tenant_id), "provider": provider,
        "environment": data.environment, "credential_ciphertext": ciphertext,
        "status": "unverified", "updated_at": datetime.now(timezone.utc).isoformat(),
    }, params={"on_conflict": "tenant_id,provider"},
        prefer="resolution=merge-duplicates")
    return {"provider": provider, "environment": data.environment, "status": "unverified"}
