"""Redis fixed-window rate limits. Fails open (logs) when Redis is unreachable so an outage never blocks the API."""

import ipaddress
import logging
import time

import redis.asyncio as aioredis
from fastapi import HTTPException, Request

from .settings import get_settings

logger = logging.getLogger(__name__)


def client_ip(request: Request) -> str:
    """Real client IP. nginx overwrites X-Real-IP with $remote_addr; trust it only from a private/loopback peer
    (the docker gateway), because the API port is published on 127.0.0.1 only."""
    peer = request.client.host if request.client else ""
    try:
        trusted = ipaddress.ip_address(peer).is_private
    except ValueError:
        trusted = False
    forwarded = request.headers.get("x-real-ip", "").strip()
    if trusted and forwarded:
        try:
            return str(ipaddress.ip_address(forwarded))
        except ValueError:
            pass
    return peer or "unknown"


async def retry_after(key: str, limit: int, window: int) -> int:
    """Count one hit on `key`; return seconds to wait if over `limit` per `window` seconds, else 0."""
    now = time.time()
    bucket = f"rl:{key}:{int(now // window)}"
    client = aioredis.from_url(get_settings().redis_url, socket_connect_timeout=1, socket_timeout=1)
    try:
        async with client.pipeline(transaction=True) as pipe:
            count, _ = await pipe.incr(bucket).expire(bucket, window + 1).execute()
    except Exception:
        logger.warning("Rate limit check skipped for %s: Redis unavailable", key.split(":")[0])
        return 0
    finally:
        await client.aclose()
    if count <= limit:
        return 0
    return max(1, window - int(now % window))


async def enforce(key: str, limit: int, window: int) -> None:
    wait = await retry_after(key, limit, window)
    if wait:
        raise HTTPException(429, "Too many requests. Try again shortly.", headers={"Retry-After": str(wait)})
