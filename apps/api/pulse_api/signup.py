"""Self-serve sign-up: email a 6-digit code, then create the user, their workspace and owner membership."""

import asyncio
import hashlib
import hmac
import logging
import re
import secrets

import redis.asyncio as aioredis
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, field_validator

from .emails import send, signup_code
from .deps import ip_limit
from .settings import get_settings
from .store import StoreError, service_auth_request, service_request

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/auth/signup", tags=["auth"])

CODE_TTL = 600
RESEND_COOLDOWN = 60
MAX_ATTEMPTS = 5
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _clean_email(value: str) -> str:
    value = value.strip().lower()
    if len(value) > 254 or not EMAIL_RE.match(value):
        raise ValueError("Enter a valid email address")
    return value


class StartBody(BaseModel):
    email: str
    business_name: str = Field(min_length=1, max_length=120)

    @field_validator("email")
    @classmethod
    def check_email(cls, value: str) -> str:
        return _clean_email(value)


class VerifyBody(BaseModel):
    email: str
    code: str = Field(pattern=r"^\d{6}$")
    password: str = Field(min_length=8, max_length=72)

    @field_validator("email")
    @classmethod
    def check_email(cls, value: str) -> str:
        return _clean_email(value)


def _redis():
    return aioredis.from_url(get_settings().redis_url, socket_connect_timeout=2, socket_timeout=2,
                             decode_responses=True)


def _digest(email: str, code: str) -> str:
    return hashlib.sha256(f"{email}:{code}".encode()).hexdigest()


def send_code_email(to: str, code: str) -> None:
    transport = send(to, *signup_code(code))
    logger.info("Sign-up code sent via %s", transport)


# Per-email cooldown/attempts below stop hammering one address; per-IP caps stop spraying many addresses.
@router.post("/start", dependencies=[ip_limit("signup-start", 10, 3600)])
async def start_signup(data: StartBody) -> dict:
    client = _redis()
    try:
        if not await client.set(f"signup:cooldown:{data.email}", "1", nx=True, ex=RESEND_COOLDOWN):
            raise HTTPException(429, "Please wait a minute before requesting another code")
        code = f"{secrets.randbelow(10**6):06d}"
        await client.hset(f"signup:{data.email}", mapping={
            "digest": _digest(data.email, code), "business_name": data.business_name.strip(), "attempts": 0,
        })
        await client.expire(f"signup:{data.email}", CODE_TTL)
    finally:
        await client.aclose()
    try:
        await asyncio.to_thread(send_code_email, data.email, code)
    except Exception as exc:
        logger.exception("Sign-up email failed for %s", data.email)
        raise HTTPException(502, "Could not send the email. Try again shortly.") from exc
    return {"sent": True, "expires_in": CODE_TTL}


@router.post("/verify", dependencies=[ip_limit("signup-verify", 30, 3600)])
async def verify_signup(data: VerifyBody) -> dict:
    key = f"signup:{data.email}"
    client = _redis()
    try:
        pending = await client.hgetall(key)
        if not pending:
            raise HTTPException(400, "Code expired. Request a new one.")
        if int(await client.hincrby(key, "attempts", 1)) > MAX_ATTEMPTS:
            await client.delete(key)
            raise HTTPException(429, "Too many wrong codes. Request a new one.")
        if not hmac.compare_digest(pending["digest"], _digest(data.email, data.code)):
            raise HTTPException(400, "That code is not correct")
        await client.delete(key)
    finally:
        await client.aclose()
    return await asyncio.to_thread(_create_account, data.email, data.password, pending["business_name"])


def _create_account(email: str, password: str, business_name: str) -> dict:
    try:
        user = service_auth_request("POST", "admin/users", body={
            "email": email, "password": password, "email_confirm": True,
        })
    except StoreError as exc:
        if "already" in exc.detail.lower() or "exists" in exc.detail.lower():
            raise HTTPException(409, "This email already has an account. Sign in instead.") from exc
        if exc.status_code == 422:
            raise HTTPException(422, exc.detail) from exc
        raise HTTPException(502, "Could not create the account") from exc
    if not user.get("id"):
        raise HTTPException(502, "Could not create the account")
    try:
        tenant = service_request("POST", "tenants", body={"name": business_name},
                                 prefer="return=representation")[0]
        service_request("POST", "memberships", body={
            "tenant_id": tenant["id"], "user_id": user["id"], "role": "owner",
        })
    except Exception as exc:
        logger.exception("Workspace setup failed for new user %s", user["id"])
        try:
            service_auth_request("DELETE", f"admin/users/{user['id']}")
        except Exception:
            logger.exception("Could not roll back user %s", user["id"])
        raise HTTPException(502, "Could not set up your workspace. Try again.") from exc
    return {"created": True}
