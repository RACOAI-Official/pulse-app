import logging
from datetime import datetime, timezone, timedelta

import redis

import httpx
from celery import Celery
from cryptography.fernet import Fernet

from .media import save_media
from . import vision
from .agent import (catalog_facts, config_for_tenant, extract_order, generate_reply, is_bengali, media_reply_for, with_delivery,
                    order_confirmation, product_facts, recent_history, resolve_order_items)
from .meta import send_comment_reply, send_text
from .settings import get_settings
from .store import StoreError, eq, service_headers, service_request

logger = logging.getLogger(__name__)
celery_app = Celery("pulse", broker=get_settings().redis_url)
# Never give up on the broker: after Redis outages the worker must resume on its own.
celery_app.conf.broker_connection_retry_on_startup = True
celery_app.conf.broker_connection_max_retries = None
celery_app.conf.beat_schedule = {
    "reconcile-pending": {"task": "pulse.reconcile", "schedule": 30.0},
    "reconcile-agent": {"task": "pulse.reconcile_agent", "schedule": 30.0},
    "purge-retention": {"task": "pulse.purge_retention", "schedule": 86400.0},
    "reconcile-billing": {"task": "pulse.reconcile_billing", "schedule": 3600.0},
    "roll-credit-cycles": {"task": "pulse.roll_credit_cycles", "schedule": 900.0},
    "index-product-images": {"task": "pulse.index_pending_product_images", "schedule": 300.0},
    "refresh-instagram-tokens": {"task": "pulse.refresh_instagram_tokens", "schedule": 86400.0},
}


@celery_app.task(name="pulse.reconcile_billing")
def reconcile_billing() -> None:
    from .billing import reconcile
    reconcile()


@celery_app.task(name="pulse.refresh_instagram_tokens")
def refresh_instagram_tokens() -> None:
    from .meta_oauth import refresh_instagram_tokens as refresh
    logger.info("Refreshed %s Instagram tokens", refresh())


@celery_app.task(name="pulse.roll_credit_cycles")
def roll_credit_cycles() -> None:
    from .billing import roll_credit_cycles as roll
    logger.info("Rolled %s credit cycles", roll())


def _connection(connection_id: str) -> dict:
    rows = service_request("GET", "channel_connections", params={
        "id": eq(connection_id), "select": "*", "limit": "1",
    })
    if not rows:
        raise ValueError("Channel connection not found")
    return rows[0]


def _token(connection: dict) -> str:
    key = get_settings().pulse_credential_key
    if not key:
        raise RuntimeError("PULSE_CREDENTIAL_KEY is required")
    return Fernet(key.encode()).decrypt(connection["credential_ciphertext"].encode()).decode()


def _publish(tenant_id: str) -> None:
    try:
        with redis.Redis.from_url(get_settings().redis_url) as client:
            client.publish(f"tenant:{tenant_id}", "refresh")
    except redis.RedisError:
        logger.warning("Live update publish failed for tenant %s", tenant_id)


def _dispatch_outbound(message_id: str) -> None:
    try:
        send_outbound.delay(message_id)
    except Exception:
        # The queued message is durable and the regular reconciler will retry dispatch.
        logger.exception("Outbound dispatch failed for message %s", message_id)


def _dispatch_agent_job(message_id: str) -> None:
    try:
        jobs = service_request("GET", "agent_jobs", params={
            "source_message_id": eq(message_id), "select": "id,due_at", "limit": "1",
        })
        if jobs:
            due_at = datetime.fromisoformat(jobs[0]["due_at"].replace("Z", "+00:00"))
            process_agent_job.apply_async(args=[jobs[0]["id"]], eta=due_at)
    except Exception:
        # The periodic reconciler picks up durable jobs if lookup or dispatch fails.
        logger.exception("Agent dispatch failed for message %s", message_id)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _handoff_ticket(tenant_id: str, conversation_id: str) -> None:
    existing = service_request("GET", "support_tickets", params={
        "tenant_id": eq(tenant_id), "conversation_id": eq(conversation_id),
        "status": "eq.active", "select": "id", "limit": "1",
    })
    if existing:
        return
    try:
        service_request("POST", "support_tickets", body={
            "tenant_id": tenant_id, "conversation_id": conversation_id,
            "subject": "AI handoff requires attention", "source": "agent_handoff",
        })
    except Exception:
        # A simultaneous handoff can win the unique active-ticket constraint.
        logger.warning("Could not create handoff ticket for conversation %s", conversation_id)


@celery_app.task(name="pulse.process_webhook")
def process_webhook(event_id: str) -> None:
    event = service_request("POST", "rpc/pulse_claim_webhook", body={"p_event_id": event_id})
    if not event:
        return
    try:
        connection = _connection(event["connection_id"])
        incoming = event["payload"]
        token = _token(connection)
        existing = service_request("GET", "messages", params={
            "tenant_id": eq(event["tenant_id"]), "channel": eq(connection["channel"]),
            "provider_id": eq(incoming["provider_id"]), "select": "id", "limit": "1",
        })
        message_id = None
        if not existing:
            media = save_media(event["tenant_id"], incoming.get("media") or [], token)
            message_id = service_request("POST", "rpc/pulse_record_inbound", body={
                "p_connection_id": connection["id"],
                "p_thread_id": incoming["sender_id"],
                "p_provider_id": incoming["provider_id"],
                "p_body": incoming.get("body"),
                "p_media": media,
                "p_customer_name": incoming.get("customer_name"),
            })
        agent_enabled = config_for_tenant(event["tenant_id"])["enabled"] if message_id else False
        if message_id and get_settings().pulse_echo_mode and not agent_enabled and incoming.get("body"):
            # A sandbox-only echo is deliberately disabled when the human inbox is active.
            send_text(connection["channel"], connection["external_account_id"],
                      incoming["sender_id"], token, incoming["body"])
        service_request("PATCH", "webhook_events", params={"id": eq(event_id)},
                        body={"status": "done", "processed_at": _now(), "last_error": None})
        if message_id and agent_enabled:
            _dispatch_agent_job(message_id)
        _publish(event["tenant_id"])
    except Exception as exc:
        logger.exception("Webhook event processing failed: %s", event_id)
        status = "failed" if event["attempts"] >= 5 else "pending"
        service_request("PATCH", "webhook_events", params={"id": eq(event_id)},
                        body={"status": status, "last_error": str(exc)[:500]})


@celery_app.task(name="pulse.process_agent_job")
def process_agent_job(job_id: str) -> None:
    job = service_request("POST", "rpc/pulse_claim_agent_job", body={"p_job_id": job_id})
    if not job:
        return
    handoff = job["kind"] == "media"
    config: dict = {}
    prompt = ""
    charged = False
    try:
        from .billing import consume_credit, has_access
        if not has_access(job["tenant_id"]):
            service_request("PATCH", "agent_jobs", params={"id": eq(job_id)},
                            body={"status": "cancelled"})
            return
        config = config_for_tenant(job["tenant_id"])
        if not config["enabled"] or not config["published"]:
            service_request("PATCH", "agent_jobs", params={"id": eq(job_id)},
                            body={"status": "cancelled"})
            return
        photo_facts = _photo_matches(job) if handoff else None
        if photo_facts:
            handoff = False
        if handoff:
            reply = media_reply_for(config["published"])
        else:
            rows = service_request("GET", "messages", params={
                "conversation_id": eq(job["conversation_id"]),
                "direction": "eq.inbound", "created_at": f"gte.{job['first_at']}",
                "select": "id,body,created_at", "order": "created_at.asc", "limit": "10",
            })
            prompt = "\n".join(row["body"] for row in rows if row.get("body"))
            if photo_facts:
                prompt = (PHOTO_NOTE + "\n" + prompt).strip()
            if not prompt.strip():
                raise ValueError("No text in agent job")
            history = recent_history(job["conversation_id"], job["first_at"])
            # Search the whole recent thread so follow-ups ("yes", "L size, 3 pcs") keep product context.
            context = "\n".join(item["content"] for item in history) + "\n" + prompt
            facts = photo_facts or catalog_facts(job["tenant_id"], context)
            profile = _customer_profile(job["conversation_id"])
            # 1 credit = 1 AI reply. Out of credits: AI pauses and the team takes over.
            if not consume_credit(job["tenant_id"], job_id):
                logger.info("AI credits exhausted for tenant %s; job %s left for humans", job["tenant_id"], job_id)
                service_request("PATCH", "agent_jobs", params={"id": eq(job_id)},
                                body={"status": "cancelled"})
                _handoff_ticket(job["tenant_id"], job["conversation_id"])
                return
            charged = True
            reply = generate_reply(with_delivery(config["published"], job["tenant_id"]), prompt, facts, history, profile)
            charged = False  # The model answered; the credit is spent even if delivery fails later.
            proposal = extract_order(reply)
            if proposal:
                reply, handoff = _place_agent_order(job, proposal, is_bengali(context))
        reply_id = service_request("POST", "rpc/pulse_complete_agent_job", body={
            "p_job_id": job_id, "p_body": reply, "p_handoff": handoff,
        })
        if reply_id:
            _dispatch_outbound(reply_id)
            _publish(job["tenant_id"])
        if handoff:
            _handoff_ticket(job["tenant_id"], job["conversation_id"])
    except Exception as exc:
        logger.exception("Agent job failed: %s", job_id)
        if charged:  # The model call itself failed.
            try:
                from .billing import refund_credit
                refund_credit(job["tenant_id"], job_id)
            except Exception:
                logger.exception("Credit refund failed for job %s", job_id)
        try:
            fallback = media_reply_for(config.get("published"), prompt)
            reply_id = service_request("POST", "rpc/pulse_complete_agent_job", body={
                "p_job_id": job_id, "p_body": fallback, "p_handoff": True,
            })
            if reply_id:
                _dispatch_outbound(reply_id)
                _publish(job["tenant_id"])
            _handoff_ticket(job["tenant_id"], job["conversation_id"])
        except Exception:
            service_request("PATCH", "agent_jobs", params={"id": eq(job_id)},
                            body={"status": "failed", "last_error": type(exc).__name__})


PHOTO_NOTE = ("[The customer sent a photo. CURRENT CATALOG lists the products that look most like it, "
              "closest first. Tell them which product it looks like, with price and stock, and ask them "
              "to confirm it is the one they want. If several are listed, mention them briefly.]")


def _photo_matches(job: dict) -> list[dict] | None:
    """Catalog facts for products that look like the customer's photo, or None to hand off."""
    if not vision.enabled():
        return None
    try:
        rows = service_request("GET", "messages", params={
            "id": eq(job["source_message_id"]), "select": "media", "limit": "1",
        })
        media = (rows[0].get("media") or []) if rows else []
        photo = next((item for item in media if item.get("path")
                      and str(item.get("mime_type", "")).startswith("image/")), None)
        if not photo:
            return None
        matches = vision.match_photo(job["tenant_id"], vision.storage_bytes("inbox-media", photo["path"]))
        chosen = vision.confident_matches(matches)
        logger.info("Photo match for job %s: %s", job["id"],
                    [(m["product_id"], round(m["similarity"], 3)) for m in matches])
        return product_facts(job["tenant_id"], [m["product_id"] for m in chosen]) or None
    except Exception:
        logger.exception("Photo matching failed for job %s", job["id"])
        return None


@celery_app.task(name="pulse.index_product_images")
def index_product_images(product_id: str) -> None:
    if vision.enabled():
        vision.index_product(product_id)


@celery_app.task(name="pulse.index_pending_product_images")
def index_pending_product_images() -> None:
    if not vision.enabled():
        return
    for product_id in vision.products_needing_index():
        try:
            vision.index_product(product_id)
        except Exception:
            logger.exception("Indexing photos failed for product %s", product_id)


def _customer_profile(conversation_id: str) -> dict | None:
    """Saved name/phone/address for this conversation's customer, so the AI doesn't ask again."""
    try:
        rows = service_request("GET", "conversations", params={
            "id": eq(conversation_id),
            "select": "customer_profiles(display_name,phone,delivery_address)", "limit": "1",
        })
    except StoreError:
        logger.warning("Could not load customer profile for %s", conversation_id)
        return None
    return (rows[0].get("customer_profiles") if rows else None) or None


def _place_agent_order(job: dict, proposal: dict, bengali: bool) -> tuple[str, bool]:
    """Create a draft order for the team to review; return the customer reply and handoff flag."""
    try:
        items = resolve_order_items(job["tenant_id"], proposal["items"])
        result = service_request("POST", "rpc/pulse_agent_create_order", body={
            "p_tenant_id": job["tenant_id"], "p_conversation_id": job["conversation_id"],
            "p_agent_job_id": job["id"], "p_customer_name": proposal["customer_name"],
            "p_customer_phone": proposal["customer_phone"],
            "p_delivery_address": proposal["delivery_address"], "p_items": items,
        })
        if proposal.get("delivery_zone") and not result.get("existing"):
            priced = service_request("POST", "rpc/pulse_agent_apply_delivery_zone", body={
                "p_tenant_id": job["tenant_id"], "p_order_id": result["order_id"],
                "p_zone": proposal["delivery_zone"],
            })
            result = {**result, **priced}
    except (LookupError, StoreError) as exc:
        logger.warning("Agent order rejected for job %s: %s", job["id"], exc)
        if bengali:
            return ("দুঃখিত, এই মুহূর্তে অর্ডারটি নেওয়া যায়নি (পণ্যটি পরিবর্তিত হয়েছে)। "
                    "আমাদের একজন টিম মেম্বার শীঘ্রই আপনাকে সাহায্য করবেন।"), True
        return ("Sorry, I couldn't take that order right now (the item has changed). "
                "A team member will help you shortly."), True
    return order_confirmation(result, bengali), False


@celery_app.task(name="pulse.send_outbound")
def send_outbound(message_id: str) -> None:
    message = service_request("POST", "rpc/pulse_claim_outbound", body={"p_message_id": message_id})
    if not message:
        return
    try:
        from .billing import has_access
        if not has_access(message["tenant_id"]):
            raise ValueError("Subscription expired")
        conversations = service_request("GET", "conversations", params={
            "id": eq(message["conversation_id"]), "select": "*", "limit": "1",
        })
        conversation = conversations[0]
        connection = _connection(conversation["connection_id"])
        if connection["status"] != "connected":
            raise ValueError("Channel disconnected")
        # Meta's standard customer-service window applies to all three text channels here.
        last_inbound = datetime.fromisoformat(conversation["last_inbound_at"].replace("Z", "+00:00"))
        if datetime.now(timezone.utc) - last_inbound > timedelta(hours=24):
            raise ValueError("Reply window expired")
        provider_id = send_text(message["channel"], connection["external_account_id"],
                                conversation["external_thread_id"], _token(connection),
                                message["body"])
        service_request("PATCH", "messages", params={"id": eq(message_id)}, body={
            "delivery_state": "sent", "provider_id": provider_id, "sent_at": _now(),
            "failure_reason": None,
        })
        _publish(message["tenant_id"])
    except (httpx.TimeoutException, httpx.TransportError) as exc:
        logger.exception("Uncertain Meta delivery: %s", message_id)
        service_request("PATCH", "messages", params={"id": eq(message_id)}, body={
            "delivery_state": "uncertain", "failure_reason": str(exc)[:500],
        })
        _publish(message["tenant_id"])
    except httpx.HTTPStatusError as exc:
        # 5xx may have been accepted upstream, so do not retry automatically.
        state = "uncertain" if exc.response.status_code >= 500 else "failed"
        service_request("PATCH", "messages", params={"id": eq(message_id)}, body={
            "delivery_state": state, "failure_reason": f"Meta HTTP {exc.response.status_code}",
        })
        _publish(message["tenant_id"])
    except Exception as exc:
        logger.exception("Outbound send failed: %s", message_id)
        service_request("PATCH", "messages", params={"id": eq(message_id)}, body={
            "delivery_state": "failed", "failure_reason": str(exc)[:500],
        })
        _publish(message["tenant_id"])


@celery_app.task(name="pulse.send_public_comment_reply")
def send_public_comment_reply(comment_id: str) -> None:
    rows = service_request("PATCH", "public_comments", params={
        "id": eq(comment_id), "reply_status": "eq.queued", "select": "*",
    }, body={"reply_status": "sending"}, prefer="return=representation")
    if not rows:
        return
    comment = rows[0]
    try:
        connection = _connection(comment["connection_id"])
        if connection["status"] != "connected":
            raise ValueError("Channel disconnected")
        provider_id = send_comment_reply(comment["channel"], comment["provider_comment_id"],
                                         _token(connection), comment["reply_body"])
        service_request("PATCH", "public_comments", params={"id": eq(comment_id)}, body={
            "reply_status": "sent", "reply_provider_id": provider_id, "failure_reason": None,
        })
    except (httpx.TimeoutException, httpx.TransportError) as exc:
        service_request("PATCH", "public_comments", params={"id": eq(comment_id)}, body={
            "reply_status": "uncertain", "failure_reason": str(exc)[:500],
        })
    except httpx.HTTPStatusError as exc:
        state = "uncertain" if exc.response.status_code >= 500 else "failed"
        service_request("PATCH", "public_comments", params={"id": eq(comment_id)}, body={
            "reply_status": state, "failure_reason": f"Meta HTTP {exc.response.status_code}",
        })
    except Exception as exc:
        service_request("PATCH", "public_comments", params={"id": eq(comment_id)}, body={
            "reply_status": "failed", "failure_reason": str(exc)[:500],
        })
    _publish(comment["tenant_id"])


@celery_app.task(name="pulse.reconcile_agent")
def reconcile_agent_jobs() -> None:
    stale_agent = (datetime.now(timezone.utc) - timedelta(minutes=2)).isoformat()
    service_request("PATCH", "agent_jobs", params={
        "status": "eq.processing", "claimed_at": f"lt.{stale_agent}",
    }, body={"status": "pending", "claimed_at": None})
    jobs = service_request("GET", "agent_jobs", params={
        "status": "eq.pending", "due_at": f"lte.{_now()}",
        "select": "id", "order": "due_at.asc", "limit": "100",
    })
    for job in jobs:
        process_agent_job.delay(job["id"])


@celery_app.task(name="pulse.reconcile")
def reconcile() -> None:
    stale_cutoff = (datetime.now(timezone.utc) - timedelta(minutes=5)).isoformat()
    events = service_request("GET", "webhook_events", params={
        "status": "eq.pending", "select": "id", "limit": "100",
        "order": "created_at.asc",
    }) + service_request("GET", "webhook_events", params={
        "status": "eq.processing", "claimed_at": f"lt.{stale_cutoff}",
        "select": "id", "limit": "100", "order": "claimed_at.asc",
    })
    for item in events:
        process_webhook.delay(item["id"])
    messages = service_request("GET", "messages", params={
        "delivery_state": "eq.queued", "select": "id", "limit": "100",
    })
    for item in messages:
        send_outbound.delay(item["id"])
    comments = service_request("GET", "public_comments", params={
        "reply_status": "eq.queued", "select": "id", "limit": "100",
    })
    for item in comments:
        send_public_comment_reply.delay(item["id"])
    # A worker can die after Meta accepts a request. Never resend such messages blindly.
    cutoff = (datetime.now(timezone.utc) - timedelta(minutes=2)).isoformat()
    service_request("PATCH", "messages", params={
        "delivery_state": "eq.sending", "sending_at": f"lt.{cutoff}",
    }, body={"delivery_state": "uncertain", "failure_reason": "Worker stopped during send"})


@celery_app.task(name="pulse.purge_retention")
def purge_retention() -> None:
    settings = get_settings()
    media_cutoff = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
    service_request("DELETE", "agent_test_runs", params={"created_at": f"lt.{media_cutoff}"})
    text_cutoff = (datetime.now(timezone.utc) - timedelta(days=365)).isoformat()
    old_media = service_request("GET", "messages", params={
        "created_at": f"lt.{media_cutoff}", "media": "neq.[]",
        "select": "id,body,media", "limit": "100",
    })
    for message in old_media:
        paths = [item["path"] for item in message["media"] if item.get("path")]
        if paths:
            with httpx.Client(timeout=20) as client:
                response = client.request(
                    "DELETE", f"{settings.supabase_url}/storage/v1/object/inbox-media",
                    headers=service_headers(),
                    json={"prefixes": paths},
                )
            response.raise_for_status()
        update = {"media": []}
        if not message["body"]:
            update["body"] = "Attachment expired"
        service_request("PATCH", "messages", params={"id": eq(message["id"])},
                        body=update)
    # Remove webhook payloads sooner than message text; provider IDs in messages
    # continue to protect against normal replay inside the text retention period.
    service_request("DELETE", "webhook_events", params={
        "created_at": f"lt.{media_cutoff}", "status": "eq.done",
    })
    service_request("DELETE", "messages", params={"created_at": f"lt.{text_cutoff}"})
