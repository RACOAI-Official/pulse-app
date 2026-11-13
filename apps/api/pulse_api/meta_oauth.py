"""Self-serve channel connect: Facebook Login (Messenger pages), Instagram Login, WhatsApp Embedded Signup.

Every OAuth round trip carries an HMAC-signed, single-use state bound to the tenant and owner.
Tokens are Fernet-encrypted into channel_connections exactly like the operator CLI does.
"""

import asyncio
import hashlib
import hmac
import json
import logging
import secrets
from datetime import datetime, timedelta, timezone
from typing import Annotated, Literal
from urllib.parse import urlencode
from uuid import UUID

import httpx
import redis.asyncio as aioredis
from cryptography.fernet import Fernet
from fastapi import APIRouter, HTTPException, Path
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field, StringConstraints

from .deps import Session, membership, owner, user_limit
from .settings import get_settings
from .store import eq, service_request

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/tenants/{tenant_id}", tags=["channel-oauth"])
callbacks = APIRouter(tags=["channel-oauth-callbacks"])

STATE_TTL = 600
RETURN_PATHS = {"onboarding": "/onboarding", "integrations": "/integrations"}
MESSENGER_SCOPES = "pages_show_list,pages_messaging,pages_manage_metadata,business_management"
INSTAGRAM_SCOPES = "instagram_business_basic,instagram_business_manage_messages,instagram_business_manage_comments"
PAGE_FIELDS = "messages,messaging_postbacks,feed"


class StartInput(BaseModel):
    return_to: Literal["onboarding", "integrations"] = "onboarding"


class SelectInput(BaseModel):
    pick: str = Field(min_length=8, max_length=64, pattern="^[A-Za-z0-9_-]+$")
    page_ids: list[Annotated[str, StringConstraints(pattern="^[0-9]{1,40}$")]] = Field(min_length=1, max_length=10)


class WhatsAppInput(BaseModel):
    code: str = Field(min_length=4, max_length=2048)
    waba_id: str = Field(min_length=3, max_length=40, pattern="^[0-9]+$")
    phone_number_id: str = Field(min_length=3, max_length=40, pattern="^[0-9]+$")


def _redis():
    return aioredis.from_url(get_settings().redis_url, socket_connect_timeout=2, socket_timeout=2,
                             decode_responses=True)


def _graph(host: str = "graph.facebook.com") -> str:
    return f"https://{host}/{get_settings().meta_graph_version}"


def _api_base() -> str:
    base = get_settings().pulse_api_public_url.rstrip("/")
    if not base:
        raise HTTPException(503, "PULSE_API_PUBLIC_URL is required for channel connect")
    return base


def redirect_uri(provider: str) -> str:
    return f"{_api_base()}/oauth/{'instagram' if provider == 'instagram' else 'meta'}/callback"


def _fernet() -> Fernet:
    key = get_settings().pulse_credential_key
    if not key:
        raise HTTPException(503, "Credential encryption is not configured")
    return Fernet(key.encode())


def _sign(payload: str) -> str:
    secret = get_settings().meta_app_secret.encode()
    return hmac.new(secret, payload.encode(), hashlib.sha256).hexdigest()[:32]


def make_state(nonce: str) -> str:
    return f"{nonce}.{_sign(nonce)}"


def read_state(state: str) -> str:
    nonce, _, signature = state.partition(".")
    if not nonce or not signature or not hmac.compare_digest(signature, _sign(nonce)):
        raise HTTPException(400, "Invalid connect state")
    return nonce


def provider_ready(provider: str) -> bool:
    settings = get_settings()
    if not settings.pulse_api_public_url or not settings.pulse_credential_key:
        return False
    if provider == "instagram":
        return bool(settings.instagram_app_id and settings.instagram_app_secret)
    if provider == "whatsapp":
        return bool(settings.meta_app_id and settings.meta_whatsapp_config_id)
    return bool(settings.meta_app_id)


def dialog_url(provider: str, state: str) -> str:
    settings = get_settings()
    if provider == "instagram":
        return "https://www.instagram.com/oauth/authorize?" + urlencode({
            "client_id": settings.instagram_app_id, "redirect_uri": redirect_uri("instagram"),
            "response_type": "code", "scope": INSTAGRAM_SCOPES, "state": state,
            "enable_fb_login": "0", "force_authentication": "1"})
    params = {"client_id": settings.meta_app_id, "redirect_uri": redirect_uri("messenger"),
              "response_type": "code", "state": state}
    if settings.meta_login_config_id:
        params["config_id"] = settings.meta_login_config_id  # Facebook Login for Business
    else:
        params["scope"] = MESSENGER_SCOPES
    return f"https://www.facebook.com/{settings.meta_graph_version}/dialog/oauth?" + urlencode(params)


async def _call(method: str, url: str, **kwargs) -> dict:
    async with httpx.AsyncClient(timeout=20) as client:
        response = await client.request(method, url, **kwargs)
    if response.status_code >= 400:
        try:
            message = (response.json().get("error") or {}).get("message") or ""
        except ValueError:
            message = ""
        logger.warning("Meta call failed %s %s: %s", response.status_code, url.split("?")[0], message)
        raise HTTPException(502, "Meta rejected the request" + (f": {message[:160]}" if message else ""))
    return response.json()


def save_connection(tenant: str, channel: str, account_id: str, name: str, token: str,
                    expires_at: datetime | None = None) -> dict:
    """Insert or refresh this tenant's connection; never take over another workspace's account."""
    found = service_request("GET", "channel_connections", params={
        "channel": eq(channel), "external_account_id": eq(account_id), "select": "id,tenant_id", "limit": "1",
    })
    if found and found[0]["tenant_id"] != tenant:
        raise HTTPException(409, f"This {channel} account is already connected to another Pulse workspace")
    body = {"display_name": name[:120] or channel, "status": "connected", "connected_via": "oauth",
            "credential_ciphertext": _fernet().encrypt(token.encode()).decode(),
            "token_expires_at": expires_at.isoformat() if expires_at else None}
    if found:
        service_request("PATCH", "channel_connections", params={"id": eq(found[0]["id"])}, body=body)
        return {"id": found[0]["id"], "channel": channel, "display_name": body["display_name"]}
    rows = service_request("POST", "channel_connections", prefer="return=representation", body={
        **body, "tenant_id": tenant, "channel": channel, "external_account_id": account_id})
    return {"id": rows[0]["id"], "channel": channel, "display_name": body["display_name"]}


def _web(path: str, **query: str) -> RedirectResponse:
    return RedirectResponse(get_settings().pulse_web_origin + path + "?" + urlencode(query), status_code=303)


@router.get("/oauth/config")
async def oauth_config(tenant_id: UUID, auth: Session) -> dict:
    await membership(tenant_id, auth[0])
    settings = get_settings()
    return {"meta_app_id": settings.meta_app_id, "whatsapp_config_id": settings.meta_whatsapp_config_id,
            "graph_version": settings.meta_graph_version,
            "providers": {name: provider_ready(name) for name in ("messenger", "instagram", "whatsapp")}}


@router.post("/oauth/{provider}/start", dependencies=[user_limit("oauth-start", 20, 600)])
async def start(tenant_id: UUID, provider: Literal["messenger", "instagram"], data: StartInput, auth: Session) -> dict:
    await owner(tenant_id, auth[0])
    from .billing import require_paid
    await asyncio.to_thread(require_paid, str(tenant_id))
    if not provider_ready(provider):
        raise HTTPException(503, f"{provider.title()} connect is not configured yet")
    nonce = secrets.token_urlsafe(18)
    client = _redis()
    try:
        await client.set(f"oauth:state:{nonce}", json.dumps({
            "tenant": str(tenant_id), "user": auth[1]["id"], "provider": provider, "return_to": data.return_to,
        }), ex=STATE_TTL)
    finally:
        await client.aclose()
    return {"url": dialog_url(provider, make_state(nonce))}


async def _consume_state(state: str, provider: str) -> dict:
    nonce = read_state(state)
    client = _redis()
    try:
        raw = await client.getdel(f"oauth:state:{nonce}")
    finally:
        await client.aclose()
    if not raw:
        raise HTTPException(400, "Connect link expired. Start again")
    data = json.loads(raw)
    if data["provider"] != provider:
        raise HTTPException(400, "Invalid connect state")
    return data


@callbacks.get("/oauth/meta/callback")
async def messenger_callback(state: str = "", code: str = "", error_description: str = ""):
    try:
        data = await _consume_state(state, "messenger")
    except HTTPException as exc:
        return _web("/integrations", oauth_error=exc.detail)
    back = RETURN_PATHS[data["return_to"]]
    if not code:
        return _web(back, step="integrations", oauth_error=error_description or "Facebook connect was cancelled")
    settings = get_settings()
    try:
        short = await _call("GET", f"{_graph()}/oauth/access_token", params={
            "client_id": settings.meta_app_id, "client_secret": settings.meta_app_secret,
            "redirect_uri": redirect_uri("messenger"), "code": code})
        long = await _call("GET", f"{_graph()}/oauth/access_token", params={
            "grant_type": "fb_exchange_token", "client_id": settings.meta_app_id,
            "client_secret": settings.meta_app_secret, "fb_exchange_token": short["access_token"]})
        # Page tokens fetched with a long-lived user token do not expire.
        pages = await _call("GET", f"{_graph()}/me/accounts", params={
            "fields": "id,name,access_token,tasks", "limit": "50", "access_token": long["access_token"]})
    except (HTTPException, KeyError) as exc:
        detail = exc.detail if isinstance(exc, HTTPException) else "Facebook returned an incomplete response"
        return _web(back, step="integrations", oauth_error=detail)
    usable = [{"id": str(page["id"]), "name": page.get("name") or "Facebook Page", "token": page["access_token"]}
              for page in pages.get("data", []) if page.get("id") and page.get("access_token")
              and "MESSAGING" in (page.get("tasks") or ["MESSAGING"])]
    if not usable:
        return _web(back, step="integrations", oauth_error="No Facebook Pages you can manage messages for were shared")
    pick = secrets.token_urlsafe(18)
    client = _redis()
    try:
        await client.set(f"oauth:pick:{pick}", json.dumps({
            "tenant": data["tenant"], "user": data["user"], "pages": usable}), ex=STATE_TTL)
    finally:
        await client.aclose()
    return _web(back, step="integrations", pick=pick)


async def _load_pick(pick: str, tenant: str, user: str, *, delete: bool = False) -> dict:
    client = _redis()
    try:
        raw = await (client.getdel if delete else client.get)(f"oauth:pick:{pick}")
    finally:
        await client.aclose()
    data = json.loads(raw) if raw else None
    if not data or data["tenant"] != tenant or data["user"] != user:
        raise HTTPException(404, "Page selection expired. Connect Facebook again")
    return data


@router.get("/oauth/meta/pick/{pick}")
async def pick_pages(tenant_id: UUID, pick: Annotated[str, Path(min_length=8, max_length=64, pattern="^[A-Za-z0-9_-]+$")],
                     auth: Session) -> list[dict]:
    await owner(tenant_id, auth[0])
    data = await _load_pick(pick, str(tenant_id), auth[1]["id"])
    return [{"id": page["id"], "name": page["name"]} for page in data["pages"]]


@router.post("/oauth/meta/select")
async def select_pages(tenant_id: UUID, data: SelectInput, auth: Session) -> list[dict]:
    await owner(tenant_id, auth[0])
    tenant = str(tenant_id)
    from .billing import require_paid
    await asyncio.to_thread(require_paid, tenant)
    stored = await _load_pick(data.pick, tenant, auth[1]["id"], delete=True)
    chosen = [page for page in stored["pages"] if page["id"] in set(data.page_ids)]
    if not chosen:
        raise HTTPException(422, "Choose at least one Facebook Page")
    connected = []
    for page in chosen:
        await _call("POST", f"{_graph()}/{page['id']}/subscribed_apps", params={
            "subscribed_fields": PAGE_FIELDS, "access_token": page["token"]})
        connected.append(await asyncio.to_thread(
            save_connection, tenant, "messenger", page["id"], page["name"], page["token"]))
    return connected


@callbacks.get("/oauth/instagram/callback")
async def instagram_callback(state: str = "", code: str = "", error_description: str = ""):
    try:
        data = await _consume_state(state, "instagram")
    except HTTPException as exc:
        return _web("/integrations", oauth_error=exc.detail)
    back = RETURN_PATHS[data["return_to"]]
    if not code:
        return _web(back, step="integrations", oauth_error=error_description or "Instagram connect was cancelled")
    settings = get_settings()
    try:
        from .billing import require_paid
        await asyncio.to_thread(require_paid, data["tenant"])
        short = await _call("POST", "https://api.instagram.com/oauth/access_token", data={
            "client_id": settings.instagram_app_id, "client_secret": settings.instagram_app_secret,
            "grant_type": "authorization_code", "redirect_uri": redirect_uri("instagram"),
            "code": code.removesuffix("#_")})
        long = await _call("GET", "https://graph.instagram.com/access_token", params={
            "grant_type": "ig_exchange_token", "client_secret": settings.instagram_app_secret,
            "access_token": short["access_token"]})
        token = long["access_token"]
        me = await _call("GET", f"{_graph('graph.instagram.com')}/me", params={
            "fields": "user_id,username", "access_token": token})
        await _call("POST", f"{_graph('graph.instagram.com')}/me/subscribed_apps", params={
            "subscribed_fields": "messages,comments", "access_token": token})
        expires = datetime.now(timezone.utc) + timedelta(seconds=int(long.get("expires_in") or 5_184_000))
        await asyncio.to_thread(save_connection, data["tenant"], "instagram", str(me["user_id"]),
                                "@" + (me.get("username") or "instagram"), token, expires)
    except (HTTPException, KeyError, ValueError) as exc:
        detail = exc.detail if isinstance(exc, HTTPException) else "Instagram returned an incomplete response"
        return _web(back, step="integrations", oauth_error=detail)
    return _web(back, step="integrations", connected="instagram")


@router.post("/oauth/whatsapp/complete", dependencies=[user_limit("oauth-complete", 10, 600)])
async def whatsapp_complete(tenant_id: UUID, data: WhatsAppInput, auth: Session) -> dict:
    """Finish WhatsApp Embedded Signup: swap the SDK code for a business token and subscribe the WABA."""
    await owner(tenant_id, auth[0])
    tenant = str(tenant_id)
    from .billing import require_paid
    await asyncio.to_thread(require_paid, tenant)
    if not provider_ready("whatsapp"):
        raise HTTPException(503, "WhatsApp connect is not configured yet")
    settings = get_settings()
    exchanged = await _call("GET", f"{_graph()}/oauth/access_token", params={
        "client_id": settings.meta_app_id, "client_secret": settings.meta_app_secret, "code": data.code})
    token = exchanged.get("access_token")
    if not token:
        raise HTTPException(502, "Meta returned no WhatsApp token")
    phone = await _call("GET", f"{_graph()}/{data.phone_number_id}", params={
        "fields": "display_phone_number,verified_name", "access_token": token})
    await _call("POST", f"{_graph()}/{data.waba_id}/subscribed_apps", params={"access_token": token})
    name = phone.get("verified_name") or phone.get("display_phone_number") or "WhatsApp"
    return await asyncio.to_thread(save_connection, tenant, "whatsapp", data.phone_number_id, name, token)


@router.delete("/channels/{connection_id}")
async def disconnect(tenant_id: UUID, connection_id: UUID, auth: Session) -> dict:
    await owner(tenant_id, auth[0])
    await asyncio.to_thread(service_request, "PATCH", "channel_connections", params={
        "id": eq(str(connection_id)), "tenant_id": eq(str(tenant_id))}, body={"status": "disconnected"})
    return {"id": str(connection_id), "status": "disconnected"}


def refresh_instagram_tokens() -> int:
    """Instagram long-lived tokens last 60 days; refresh those expiring within a week."""
    soon = (datetime.now(timezone.utc) + timedelta(days=7)).isoformat()
    due = service_request("GET", "channel_connections", params={
        "channel": "eq.instagram", "connected_via": "eq.oauth", "status": "eq.connected",
        "token_expires_at": f"lt.{soon}", "select": "id,credential_ciphertext", "limit": "200"})
    refreshed = 0
    for row in due:
        try:
            token = _fernet().decrypt(row["credential_ciphertext"].encode()).decode()
            with httpx.Client(timeout=20) as client:
                response = client.get("https://graph.instagram.com/refresh_access_token",
                                      params={"grant_type": "ig_refresh_token", "access_token": token})
            response.raise_for_status()
            payload = response.json()
            expires = datetime.now(timezone.utc) + timedelta(seconds=int(payload.get("expires_in") or 5_184_000))
            service_request("PATCH", "channel_connections", params={"id": eq(row["id"])}, body={
                "credential_ciphertext": _fernet().encrypt(payload["access_token"].encode()).decode(),
                "token_expires_at": expires.isoformat()})
            refreshed += 1
        except Exception:
            logger.exception("Instagram token refresh failed for connection %s", row["id"])
    return refreshed
