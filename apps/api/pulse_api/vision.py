"""Visual product search: fingerprint product photos and match customer photos against them."""

import json
import logging

import httpx

from .settings import get_settings
from .store import eq, service_headers, service_request, storage_path

logger = logging.getLogger(__name__)
MAX_IMAGE_BYTES = 15 * 1024 * 1024


def enabled() -> bool:
    return bool(get_settings().vision_url)


def embed(image: bytes) -> list[float]:
    with httpx.Client(timeout=30) as client:
        response = client.post(f"{get_settings().vision_url.rstrip('/')}/embed", content=image,
                               headers={"Content-Type": "application/octet-stream"})
    response.raise_for_status()
    return response.json()["embedding"]


def storage_bytes(bucket: str, path: str) -> bytes:
    settings = get_settings()
    with httpx.Client(timeout=30) as client:
        response = client.get(f"{settings.supabase_url}/storage/v1/object/{bucket}/{storage_path(path)}",
                              headers=service_headers())
    response.raise_for_status()
    return response.content


def url_bytes(url: str) -> bytes:
    # Catalog URLs were validated as public HTTPS when the product was saved.
    with httpx.Client(timeout=20, follow_redirects=True, max_redirects=3) as client:
        with client.stream("GET", url) as response:
            response.raise_for_status()
            data = b""
            for chunk in response.iter_bytes():
                data += chunk
                if len(data) > MAX_IMAGE_BYTES:
                    raise ValueError("Image too large")
    return data


def _media_key(item: dict) -> str | None:
    return item.get("path") or item.get("url")


def index_product(product_id: str) -> int:
    """Fingerprint any new photos of a product and drop fingerprints of removed photos."""
    settings = get_settings()
    rows = service_request("GET", "products", params={
        "id": eq(product_id), "select": "id,tenant_id,media", "limit": "1",
    })
    if not rows:
        return 0
    product = rows[0]
    wanted = {key: item for item in product.get("media") or [] if (key := _media_key(item))}
    existing = service_request("GET", "product_image_embeddings", params={
        "product_id": eq(product_id), "select": "media_key,model",
    })
    done = {row["media_key"] for row in existing if row["model"] == settings.vision_model}
    for row in existing:
        if row["media_key"] not in wanted or row["model"] != settings.vision_model:
            service_request("DELETE", "product_image_embeddings", params={
                "product_id": eq(product_id), "media_key": eq(row["media_key"]),
            })
            done.discard(row["media_key"])
    added = 0
    for key, item in wanted.items():
        if key in done:
            continue
        try:
            image = storage_bytes("catalog-media", item["path"]) if "path" in item else url_bytes(item["url"])
            vector = embed(image)
        except (httpx.HTTPError, ValueError, KeyError) as exc:
            logger.warning("Could not fingerprint photo %s of product %s: %s", key, product_id, exc)
            continue
        service_request("POST", "product_image_embeddings", prefer="resolution=merge-duplicates", body={
            "product_id": product_id, "tenant_id": product["tenant_id"], "media_key": key,
            "model": settings.vision_model, "embedding": json.dumps(vector),
        })
        added += 1
    return added


def products_needing_index(limit: int = 25) -> list[str]:
    rows = service_request("POST", "rpc/pulse_products_needing_embeddings", body={
        "p_model": get_settings().vision_model, "p_limit": limit,
    })
    return [row["product_id"] for row in rows or []]


def match_photo(tenant_id: str, image: bytes, limit: int = 3) -> list[dict]:
    """Closest active products as [{product_id, similarity}], best first."""
    rows = service_request("POST", "rpc/pulse_match_product_images", body={
        "p_tenant_id": tenant_id, "p_embedding": json.dumps(embed(image)),
        "p_model": get_settings().vision_model, "p_limit": limit,
    })
    return rows or []


def confident_matches(matches: list[dict]) -> list[dict]:
    """Keep near-best matches only when the best one clears the confidence threshold."""
    threshold = get_settings().vision_match_threshold
    if not matches or matches[0]["similarity"] < threshold:
        return []
    best = matches[0]["similarity"]
    return [m for m in matches if m["similarity"] >= max(threshold - 0.1, best - 0.1)][:3]
