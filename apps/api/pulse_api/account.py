"""Signed-in user's own account: change password with the current one, then sign out other devices."""

import asyncio

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from .deps import Session, user_limit
from .settings import get_settings
from .store import StoreError, service_auth_request

router = APIRouter(prefix="/me", tags=["account"])


class PasswordChange(BaseModel):
    current_password: str = Field(min_length=1, max_length=72)
    new_password: str = Field(min_length=8, max_length=72)


def _password_matches(email: str, password: str) -> bool:
    settings = get_settings()
    with httpx.Client(timeout=15) as client:
        response = client.post(f"{settings.supabase_url}/auth/v1/token", params={"grant_type": "password"},
                               headers={"apikey": settings.supabase_anon_key, "Content-Type": "application/json"},
                               json={"email": email, "password": password})
    if response.status_code == 200:
        return True
    if response.status_code in (400, 401):
        return False
    raise HTTPException(502, "Could not verify the current password")


def _sign_out_others(token: str) -> None:
    settings = get_settings()
    with httpx.Client(timeout=15) as client:
        client.post(f"{settings.supabase_url}/auth/v1/logout", params={"scope": "others"},
                    headers={"apikey": settings.supabase_anon_key, "Authorization": f"Bearer {token}"})


def _change(token: str, user: dict, data: PasswordChange) -> dict:
    email = user.get("email") or ""
    if not email:
        raise HTTPException(422, "This account has no email password sign-in")
    if data.new_password == data.current_password:
        raise HTTPException(422, "Choose a new password that differs from the current one")
    if not _password_matches(email, data.current_password):
        raise HTTPException(400, "Current password is incorrect")
    try:
        service_auth_request("PUT", f"admin/users/{user['id']}", body={"password": data.new_password})
    except StoreError as exc:
        # Supabase rejects weak or pwned passwords with 422 and a readable message.
        raise HTTPException(422 if exc.status_code == 422 else 502,
                            exc.detail if exc.status_code == 422 else "Could not update the password") from exc
    try:
        _sign_out_others(token)
    except httpx.HTTPError:
        pass  # The password is already changed; other sessions still expire with their refresh tokens.
    return {"status": "updated"}


@router.post("/password", dependencies=[user_limit("password-change", 5, 900)])
async def change_password(data: PasswordChange, auth: Session) -> dict:
    return await asyncio.to_thread(_change, auth[0], auth[1], data)
