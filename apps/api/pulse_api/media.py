from urllib.parse import urlparse
from uuid import uuid4

import httpx

from .settings import get_settings
from .store import storage_path

ALLOWED_HOST_SUFFIXES = (
    "facebook.com", "fbcdn.net", "instagram.com", "cdninstagram.com",
    "fbsbx.com", "whatsapp.net",
)
MAX_MEDIA_BYTES = 20 * 1024 * 1024


def _allowed_url(url: str) -> bool:
    parsed = urlparse(url)
    host = (parsed.hostname or "").lower()
    return parsed.scheme == "https" and any(
        host == suffix or host.endswith("." + suffix)
        for suffix in ALLOWED_HOST_SUFFIXES
    )


def _whatsapp_media_url(media_id: str, token: str) -> str:
    settings = get_settings()
    with httpx.Client(timeout=15) as client:
        response = client.get(
            f"https://graph.facebook.com/{settings.meta_graph_version}/{media_id}",
            headers={"Authorization": f"Bearer {token}"},
        )
    response.raise_for_status()
    return str(response.json()["url"])


def save_media(tenant_id: str, items: list[dict], token: str) -> list[dict]:
    saved = []
    for item in items:
        try:
            url = item.get("url")
            if not url and item.get("id"):
                url = _whatsapp_media_url(str(item["id"]), token)
            if not url or not _allowed_url(url):
                raise ValueError("Media URL is unavailable")
            with httpx.Client(timeout=20, follow_redirects=False) as client:
                response = client.get(url, headers={"Authorization": f"Bearer {token}"})
            response.raise_for_status()
            if len(response.content) > MAX_MEDIA_BYTES:
                raise ValueError("Media exceeds 20 MB")
            mime_type = response.headers.get("content-type", "application/octet-stream").split(";")[0]
            object_path = f"{tenant_id}/{uuid4().hex}"
            settings = get_settings()
            with httpx.Client(timeout=20) as client:
                upload = client.post(
                    f"{settings.supabase_url}/storage/v1/object/inbox-media/{storage_path(object_path)}",
                    headers={"apikey": settings.supabase_service_role_key,
                             "Authorization": f"Bearer {settings.supabase_service_role_key}",
                             "Content-Type": mime_type},
                    content=response.content,
                )
            upload.raise_for_status()
            saved.append({"type": item.get("type"), "path": object_path,
                          "mime_type": mime_type, "size": len(response.content)})
        except (ValueError, httpx.HTTPError, KeyError):
            saved.append({"type": item.get("type"), "unavailable": True})
    return saved
