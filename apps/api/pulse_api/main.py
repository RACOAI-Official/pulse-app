import asyncio
import json
import logging
from dataclasses import asdict
from typing import Annotated, Any
from uuid import UUID

import httpx
import redis.asyncio as aioredis
from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from .meta import extract_messages, verify_signature
from .settings import get_settings
from .store import StoreError, auth_user, eq, service_auth_request, service_headers, service_request, storage_path, user_request
from .tasks import process_webhook, send_outbound

logger = logging.getLogger(__name__)
app = FastAPI(title="Pulse API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[get_settings().pulse_web_origin],
    allow_credentials=False,
    allow_methods=["GET", "POST", "PATCH"],
    allow_headers=["Authorization", "Content-Type"],
)


@app.exception_handler(StoreError)
async def store_error_handler(_: Request, exc: StoreError):
    from fastapi.responses import JSONResponse
    status = exc.status_code if 400 <= exc.status_code < 500 else 502
    return JSONResponse(status_code=status, content={"detail": exc.detail})


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


async def session(authorization: Annotated[str | None, Header()] = None) -> tuple[str, dict]:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Authentication required")
    token = authorization.removeprefix("Bearer ")
    return token, await auth_user(token)


Session = Annotated[tuple[str, dict], Depends(session)]


def dispatch(task, item_id: str) -> None:
    try:
        task.delay(item_id)
    except Exception:
        # The durable database record is authoritative; Celery beat reconciles it.
        logger.exception("Queue dispatch failed for persisted item %s", item_id)


async def membership(tenant_id: UUID, token: str) -> dict:
    user = await auth_user(token)
    rows = await user_request("GET", "memberships", token, params={
        "tenant_id": eq(str(tenant_id)), "user_id": eq(user["id"]),
        "select": "tenant_id,user_id,role", "limit": "1",
    })
    if not rows:
        raise HTTPException(404, "Tenant not found")
    return rows[0]


@app.get("/me/tenants")
async def my_tenants(auth: Session) -> list[dict]:
    token, _ = auth
    rows = await user_request("GET", "memberships", token, params={
        "select": "tenant_id,role,tenants(id,name)", "order": "created_at.asc",
    })
    return rows


@app.get("/tenants/{tenant_id}/channels")
async def channels(tenant_id: UUID, auth: Session) -> list[dict]:
    await membership(tenant_id, auth[0])
    rows = await asyncio.to_thread(service_request, "GET", "channel_connections", params={
        "tenant_id": eq(str(tenant_id)),
        "select": "id,channel,external_account_id,display_name,status,created_at",
        "order": "channel.asc",
    })
    return rows


@app.get("/tenants/{tenant_id}/operations")
async def operations(tenant_id: UUID, auth: Session) -> dict:
    await membership(tenant_id, auth[0])
    failed_events = await asyncio.to_thread(service_request, "GET", "webhook_events", params={
        "tenant_id": eq(str(tenant_id)), "status": "eq.failed",
        "select": "id,channel,last_error,created_at", "order": "created_at.desc", "limit": "20",
    })
    problem_sends = await user_request("GET", "messages", auth[0], params={
        "tenant_id": eq(str(tenant_id)), "delivery_state": "in.(failed,uncertain)",
        "select": "id,conversation_id,delivery_state,failure_reason,created_at",
        "order": "created_at.desc", "limit": "20",
    })
    return {"failed_inbound": failed_events, "problem_sends": problem_sends}


@app.get("/tenants/{tenant_id}/conversations")
async def conversations(
    tenant_id: UUID, auth: Session, q: str = Query("", max_length=100),
    channel: str | None = Query(None, pattern="^(messenger|instagram|whatsapp)$"),
    state: str | None = Query(None, pattern="^(open|resolved)$"),
) -> list[dict]:
    await membership(tenant_id, auth[0])
    return await user_request("POST", "rpc/pulse_search_conversations", auth[0], body={
        "p_tenant_id": str(tenant_id), "p_query": q,
        "p_channel": channel, "p_state": state,
    })


async def conversation_for_user(tenant_id: UUID, conversation_id: UUID, token: str) -> dict:
    await membership(tenant_id, token)
    rows = await user_request("GET", "conversations", token, params={
        "tenant_id": eq(str(tenant_id)), "id": eq(str(conversation_id)),
        "select": "*", "limit": "1",
    })
    if not rows:
        raise HTTPException(404, "Conversation not found")
    return rows[0]


@app.get("/tenants/{tenant_id}/conversations/{conversation_id}/messages")
async def messages(tenant_id: UUID, conversation_id: UUID, auth: Session) -> list[dict]:
    await conversation_for_user(tenant_id, conversation_id, auth[0])
    return await user_request("GET", "messages", auth[0], params={
        "conversation_id": eq(str(conversation_id)), "select": "*",
        "order": "created_at.asc", "limit": "200",
    })


class ReplyBody(BaseModel):
    body: str = Field(min_length=1, max_length=1000)
    idempotency_key: UUID


@app.post("/tenants/{tenant_id}/conversations/{conversation_id}/reply")
async def reply(tenant_id: UUID, conversation_id: UUID, data: ReplyBody, auth: Session) -> dict:
    await conversation_for_user(tenant_id, conversation_id, auth[0])
    message_id = await user_request("POST", "rpc/pulse_create_human_reply", auth[0], body={
        "p_conversation_id": str(conversation_id), "p_body": data.body,
        "p_idempotency_key": str(data.idempotency_key),
    })
    dispatch(send_outbound, message_id)
    return {"message_id": message_id, "delivery_state": "queued"}


class ConversationUpdate(BaseModel):
    state: str | None = Field(default=None, pattern="^(open|resolved)$")
    mark_read: bool = False


@app.patch("/tenants/{tenant_id}/conversations/{conversation_id}")
async def update_conversation(
    tenant_id: UUID, conversation_id: UUID, data: ConversationUpdate, auth: Session,
) -> dict:
    await conversation_for_user(tenant_id, conversation_id, auth[0])
    update: dict[str, Any] = {}
    if data.state is not None:
        update["state"] = data.state
    if data.mark_read:
        update["unread_count"] = 0
    if not update:
        raise HTTPException(400, "No change requested")
    rows = await user_request("PATCH", "conversations", auth[0], params={
        "id": eq(str(conversation_id)), "tenant_id": eq(str(tenant_id)),
    }, body=update, prefer="return=representation")
    return rows[0]


@app.post("/tenants/{tenant_id}/messages/{message_id}/retry")
async def retry_message(tenant_id: UUID, message_id: UUID, auth: Session) -> dict:
    await membership(tenant_id, auth[0])
    rows = await user_request("GET", "messages", auth[0], params={
        "id": eq(str(message_id)), "tenant_id": eq(str(tenant_id)), "select": "id,delivery_state",
    })
    if not rows:
        raise HTTPException(404, "Message not found")
    if rows[0]["delivery_state"] != "failed":
        raise HTTPException(409, "Only failed sends can be retried")
    updated = await asyncio.to_thread(service_request, "PATCH", "messages", params={
        "id": eq(str(message_id)), "tenant_id": eq(str(tenant_id)),
        "delivery_state": "eq.failed",
    }, body={"delivery_state": "queued", "failure_reason": None},
        prefer="return=representation")
    if not updated:
        raise HTTPException(409, "Message state changed")
    dispatch(send_outbound, str(message_id))
    return {"delivery_state": "queued"}


class InviteBody(BaseModel):
    email: str = Field(min_length=3, max_length=254,
                       pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


@app.post("/tenants/{tenant_id}/invites")
async def invite_staff(tenant_id: UUID, data: InviteBody, auth: Session) -> dict:
    member = await membership(tenant_id, auth[0])
    if member["role"] != "owner":
        raise HTTPException(403, "Owner role required")
    invited = await asyncio.to_thread(service_auth_request, "POST", "invite",
        body={"email": data.email},
        params={"redirect_to": f"{get_settings().pulse_web_origin}/auth/callback"})
    if not invited.get("id"):
        raise HTTPException(502, "Auth service did not return an invited user")
    await asyncio.to_thread(service_request, "POST", "memberships", body={
        "tenant_id": str(tenant_id), "user_id": invited["id"], "role": "staff",
    }, prefer="resolution=ignore-duplicates")
    return {"email": data.email, "status": "invited"}


@app.get("/tenants/{tenant_id}/messages/{message_id}/media/{media_index}")
async def media_url(tenant_id: UUID, message_id: UUID, media_index: int, auth: Session) -> dict:
    await membership(tenant_id, auth[0])
    rows = await user_request("GET", "messages", auth[0], params={
        "id": eq(str(message_id)), "tenant_id": eq(str(tenant_id)), "select": "media", "limit": "1",
    })
    if not rows or media_index < 0 or media_index >= len(rows[0]["media"]):
        raise HTTPException(404, "Media not found")
    path = rows[0]["media"][media_index].get("path")
    if not path or not path.startswith(f"{tenant_id}/"):
        raise HTTPException(404, "Media unavailable")
    settings = get_settings()
    async with httpx.AsyncClient(timeout=10) as client:
        response = await client.post(
            f"{settings.supabase_url}/storage/v1/object/sign/inbox-media/{storage_path(path)}",
            headers=service_headers(),
            json={"expiresIn": 60},
        )
    if response.status_code != 200:
        raise HTTPException(502, "Could not create media link")
    signed = response.json()["signedURL"]
    return {"url": f"{settings.supabase_url}/storage/v1{signed}"}


@app.get("/webhooks/meta")
async def verify_webhook(request: Request):
    params = request.query_params
    if params.get("hub.mode") != "subscribe" or \
       params.get("hub.verify_token") != get_settings().meta_verify_token:
        raise HTTPException(403, "Webhook verification failed")
    from fastapi.responses import PlainTextResponse
    return PlainTextResponse(params.get("hub.challenge") or "")


@app.post("/webhooks/meta")
async def receive_webhook(request: Request) -> dict:
    raw = await request.body()
    if not verify_signature(raw, request.headers.get("x-hub-signature-256")):
        raise HTTPException(403, "Invalid Meta signature")
    if len(raw) > 1024 * 1024:
        raise HTTPException(413, "Webhook too large")
    try:
        incoming = extract_messages(json.loads(raw))
    except (ValueError, TypeError) as exc:
        raise HTTPException(400, "Invalid webhook JSON") from exc
    accepted = 0
    for item in incoming:
        connections = await asyncio.to_thread(service_request, "GET", "channel_connections", params={
            "channel": eq(item.channel), "external_account_id": eq(item.account_id),
            "status": "eq.connected", "select": "id,tenant_id", "limit": "1",
        })
        if not connections:
            logger.warning("Webhook for unconfigured %s account", item.channel)
            continue
        connection = connections[0]
        events = await asyncio.to_thread(service_request, "POST", "webhook_events", params={
            "on_conflict": "connection_id,external_event_id",
        }, body={
            "connection_id": connection["id"], "tenant_id": connection["tenant_id"],
            "channel": item.channel, "external_event_id": item.provider_id,
            "payload": asdict(item),
        }, prefer="resolution=ignore-duplicates,return=representation")
        if events:
            accepted += 1
            dispatch(process_webhook, events[0]["id"])
    return {"accepted": accepted}


@app.post("/tenants/{tenant_id}/ws-ticket")
async def websocket_ticket(tenant_id: UUID, auth: Session) -> dict:
    await membership(tenant_id, auth[0])
    import secrets
    ticket = secrets.token_urlsafe(32)
    client = aioredis.from_url(get_settings().redis_url)
    try:
        await client.setex(f"ws-ticket:{ticket}", 60, str(tenant_id))
    finally:
        await client.aclose()
    return {"ticket": ticket, "expires_in": 60}


@app.websocket("/ws")
async def websocket_updates(websocket: WebSocket, ticket: str = Query(...)) -> None:
    if websocket.headers.get("origin") != get_settings().pulse_web_origin:
        await websocket.close(code=1008)
        return
    client = aioredis.from_url(get_settings().redis_url)
    try:
        tenant_bytes = await client.getdel(f"ws-ticket:{ticket}")
        if not tenant_bytes:
            await websocket.close(code=1008)
            return
        tenant_id = tenant_bytes.decode()
        await websocket.accept()
        pubsub = client.pubsub()
        await pubsub.subscribe(f"tenant:{tenant_id}")
        try:
            while True:
                event = await pubsub.get_message(ignore_subscribe_messages=True, timeout=5)
                if event:
                    await websocket.send_json({"type": "refresh"})
                else:
                    await websocket.send_json({"type": "heartbeat"})
        except WebSocketDisconnect:
            pass
        finally:
            await pubsub.aclose()
    finally:
        await client.aclose()


from .commerce import router as commerce_router  # noqa: E402

app.include_router(commerce_router)
