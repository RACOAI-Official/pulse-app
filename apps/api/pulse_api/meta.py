import hashlib
import hmac
from dataclasses import dataclass
from typing import Any

import httpx

from .settings import get_settings


@dataclass(frozen=True)
class Incoming:
    channel: str
    account_id: str
    sender_id: str
    provider_id: str
    body: str | None
    media: list[dict[str, Any]]
    customer_name: str | None = None


@dataclass(frozen=True)
class IncomingComment:
    channel: str
    account_id: str
    post_id: str
    provider_comment_id: str
    parent_comment_id: str | None
    author_id: str
    author_name: str
    body: str


def verify_signature(body: bytes, signature: str | None) -> bool:
    if not signature or not signature.startswith("sha256="):
        return False
    expected = hmac.new(
        get_settings().meta_app_secret.encode(), body, hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(signature.removeprefix("sha256="), expected)


def extract_messages(payload: dict[str, Any]) -> list[Incoming]:
    messages: list[Incoming] = []
    object_type = payload.get("object")
    for entry in payload.get("entry", []):
        if object_type == "whatsapp_business_account":
            for change in entry.get("changes", []):
                value = change.get("value") or {}
                account_id = str((value.get("metadata") or {}).get("phone_number_id") or "")
                names = {
                    str(item.get("wa_id")): (item.get("profile") or {}).get("name")
                    for item in value.get("contacts", [])
                }
                for item in value.get("messages", []):
                    media = []
                    kind = item.get("type")
                    if kind in ("image", "video", "audio", "document", "sticker"):
                        attachment = item.get(kind) or {}
                        media = [{"type": kind, "id": attachment.get("id"),
                                  "mime_type": attachment.get("mime_type"),
                                  "filename": attachment.get("filename")}]
                    messages.append(Incoming(
                        "whatsapp", account_id, str(item.get("from") or ""),
                        str(item.get("id") or ""), (item.get("text") or {}).get("body")
                        or (item.get(kind) or {}).get("caption"), media,
                        names.get(str(item.get("from"))),
                    ))
        elif object_type in ("page", "instagram"):
            channel = "instagram" if object_type == "instagram" else "messenger"
            account_id = str(entry.get("id") or "")
            for item in entry.get("messaging", []):
                message = item.get("message") or {}
                if not message or message.get("is_echo"):
                    continue
                media = []
                for attachment in message.get("attachments", []):
                    attachment_payload = attachment.get("payload") or {}
                    media.append({"type": attachment.get("type"),
                                  "url": attachment_payload.get("url")})
                messages.append(Incoming(
                    channel, account_id, str((item.get("sender") or {}).get("id") or ""),
                    str(message.get("mid") or ""), message.get("text"), media,
                ))
    return [m for m in messages if m.account_id and m.sender_id and m.provider_id
            and (m.body or m.media)]


def extract_comments(payload: dict[str, Any]) -> list[IncomingComment]:
    result: list[IncomingComment] = []
    object_type = payload.get("object")
    if object_type not in ("page", "instagram"):
        return result
    channel = "instagram" if object_type == "instagram" else "messenger"
    for entry in payload.get("entry", []):
        account_id = str(entry.get("id") or "")
        for change in entry.get("changes", []):
            value = change.get("value") or {}
            if object_type == "page":
                if change.get("field") != "feed" or value.get("item") != "comment" or value.get("verb") != "add":
                    continue
                comment_id = str(value.get("comment_id") or "")
                post_id = str(value.get("post_id") or "")
                parent_id = value.get("parent_id")
                author = value.get("from") or {}
                body = str(value.get("message") or "")
            else:
                if change.get("field") != "comments":
                    continue
                comment_id = str(value.get("id") or "")
                post_id = str(value.get("media_id") or (value.get("media") or {}).get("id") or "")
                parent_id = value.get("parent_id")
                author = value.get("from") or {}
                body = str(value.get("text") or "")
            author_id = str(author.get("id") or "")
            if account_id and post_id and comment_id and author_id != account_id:
                result.append(IncomingComment(channel, account_id, post_id, comment_id,
                                              str(parent_id) if parent_id else None,
                                              author_id, str(author.get("name") or author.get("username") or ""),
                                              body))
    return result


def send_comment_reply(channel: str, comment_id: str, token: str, body: str) -> str:
    settings = get_settings()
    host = "graph.instagram.com" if channel == "instagram" else "graph.facebook.com"
    url = f"https://{host}/{settings.meta_graph_version}/{comment_id}/replies" if channel == "instagram" \
        else f"https://{host}/{settings.meta_graph_version}/{comment_id}/comments"
    with httpx.Client(timeout=15) as client:
        response = client.post(url, headers={"Authorization": f"Bearer {token}"},
                               data={"message": body})
    response.raise_for_status()
    reply_id = response.json().get("id")
    if not reply_id:
        raise ValueError("Meta returned no comment reply ID")
    return str(reply_id)


def send_text(channel: str, account_id: str, recipient_id: str,
              token: str, body: str) -> str:
    settings = get_settings()
    if channel == "instagram":
        url = f"https://graph.instagram.com/{settings.meta_graph_version}/me/messages"
        payload = {"recipient": {"id": recipient_id}, "message": {"text": body}}
    elif channel == "messenger":
        url = f"https://graph.facebook.com/{settings.meta_graph_version}/{account_id}/messages"
        payload = {"recipient": {"id": recipient_id}, "messaging_type": "RESPONSE",
                   "message": {"text": body}}
    elif channel == "whatsapp":
        url = f"https://graph.facebook.com/{settings.meta_graph_version}/{account_id}/messages"
        payload = {"messaging_product": "whatsapp", "recipient_type": "individual",
                   "to": recipient_id, "type": "text", "text": {"body": body}}
    else:
        raise ValueError("Unsupported channel")
    with httpx.Client(timeout=15) as client:
        response = client.post(url, headers={"Authorization": f"Bearer {token}"}, json=payload)
    response.raise_for_status()
    data = response.json()
    if channel == "whatsapp":
        result = (data.get("messages") or [{}])[0].get("id")
    else:
        result = data.get("message_id") or data.get("id")
    if not result:
        raise ValueError("Meta returned no message ID")
    return str(result)
