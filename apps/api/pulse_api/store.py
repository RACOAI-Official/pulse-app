from typing import Any
from urllib.parse import quote

import httpx

from .settings import get_settings


class StoreError(Exception):
    def __init__(self, status_code: int, detail: str):
        self.status_code = status_code
        self.detail = detail
        super().__init__(detail)


def _headers(token: str, prefer: str | None = None) -> dict[str, str]:
    settings = get_settings()
    service = token == settings.supabase_service_role_key
    headers = {
        "apikey": settings.supabase_service_role_key if service else settings.supabase_anon_key,
        "Content-Type": "application/json",
    }
    # Opaque secret keys authenticate in apikey only; user sessions remain JWTs.
    if not (service and token.startswith("sb_secret_")):
        headers["Authorization"] = f"Bearer {token}"
    if prefer:
        headers["Prefer"] = prefer
    return headers


def service_headers(content_type: str = "application/json") -> dict[str, str]:
    headers = _headers(get_settings().supabase_service_role_key)
    headers["Content-Type"] = content_type
    return headers


def _parse(response: httpx.Response) -> Any:
    if response.status_code >= 400:
        try:
            detail = response.json().get("message") or response.json().get("msg")
        except ValueError:
            detail = None
        raise StoreError(response.status_code, detail or "Database request failed")
    if not response.content:
        return None
    return response.json()


async def user_request(
    method: str, path: str, token: str, *, params: dict[str, str] | None = None,
    body: Any = None, prefer: str | None = None,
) -> Any:
    async with httpx.AsyncClient(timeout=15) as client:
        response = await client.request(
            method, f"{get_settings().supabase_url}/rest/v1/{path}",
            headers=_headers(token, prefer), params=params, json=body,
        )
    return _parse(response)


def service_request(
    method: str, path: str, *, params: dict[str, str] | None = None,
    body: Any = None, prefer: str | None = None,
) -> Any:
    token = get_settings().supabase_service_role_key
    with httpx.Client(timeout=20) as client:
        response = client.request(
            method, f"{get_settings().supabase_url}/rest/v1/{path}",
            headers=_headers(token, prefer), params=params, json=body,
        )
    return _parse(response)


async def auth_user(token: str) -> dict[str, Any]:
    async with httpx.AsyncClient(timeout=10) as client:
        response = await client.get(
            f"{get_settings().supabase_url}/auth/v1/user",
            headers=_headers(token),
        )
    if response.status_code != 200:
        raise StoreError(401, "Invalid or expired session")
    data = response.json()
    if not data.get("id"):
        raise StoreError(401, "Invalid session")
    return data


def service_auth_request(method: str, path: str, *, body: Any = None,
                         params: dict[str, str] | None = None) -> Any:
    token = get_settings().supabase_service_role_key
    with httpx.Client(timeout=20) as client:
        response = client.request(
            method, f"{get_settings().supabase_url}/auth/v1/{path}",
            headers=_headers(token), params=params, json=body,
        )
    return _parse(response)


def eq(value: str) -> str:
    return f"eq.{value}"


def storage_path(path: str) -> str:
    return quote(path, safe="/")


def tenant_owned_path(tenant_id: Any, path: Any) -> bool:
    """True for a storage path inside the tenant's folder. Rejects '.'/'..'/empty segments: HTTP clients
    collapse dot segments, so '<tenant>/../<other>/x' would otherwise reach another tenant's object."""
    if not isinstance(path, str) or len(path) > 300 or "\\" in path or "%" in path:
        return False
    parts = path.split("/")
    return (len(parts) >= 2 and parts[0] == str(tenant_id)
            and all(part not in ("", ".", "..") and part.isprintable() for part in parts[1:]))
