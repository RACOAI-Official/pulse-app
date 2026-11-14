"""Shared request dependencies. Kept out of main.py so routers (and the Celery worker, which imports
billing/meta_oauth lazily) never re-enter main.py mid-import: main imports every router at its bottom."""

from typing import Annotated
from uuid import UUID

from fastapi import Depends, Header, HTTPException, Request

from .ratelimit import client_ip, enforce
from .store import auth_user, eq, user_request


async def session(authorization: Annotated[str | None, Header()] = None) -> tuple[str, dict]:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Authentication required")
    token = authorization.removeprefix("Bearer ")
    return token, await auth_user(token)


Session = Annotated[tuple[str, dict], Depends(session)]


def user_limit(scope: str, limit: int, window: int):
    """Per user per workspace. Runs after authentication, so anonymous calls cannot spend a workspace's budget."""
    async def dependency(request: Request, auth: Session) -> None:
        tenant = request.path_params.get("tenant_id", "-")
        await enforce(f"{scope}:{tenant}:{auth[1]['id']}", limit, window)
    return Depends(dependency)


def ip_limit(scope: str, limit: int, window: int):
    """Per client IP, for unauthenticated routes."""
    async def dependency(request: Request) -> None:
        await enforce(f"{scope}:{client_ip(request)}", limit, window)
    return Depends(dependency)


async def membership(tenant_id: UUID, token: str) -> dict:
    user = await auth_user(token)
    rows = await user_request("GET", "memberships", token, params={
        "tenant_id": eq(str(tenant_id)), "user_id": eq(user["id"]),
        "select": "tenant_id,user_id,role,tenants(suspended_at)", "limit": "1",
    })
    if not rows:
        raise HTTPException(404, "Tenant not found")
    return rows[0]


async def owner(tenant_id: UUID, token: str) -> dict:
    member = await membership(tenant_id, token)
    if member["role"] != "owner":
        raise HTTPException(403, "Owner role required")
    return member
