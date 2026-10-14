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
    headers = {
        "apikey": settings.supabase_service_role_key
        if token == settings.supabase_service_role_key else settings.supabase_anon_key,
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }
    if prefer:
        headers["Prefer"] = prefer
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
