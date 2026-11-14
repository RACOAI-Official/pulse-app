"""Owner alert settings, destination verification, and Pulse's own WhatsApp webhook."""

import asyncio
import hashlib
import hmac
import json
import re
import secrets
from typing import Literal
from urllib.parse import quote
from uuid import UUID

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel, Field, field_validator

from .deps import Session, ip_limit, owner, user_limit
from .notification_delivery import DeliveryFailure, email_ready, now, send_email, whatsapp_ready
from .request_body import read_limited_body
from .settings import get_settings
from .store import eq, service_request, user_request

router = APIRouter(tags=["notifications"])
BASE = "/tenants/{tenant_id}/notifications"
STOP_WORDS = ("STOP", "UNSUBSCRIBE")
BANGLA_STOP = ("বন্ধ", "বন্ধ করুন")


class Preferences(BaseModel):
    email: str = Field(default="", max_length=254)
    whatsapp: str = Field(default="", max_length=16)
    email_enabled: bool = False
    whatsapp_enabled: bool = False
    language: Literal["bangla", "english"] = "bangla"
    consent: bool = False

    @field_validator("email")
    @classmethod
    def valid_email(cls, value: str) -> str:
        value = value.strip().lower()
        if value and not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", value):
            raise ValueError("Invalid email")
        return value

    @field_validator("whatsapp")
    @classmethod
    def valid_number(cls, value: str) -> str:
        value = value.strip()
        if value and not re.fullmatch(r"\+[1-9]\d{7,14}", value):
            raise ValueError("Use an international number, for example +8801712345678")
        return value


class Channel(BaseModel):
    channel: Literal["email", "whatsapp"]


class Token(BaseModel):
    token: str = Field(min_length=20, max_length=128)


class Retry(BaseModel):
    acknowledge_uncertain: bool = False


def digest(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def ready(channel: str) -> None:
    if not get_settings().pulse_notifications_enabled:
        raise HTTPException(503, "Pulse alerts are not enabled yet")
    if not (email_ready() if channel == "email" else whatsapp_ready()):
        raise HTTPException(503, "Pulse sender is not configured")


def dispatch(delivery_id: str) -> None:
    from .tasks import send_notification
    try:
        send_notification.delay(delivery_id)
    except Exception:  # noqa: BLE001 - the durable queue is reconciled by beat
        pass


@router.get(BASE)
async def get_preferences(tenant_id: UUID, auth: Session) -> dict:
    await owner(tenant_id, auth[0])
    rows = await user_request("GET", "notification_settings", auth[0], params={
        "tenant_id": eq(str(tenant_id)),
        "select": "email,whatsapp,email_enabled,whatsapp_enabled,language,email_verified_at,"
                  "whatsapp_verified_at,whatsapp_consent_at"})
    s = get_settings()
    return {"settings": rows[0] if rows else Preferences().model_dump(exclude={"consent"}),
            "sender": {"email": s.company_email_from, "whatsapp": s.pulse_whatsapp_number,
                       "available": s.pulse_notifications_enabled,
                       "email_ready": email_ready(), "whatsapp_ready": whatsapp_ready()}}


@router.put(BASE, dependencies=[user_limit("notify-write", 30, 600)])
async def save_preferences(tenant_id: UUID, data: Preferences, auth: Session) -> dict:
    await owner(tenant_id, auth[0])
    await user_request("POST", "rpc/pulse_save_notifications", auth[0], body={
        "p_tenant": str(tenant_id), "p_email": data.email, "p_whatsapp": data.whatsapp,
        "p_email_enabled": data.email_enabled, "p_whatsapp_enabled": data.whatsapp_enabled,
        "p_language": data.language, "p_consent": data.consent})
    return await get_preferences(tenant_id, auth)


@router.post(BASE + "/verify", dependencies=[user_limit("notify-verify", 10, 3600)])
async def request_verification(tenant_id: UUID, data: Channel, auth: Session) -> dict:
    await owner(tenant_id, auth[0])
    ready(data.channel)
    token = secrets.token_urlsafe(32)
    destination = await user_request("POST", "rpc/pulse_notification_challenge", auth[0], body={
        "p_tenant": str(tenant_id), "p_channel": data.channel, "p_hash": digest(token)})
    s = get_settings()
    if data.channel == "whatsapp":
        return {"url": "https://wa.me/" + s.pulse_whatsapp_number.lstrip("+") + "?text=" + quote("PULSE VERIFY " + token),
                "expires_in": 900}
    url = s.pulse_web_origin.rstrip("/") + "/notifications/verify#" + token
    try:
        await asyncio.to_thread(
            send_email, destination, "Verify your Pulse alert email",
            "Open this link and press Verify to receive Pulse alerts at this address. It expires in 15 minutes.\n" + url,
            '<p>Verify this address to receive Pulse alerts. The link expires in 15 minutes.</p>'
            f'<p><a href="{url}">Verify email</a></p>')
    except DeliveryFailure as exc:
        raise HTTPException(502, "Verification email could not be sent. Retry after one minute.") from exc
    return {"sent": True, "expires_in": 900}


@router.post("/notifications/verify-email", dependencies=[ip_limit("notify-verify-email", 30, 3600)])
async def verify_email(data: Token) -> dict:
    valid = await asyncio.to_thread(service_request, "POST", "rpc/pulse_verify_notification",
                                    body={"p_hash": digest(data.token), "p_channel": "email", "p_sender": ""})
    if not valid:
        raise HTTPException(400, "Verification link expired or already used")
    return {"verified": True}


@router.get(BASE + "/deliveries")
async def deliveries(tenant_id: UUID, auth: Session) -> list[dict]:
    await owner(tenant_id, auth[0])
    return await user_request("GET", "notification_deliveries", auth[0], params={
        "tenant_id": eq(str(tenant_id)), "select": "id,kind,channel,status,attempts,error,created_at,summary",
        "order": "created_at.desc", "limit": "50"})


@router.post(BASE + "/test", dependencies=[user_limit("notify-test", 10, 600)])
async def test_notification(tenant_id: UUID, data: Channel, auth: Session) -> dict:
    await owner(tenant_id, auth[0])
    ready(data.channel)
    item = await user_request("POST", "rpc/pulse_test_notification", auth[0],
                              body={"p_tenant": str(tenant_id), "p_channel": data.channel})
    await asyncio.to_thread(dispatch, item)
    return {"id": item, "status": "queued"}


@router.post(BASE + "/deliveries/{delivery_id}/retry", dependencies=[user_limit("notify-test", 10, 600)])
async def retry_notification(tenant_id: UUID, delivery_id: UUID, data: Retry, auth: Session) -> dict:
    await owner(tenant_id, auth[0])
    changed = await user_request("POST", "rpc/pulse_retry_notification", auth[0], body={
        "p_tenant": str(tenant_id), "p_id": str(delivery_id), "p_uncertain": data.acknowledge_uncertain})
    if not changed:
        raise HTTPException(409, "Delivery is not retryable or requires acknowledging the duplicate risk")
    await asyncio.to_thread(dispatch, str(delivery_id))
    return {"status": "queued"}


@router.get("/webhooks/pulse-whatsapp")
async def verify_webhook(request: Request):
    expected = get_settings().pulse_whatsapp_verify_token
    if (not expected or request.query_params.get("hub.mode") != "subscribe" or
            not hmac.compare_digest(request.query_params.get("hub.verify_token", ""), expected)):
        raise HTTPException(403, "Invalid verification token")
    return PlainTextResponse(request.query_params.get("hub.challenge", "")[:200])


def process_status(status: dict) -> None:
    value = status.get("status")
    preceding = {"sent": ["sending", "accepted", "uncertain"],
                 "delivered": ["sending", "accepted", "sent", "uncertain"],
                 "read": ["sending", "accepted", "sent", "delivered", "uncertain"],
                 "failed": ["sending", "accepted", "sent", "uncertain"]}
    if value not in preceding or not status.get("id") or not status.get("recipient_id"):
        return
    params = {"channel": "eq.whatsapp", "status": "in.(" + ",".join(preceding[value]) + ")"}
    callback = status.get("biz_opaque_callback_data")
    if callback:
        try:
            delivery_id, claim_token = callback.split(":", 1)
            params["id"] = eq(str(UUID(delivery_id)))
            params["claim_token"] = eq(str(UUID(claim_token)))
        except ValueError:
            return
    else:
        params["provider_id"] = eq(status["id"])
    # A callback must also match the verified recipient it was sent to.
    params["destination"] = eq("+" + str(status["recipient_id"]).lstrip("+"))
    service_request("PATCH", "notification_deliveries", params=params, body={
        "status": value, "provider_id": status["id"], "updated_at": now().isoformat(),
        "error": "WhatsApp delivery failed" if value == "failed" else None})


def process_webhook(payload: dict) -> None:
    s = get_settings()
    for entry in payload.get("entry", []):
        for change in entry.get("changes", []):
            value = change.get("value", {})
            if value.get("metadata", {}).get("phone_number_id") != s.pulse_whatsapp_phone_id:
                continue
            for status in value.get("statuses", []):
                process_status(status)
            for message in value.get("messages", []):
                sender = "+" + str(message.get("from", "")).lstrip("+")
                if not re.fullmatch(r"\+[1-9]\d{7,14}", sender):
                    continue
                text = str((message.get("text") or {}).get("body", "")).strip()
                if text.upper() in STOP_WORDS or text in BANGLA_STOP:
                    service_request("PATCH", "notification_settings", params={"whatsapp": eq(sender)},
                                    body={"whatsapp_enabled": False, "whatsapp_consent_at": None})
                    service_request("PATCH", "notification_deliveries", body={
                        "status": "suppressed", "updated_at": now().isoformat()},
                        params={"channel": "eq.whatsapp", "destination": eq(sender), "status": "eq.queued"})
                elif text.startswith("PULSE VERIFY "):
                    token = text.removeprefix("PULSE VERIFY ").strip()
                    if 20 <= len(token) <= 128:
                        service_request("POST", "rpc/pulse_verify_notification",
                                        body={"p_hash": digest(token), "p_channel": "whatsapp", "p_sender": sender})


@router.post("/webhooks/pulse-whatsapp")
async def receive_webhook(request: Request) -> dict:
    raw = await read_limited_body(request, 1024 * 1024, "Webhook too large")
    secret = get_settings().pulse_whatsapp_app_secret
    expected = "sha256=" + hmac.new(secret.encode(), raw, hashlib.sha256).hexdigest()
    if not secret or not hmac.compare_digest(request.headers.get("x-hub-signature-256", ""), expected):
        raise HTTPException(403, "Invalid signature")
    try:
        payload = json.loads(raw)
        if not isinstance(payload, dict):
            raise ValueError("payload")
        await asyncio.to_thread(process_webhook, payload)
    except (ValueError, TypeError, AttributeError) as exc:
        raise HTTPException(400, "Invalid webhook") from exc
    return {"received": True}
