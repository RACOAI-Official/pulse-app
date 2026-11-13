import asyncio
import hmac
import json
import logging
import re
from dataclasses import asdict
from typing import Annotated, Any, Literal
from uuid import UUID

import httpx
import redis.asyncio as aioredis
from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from .meta import extract_comments, extract_messages, verify_signature
from .deps import Session, ip_limit, membership, owner, session, user_limit  # noqa: F401  (re-exported)
from .ratelimit import client_ip, retry_after
from .request_body import read_limited_body
from .agent import DEFAULT_DRAFT, catalog_facts, config_for_tenant, extract_order, generate_reply, with_delivery
from .settings import get_settings
from .store import (StoreError, auth_user, eq, service_auth_request, service_headers, service_request, storage_path,
                    tenant_owned_path, user_request)
from .tasks import process_webhook, send_outbound

logger = logging.getLogger(__name__)
_docs = get_settings().pulse_api_docs
app = FastAPI(title="Pulse API", version="0.1.0", docs_url="/docs" if _docs else None,
              redoc_url="/redoc" if _docs else None, openapi_url="/openapi.json" if _docs else None)





@app.middleware("http")
async def billing_access_gate(request: Request, call_next):
    """Block paid writes when the workspace has no active plan or trial; Plan stays reachable."""
    path = request.url.path
    if request.method not in ("GET", "HEAD", "OPTIONS") and path.startswith("/tenants/"):
        match = re.match(r"^/tenants/([0-9a-fA-F-]{36})(?:/|$)", path)
        if match:
            try:
                tenant_id = UUID(match.group(1))
            except ValueError:
                return await call_next(request)
            # Plan and onboarding stay reachable so an owner can always finish setup or pay.
            if (path.startswith(f"/tenants/{tenant_id}/billing/") or path == f"/tenants/{tenant_id}/billing"
                    or path.startswith(f"/tenants/{tenant_id}/onboarding/")
                    or path == f"/tenants/{tenant_id}/delivery"):
                return await call_next(request)
            authorization = request.headers.get("authorization", "")
            if not authorization.startswith("Bearer "):
                return await call_next(request)
            try:
                await membership(tenant_id, authorization.removeprefix("Bearer "))
            except HTTPException:
                return await call_next(request)
            except StoreError:
                return JSONResponse(status_code=503, content={"detail": "Workspace access could not be checked."})
            from .billing import has_access
            try:
                if not await asyncio.to_thread(has_access, str(tenant_id)):
                    return JSONResponse(status_code=402, content={"detail": "Subscription required. Open Plan to continue."})
            except StoreError:
                return JSONResponse(status_code=503, content={"detail": "Billing access could not be checked."})
    return await call_next(request)


# Flood guard per client IP across the API. Inbox polling is ~8 requests/min per open tab, so this only trips on abuse.
# Signed webhooks and OAuth redirects are exempt: Meta/Stripe deliver bursts from few IPs and verify cheaply.
GLOBAL_IP_LIMIT, GLOBAL_IP_WINDOW = 1200, 60


@app.middleware("http")
async def ip_rate_limit(request: Request, call_next):
    path = request.url.path
    if request.method != "OPTIONS" and path != "/health" and not path.startswith(("/webhooks/", "/oauth/")):
        wait = await retry_after(f"ip:{client_ip(request)}", GLOBAL_IP_LIMIT, GLOBAL_IP_WINDOW)
        if wait:
            return JSONResponse(status_code=429, content={"detail": "Too many requests. Try again shortly."},
                                headers={"Retry-After": str(wait)})
    return await call_next(request)


# Added last so it is the outermost layer: 402/429 from the middlewares above still carry CORS headers,
# otherwise the browser hides the error detail behind a network failure.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[get_settings().pulse_web_origin],
    allow_credentials=False,
    allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE"],
    allow_headers=["Authorization", "Content-Type"],
    expose_headers=["Retry-After"],
)


@app.exception_handler(StoreError)
async def store_error_handler(_: Request, exc: StoreError):
    from fastapi.responses import JSONResponse
    status = exc.status_code if 400 <= exc.status_code < 500 else 502
    return JSONResponse(status_code=status, content={"detail": exc.detail})


@app.get("/health")
async def health() -> dict[str, str]:
    # Redis carries the Celery queue; without it no AI replies are sent, so report unhealthy.
    client = aioredis.from_url(get_settings().redis_url, socket_connect_timeout=2, socket_timeout=2)
    try:
        await client.ping()
    except Exception:
        logger.exception("Health check: Redis unreachable")
        raise HTTPException(503, "Redis unavailable")
    finally:
        await client.aclose()
    return {"status": "ok"}


@app.get("/ops/overview")
async def ops_overview(auth: Session) -> dict:
    return await user_request("POST", "rpc/pulse_ops_overview", auth[0], body={})


def dispatch(task, item_id: str) -> None:
    try:
        task.delay(item_id)
    except Exception:
        # The durable database record is authoritative; Celery beat reconciles it.
        logger.exception("Queue dispatch failed for persisted item %s", item_id)


class AgentFact(BaseModel):
    topic: str = Field(min_length=1, max_length=100)
    content: str = Field(min_length=1, max_length=1000)


class AgentFaq(BaseModel):
    question: str = Field(min_length=1, max_length=200)
    answer: str = Field(min_length=1, max_length=1000)


class AgentDraft(BaseModel):
    business_name: str = Field(default="", max_length=120)
    business_description: str = Field(default="", max_length=3000)
    behavior: str = Field(default="Friendly, concise, and honest.", max_length=1500)
    language: Literal["auto", "bangla", "english"] = "auto"
    addressing: Literal["neutral", "customer_preference"] = "neutral"
    policies: list[AgentFact] = Field(default_factory=list, max_length=30)
    faqs: list[AgentFaq] = Field(default_factory=list, max_length=100)
    media_reply: str = Field(default=DEFAULT_DRAFT["media_reply"], min_length=1, max_length=500)
    language_v2: bool = False
    media_reply_bangla: str = Field(default="", max_length=500)
    media_reply_english: str = Field(default="", max_length=500)


class TestTurn(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=1000)


class AgentTestRequest(BaseModel):
    prompt: str = Field(min_length=1, max_length=1000)
    history: list[TestTurn] = Field(default_factory=list, max_length=8)


class EnabledRequest(BaseModel):
    enabled: bool


@app.get("/tenants/{tenant_id}/agent")
async def get_agent(tenant_id: UUID, auth: Session) -> dict:
    await membership(tenant_id, auth[0])
    return await asyncio.to_thread(config_for_tenant, str(tenant_id))


@app.put("/tenants/{tenant_id}/agent/draft")
async def save_agent_draft(tenant_id: UUID, data: AgentDraft, auth: Session) -> dict:
    await owner(tenant_id, auth[0])
    revision = await user_request("POST", "rpc/pulse_save_agent_draft", auth[0], body={
        "p_tenant_id": str(tenant_id), "p_draft": data.model_dump(),
    })
    return {"draft_revision": revision, "tested_revision": 0}


@app.post("/tenants/{tenant_id}/agent/test", dependencies=[user_limit("agent-test", 20, 60)])
async def test_agent(tenant_id: UUID, data: AgentTestRequest, auth: Session) -> dict:
    await membership(tenant_id, auth[0])
    current = await asyncio.to_thread(config_for_tenant, str(tenant_id))
    draft = current["draft"]
    if not draft.get("business_name", "").strip():
        raise HTTPException(409, "Save a business name before testing")
    try:
        history = [turn.model_dump() for turn in data.history]
        context = "\n".join(str(turn.get("content", "")) for turn in history) + "\n" + data.prompt
        facts = await asyncio.to_thread(catalog_facts, str(tenant_id), context)
        config = await asyncio.to_thread(with_delivery, draft, str(tenant_id))
        answer = await asyncio.to_thread(generate_reply, config, data.prompt, facts, history)
    except (httpx.HTTPError, RuntimeError) as exc:
        logger.warning("Agent test unavailable for tenant %s: %s", tenant_id, type(exc).__name__)
        raise HTTPException(503, "The AI model is not reachable right now. Try again in a moment.") from exc
    except ValueError as exc:
        logger.warning("Agent test got an unusable reply for tenant %s: %s", tenant_id, exc)
        raise HTTPException(502, "The AI gave an unusable reply. Try again.") from exc
    try:
        proposal = extract_order(answer)
    except ValueError:
        proposal = None  # A malformed order line still shows the model's text instead of failing the test.
    if proposal:
            # Test runs never touch real orders or stock; show what would have been placed.
        items = ", ".join(f"{item['sku']} x{item['quantity']}" for item in proposal["items"])
        answer = (f"[Test mode: draft order would be created] {items}; "
                  f"{proposal['customer_name']}, {proposal['customer_phone']}, "
                  f"{proposal['delivery_address']}")
    await user_request("POST", "agent_test_runs", auth[0], body={
        "tenant_id": str(tenant_id), "user_id": auth[1]["id"],
        "prompt": data.prompt, "response": answer,
        "draft_revision": current["draft_revision"],
    })
    tested = await user_request("POST", "rpc/pulse_mark_agent_tested", auth[0], body={
        "p_tenant_id": str(tenant_id), "p_revision": current["draft_revision"],
    })
    return {"response": answer, "version": "draft", "catalog_matches": len(facts),
            "tested_revision": current["draft_revision"] if tested else None}


@app.post("/tenants/{tenant_id}/agent/publish")
async def publish_agent(tenant_id: UUID, auth: Session) -> dict:
    await owner(tenant_id, auth[0])
    version = await user_request("POST", "rpc/pulse_publish_agent", auth[0], body={
        "p_tenant_id": str(tenant_id),
    })
    current = await asyncio.to_thread(config_for_tenant, str(tenant_id))
    return {"published_version": version, "enabled": current["enabled"]}


@app.post("/tenants/{tenant_id}/agent/enabled")
async def set_agent_enabled(tenant_id: UUID, data: EnabledRequest, auth: Session) -> dict:
    await owner(tenant_id, auth[0])
    enabled = await user_request("POST", "rpc/pulse_set_agent_enabled", auth[0], body={
        "p_tenant_id": str(tenant_id), "p_enabled": data.enabled,
    })
    return {"enabled": enabled}


@app.get("/me/tenants")
async def my_tenants(auth: Session) -> list[dict]:
    token, _ = auth
    rows = await user_request("GET", "memberships", token, params={
        "select": "tenant_id,role,tenants(id,name,onboarding_step,onboarding_completed_at)",
        "order": "created_at.asc",
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


@app.get("/tenants/{tenant_id}/onboarding")
async def onboarding(tenant_id: UUID, auth: Session) -> dict:
    await membership(tenant_id, auth[0])
    agent_rows, product_rows, channel_rows, message_rows = await asyncio.gather(
        user_request("GET", "agent_configs", auth[0], params={
            "tenant_id": eq(str(tenant_id)), "select": "draft,published,enabled", "limit": "1",
        }),
        user_request("GET", "products", auth[0], params={
            "tenant_id": eq(str(tenant_id)), "state": "eq.active", "select": "id", "limit": "1",
        }),
        channels(tenant_id, auth),
        user_request("GET", "messages", auth[0], params={
            "tenant_id": eq(str(tenant_id)), "direction": "eq.inbound", "select": "id", "limit": "1",
        }),
    )
    agent = agent_rows[0] if agent_rows else {}
    return {
        "business_details": bool((agent.get("draft") or {}).get("business_name")),
        "product_active": bool(product_rows),
        "agent_published": bool(agent.get("published")),
        "channel_configured": any(row["status"] == "connected" for row in channel_rows),
        "inbound_verified": bool(message_rows),
        "ai_enabled": bool(agent.get("enabled")),
    }


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


@app.get("/tenants/{tenant_id}/analytics")
async def analytics(tenant_id: UUID, auth: Session,
                    days: int = Query(7)) -> dict:
    await membership(tenant_id, auth[0])
    if days not in (7, 30, 90):
        raise HTTPException(422, "Choose 7, 30, or 90 days")
    return await user_request("POST", "rpc/pulse_analytics", auth[0], body={
        "p_tenant_id": str(tenant_id), "p_days": days,
    })


@app.get("/tenants/{tenant_id}/analytics/courier-returns")
async def courier_returns(tenant_id: UUID, auth: Session, days: int = Query(30)) -> dict:
    await membership(tenant_id, auth[0])
    if days not in (7, 30, 90):
        raise HTTPException(422, "Choose 7, 30, or 90 days")
    return await user_request("POST", "rpc/pulse_courier_returns_report", auth[0], body={
        "p_tenant_id": str(tenant_id), "p_days": days,
    })


@app.get("/tenants/{tenant_id}/performance")
async def performance(tenant_id: UUID, auth: Session,
                      days: int = Query(7)) -> list[dict]:
    await membership(tenant_id, auth[0])
    if days not in (7, 30, 90):
        raise HTTPException(422, "Choose 7, 30, or 90 days")
    return await user_request("POST", "rpc/pulse_team_performance", auth[0], body={
        "p_tenant_id": str(tenant_id), "p_days": days,
    })


@app.get("/tenants/{tenant_id}/activity")
async def activity(tenant_id: UUID, auth: Session) -> list[dict]:
    await membership(tenant_id, auth[0])
    return await user_request("GET", "activity_events", auth[0], params={
        "tenant_id": eq(str(tenant_id)), "select": "*", "order": "created_at.desc", "limit": "200",
    })


@app.get("/tenants/{tenant_id}/usage")
async def usage(tenant_id: UUID, auth: Session, days: int = Query(30)) -> dict:
    await membership(tenant_id, auth[0])
    if days not in (7, 30, 90):
        raise HTTPException(422, "Choose 7, 30, or 90 days")
    return await user_request("POST", "rpc/pulse_usage_summary", auth[0], body={
        "p_tenant_id": str(tenant_id), "p_days": days,
    })


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


@app.get("/tenants/{tenant_id}/conversations/{conversation_id}")
async def conversation(tenant_id: UUID, conversation_id: UUID, auth: Session) -> dict:
    return await conversation_for_user(tenant_id, conversation_id, auth[0])


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


@app.post("/tenants/{tenant_id}/conversations/{conversation_id}/reply", dependencies=[user_limit("reply", 60, 60)])
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


class ResponderUpdate(BaseModel):
    responder: Literal["ai", "human"]


@app.post("/tenants/{tenant_id}/conversations/{conversation_id}/responder")
async def set_responder(tenant_id: UUID, conversation_id: UUID,
                        data: ResponderUpdate, auth: Session) -> dict:
    await conversation_for_user(tenant_id, conversation_id, auth[0])
    responder = await user_request("POST", "rpc/pulse_set_responder", auth[0], body={
        "p_conversation_id": str(conversation_id), "p_responder": data.responder,
    })
    return {"responder": responder}


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


@app.post("/tenants/{tenant_id}/messages/{message_id}/retry", dependencies=[user_limit("retry", 30, 60)])
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


@app.post("/tenants/{tenant_id}/invites", dependencies=[user_limit("invite", 20, 3600)])
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
    if not tenant_owned_path(tenant_id, path):
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
    if params.get("hub.mode") != "subscribe" or not hmac.compare_digest(
            params.get("hub.verify_token") or "", get_settings().meta_verify_token):
        raise HTTPException(403, "Webhook verification failed")
    from fastapi.responses import PlainTextResponse
    return PlainTextResponse(params.get("hub.challenge") or "")


@app.post("/webhooks/meta")
async def receive_webhook(request: Request) -> dict:
    raw = await read_limited_body(request, 1024 * 1024, "Webhook too large")
    if not verify_signature(raw, request.headers.get("x-hub-signature-256")):
        raise HTTPException(403, "Invalid Meta signature")
    try:
        payload = json.loads(raw)
        incoming = extract_messages(payload)
        comments = extract_comments(payload)
    except (ValueError, TypeError) as exc:
        raise HTTPException(400, "Invalid webhook JSON") from exc
    accepted = 0
    for item in incoming:
        connections = await asyncio.to_thread(service_request, "GET", "channel_connections", params={
            "channel": eq(item.channel), "external_account_id": eq(item.account_id),
            "status": "eq.connected", "select": "id,tenant_id", "limit": "1",
        })
        if not connections:
            logger.warning("Webhook for unconfigured %s account_id=%s", item.channel, item.account_id)
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
    for item in comments:
        connections = await asyncio.to_thread(service_request, "GET", "channel_connections", params={
            "channel": eq(item.channel), "external_account_id": eq(item.account_id),
            "status": "eq.connected", "select": "id,tenant_id", "limit": "1",
        })
        if not connections:
            continue
        connection = connections[0]
        rows = await asyncio.to_thread(service_request, "POST", "public_comments", params={
            "on_conflict": "connection_id,provider_comment_id",
        }, body={
            "tenant_id": connection["tenant_id"], "connection_id": connection["id"],
            "channel": item.channel, "post_id": item.post_id,
            "provider_comment_id": item.provider_comment_id,
            "parent_comment_id": item.parent_comment_id, "author_id": item.author_id,
            "author_name": item.author_name, "body": item.body,
        }, prefer="resolution=ignore-duplicates,return=representation")
        accepted += len(rows or [])
    return {"accepted": accepted}


@app.post("/tenants/{tenant_id}/ws-ticket", dependencies=[user_limit("ws-ticket", 30, 60)])
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
async def websocket_updates(websocket: WebSocket, ticket: Annotated[str, Query(max_length=64)]) -> None:
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
from .inbox_extra import router as inbox_extra_router  # noqa: E402
from .admin_agent import router as admin_agent_router  # noqa: E402
from .integrations import router as integrations_router  # noqa: E402
from .signup import router as signup_router  # noqa: E402
from .billing import router as billing_router, webhooks as billing_webhooks  # noqa: E402
from .onboarding import router as onboarding_router  # noqa: E402
from .meta_oauth import router as meta_oauth_router, callbacks as meta_oauth_callbacks  # noqa: E402

app.include_router(commerce_router)
app.include_router(inbox_extra_router)
app.include_router(admin_agent_router)
app.include_router(integrations_router)
app.include_router(signup_router)
app.include_router(billing_router)
app.include_router(billing_webhooks)
app.include_router(onboarding_router)
app.include_router(meta_oauth_router)
app.include_router(meta_oauth_callbacks)
