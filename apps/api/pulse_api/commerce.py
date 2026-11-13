"""Tenant-scoped commerce API. Database functions own all state-changing rules."""

import asyncio
import csv
import hashlib
import io
import re
from typing import Annotated
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from urllib.parse import urlparse
from uuid import UUID, uuid4

import httpx
from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel, Field, StringConstraints

from .deps import Session, membership, user_limit
from .request_body import read_limited_body
from .settings import get_settings
from .store import eq, service_headers, service_request, storage_path, tenant_owned_path, user_request

router = APIRouter(prefix="/tenants/{tenant_id}/commerce", tags=["commerce"])

# Bounds match the columns: stock/quantity/discount_value are integer, money is bigint. MAX_MINOR keeps
# price x quantity (<= 10000) far inside bigint and equals the CSV importer's cap.
INT4_MAX = 2_147_483_647
MAX_MINOR = 9_000_000_000_000
OptionName = Annotated[str, StringConstraints(min_length=1, max_length=50)]
OptionValue = Annotated[str, StringConstraints(min_length=1, max_length=100)]


def _media(tenant_id: UUID, items: list[dict]) -> list[dict]:
    if len(items) > 20:
        raise HTTPException(422, "At most 20 images are allowed")
    checked = []
    for item in items:
        path, url = item.get("path"), item.get("url")
        if path and tenant_owned_path(tenant_id, path):
            checked.append({"path": path})
        elif url and isinstance(url, str):
            parsed = urlparse(url)
            host = parsed.hostname or ""
            if parsed.scheme != "https" or parsed.username or parsed.password or not host or \
               host == "localhost" or host.endswith(".local") or re.fullmatch(r"[\d.]+", host):
                raise HTTPException(422, "Image URL must be a public HTTPS URL")
            checked.append({"url": url})
        else:
            raise HTTPException(422, "Invalid image reference")
    return checked


class VariantInput(BaseModel):
    id: UUID | None = None
    sku: str = Field(default="", max_length=80)
    options: dict[OptionName, OptionValue] = Field(default_factory=dict, max_length=10)
    regular_price_minor: int = Field(ge=0, le=MAX_MINOR)
    offer_price_minor: int | None = Field(default=None, ge=0, le=MAX_MINOR)
    stock: int = Field(default=0, ge=0, le=INT4_MAX)


class ProductInput(BaseModel):
    id: UUID | None = None
    handle: str | None = Field(default=None, pattern=r"^[a-z0-9][a-z0-9-]{0,79}$")
    title: str = Field(min_length=1, max_length=160)
    category: str = Field(default="", max_length=100)
    description: str = Field(default="", max_length=5000)
    media: list[dict] = Field(default_factory=list, max_length=20)
    delivery_minor: int | None = Field(default=None, ge=0, le=MAX_MINOR)
    state: str = Field(default="draft", pattern="^(draft|active)$")
    variants: list[VariantInput] = Field(min_length=1, max_length=100)


class CurrencyInput(BaseModel):
    currency: str = Field(pattern="^(BDT|USD|EUR|GBP)$")


class StockInput(BaseModel):
    delta: int = Field(ge=-INT4_MAX, le=INT4_MAX)
    reason: str = Field(min_length=1, max_length=240)


class CsvInput(BaseModel):
    csv_text: str = Field(min_length=1, max_length=1_000_000)
    sha256: str | None = Field(default=None, pattern=r"^[a-f0-9]{64}$")


class OrderLine(BaseModel):
    variant_id: UUID
    quantity: int = Field(ge=1, le=10000)


class OrderInput(BaseModel):
    id: UUID | None = None
    customer_name: str = Field(default="", max_length=160)
    customer_phone: str = Field(default="", max_length=40)
    delivery_address: str = Field(default="", max_length=1000)
    discount_type: str = Field(default="none", pattern="^(none|amount|percent)$")
    discount_value: int = Field(default=0, ge=0, le=INT4_MAX)
    delivery_minor: int = Field(default=0, ge=0, le=MAX_MINOR)
    items: list[OrderLine] = Field(min_length=1, max_length=100)


class ConversationLink(BaseModel):
    conversation_id: UUID


class ActionInput(BaseModel):
    action: str = Field(pattern="^(submit|edit|confirm|process|complete|cancel)$")
    reason: str | None = Field(default=None, max_length=240)


class PaymentInput(BaseModel):
    amount_minor: int = Field(gt=0, le=MAX_MINOR)
    method: str = Field(pattern="^(cash|bank|card|bkash|nagad|rocket|other)$")
    note: str = Field(default="", max_length=240)


COURIERS = "^(pathao|steadfast|redx|paperfly|ecourier|sundarban|own_rider|other)$"


class HandoffInput(BaseModel):
    courier: str = Field(pattern=COURIERS)
    courier_name: str | None = Field(default=None, max_length=80)
    tracking_code: str | None = Field(default=None, max_length=100)
    delivery_fee_minor: int | None = Field(default=None, ge=0, le=MAX_MINOR)


class CourierStatusInput(BaseModel):
    state: str = Field(pattern="^(picked_up|in_transit|delivered|failed|review)$")


class DamagedItem(BaseModel):
    item_id: UUID
    quantity: int = Field(gt=0, le=10000)


class ReturnInput(BaseModel):
    damaged: list[DamagedItem] = Field(default_factory=list, max_length=100)
    damage_loss_minor: int = Field(default=0, ge=0, le=MAX_MINOR)
    delivery_fee_minor: int | None = Field(default=None, ge=0, le=MAX_MINOR)
    note: str = Field(default="", max_length=500)


@router.get("/config")
async def config(tenant_id: UUID, auth: Session):
    await membership(tenant_id, auth[0])
    tenant = await user_request("GET", "tenants", auth[0], params={
        "id": eq(str(tenant_id)), "select": "currency_code", "limit": "1",
    })
    products = await user_request("GET", "products", auth[0], params={
        "tenant_id": eq(str(tenant_id)), "select": "id", "limit": "1",
    })
    orders = await user_request("GET", "commerce_orders", auth[0], params={
        "tenant_id": eq(str(tenant_id)), "select": "id", "limit": "1",
    })
    return {"currency": tenant[0]["currency_code"], "currency_locked": bool(products or orders)}


@router.post("/currency")
async def set_currency(tenant_id: UUID, data: CurrencyInput, auth: Session):
    await membership(tenant_id, auth[0])
    value = await user_request("POST", "rpc/pulse_set_currency", auth[0], body={
        "p_tenant_id": str(tenant_id), "p_currency": data.currency,
    })
    return {"currency": value}


@router.get("/products")
async def products(tenant_id: UUID, auth: Session, q: str = Query("", max_length=100)):
    await membership(tenant_id, auth[0])
    rows = await user_request("GET", "products", auth[0], params={
        "tenant_id": eq(str(tenant_id)), "select": "*,product_variants(*)",
        "order": "updated_at.desc", "limit": "500",
    })
    needle = q.casefold().strip()
    rows = [row for row in rows if not needle or needle in row["title"].casefold()
            or needle in row["handle"].casefold()]
    await _attach_covers(str(tenant_id), rows)
    return rows


async def _attach_covers(tenant_id: str, rows: list[dict]) -> None:
    """Give each product a short-lived `cover_url` from its first photo, signed in one storage call."""
    paths: dict[str, list[dict]] = {}
    for row in rows:
        cover = (row.get("media") or [None])[0]
        row["cover_url"] = None
        if isinstance(cover, dict) and isinstance(cover.get("url"), str):
            row["cover_url"] = cover["url"]
        elif isinstance(cover, dict) and str(cover.get("path", "")).startswith(f"{tenant_id}/"):
            paths.setdefault(cover["path"], []).append(row)
    if not paths:
        return
    settings = get_settings()
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.post(
                f"{settings.supabase_url}/storage/v1/object/sign/catalog-media",
                headers=service_headers(), json={"expiresIn": 3600, "paths": list(paths)},
            )
        response.raise_for_status()
        signed = response.json()
    except (httpx.HTTPError, ValueError):
        return  # Cards fall back to a placeholder; the list itself must still load.
    for item in signed if isinstance(signed, list) else []:
        url = item.get("signedURL") if isinstance(item, dict) else None
        for row in paths.get(item.get("path", "") if isinstance(item, dict) else "", []):
            if url:
                row["cover_url"] = f"{settings.supabase_url}/storage/v1{url}"


def _auto_handle(title: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", title.casefold()).strip("-")[:55].strip("-") or "product"
    return f"{slug}-{uuid4().hex[:8]}"


async def _resolve_handle(tenant_id: UUID, data: "ProductInput", token: str) -> str:
    if data.handle:
        return data.handle
    if data.id:
        rows = await user_request("GET", "products", token, params={
            "id": eq(str(data.id)), "tenant_id": eq(str(tenant_id)), "select": "handle", "limit": "1",
        })
        if rows:
            return rows[0]["handle"]
    return _auto_handle(data.title)


@router.post("/products")
async def save_product(tenant_id: UUID, data: ProductInput, auth: Session):
    await membership(tenant_id, auth[0])
    media = _media(tenant_id, data.media)
    if data.state == "active" and not media:
        raise HTTPException(422, "Active product needs an image")
    for variant in data.variants:
        variant.sku = variant.sku.strip() or f"P-{uuid4().hex[:8].upper()}"
    if len({v.sku.casefold() for v in data.variants}) != len(data.variants):
        raise HTTPException(422, "Duplicate variant SKU")
    handle = await _resolve_handle(tenant_id, data, auth[0])
    result = await user_request("POST", "rpc/pulse_save_product", auth[0], body={
        "p_tenant_id": str(tenant_id), "p_id": str(data.id) if data.id else None,
        "p_handle": handle, "p_title": data.title, "p_category": data.category,
        "p_description": data.description, "p_media": media,
        "p_delivery_minor": data.delivery_minor, "p_state": data.state,
        "p_variants": [v.model_dump(mode="json") for v in data.variants],
    })
    _queue_photo_index(result)
    return {"id": result}


def _queue_photo_index(product_id: str) -> None:
    # Best effort: the periodic indexer picks up anything missed here.
    from .tasks import index_product_images
    try:
        index_product_images.apply_async(args=[str(product_id)], retry=False)
    except Exception:
        pass


@router.post("/products/{product_id}/remove")
async def remove_product(tenant_id: UUID, product_id: UUID, auth: Session):
    await membership(tenant_id, auth[0])
    rows = await user_request("GET", "products", auth[0], params={
        "id": eq(str(product_id)), "tenant_id": eq(str(tenant_id)), "select": "id", "limit": "1",
    })
    if not rows:
        raise HTTPException(404, "Product not found")
    result = await user_request("POST", "rpc/pulse_remove_product", auth[0], body={
        "p_product_id": str(product_id),
    })
    return {"result": result}


@router.post("/products/{product_id}/restore")
async def restore_product(tenant_id: UUID, product_id: UUID, auth: Session):
    await membership(tenant_id, auth[0])
    await user_request("POST", "rpc/pulse_restore_product", auth[0], body={
        "p_product_id": str(product_id),
    })
    return {"id": str(product_id)}


@router.post("/variants/{variant_id}/stock")
async def adjust_stock(tenant_id: UUID, variant_id: UUID, data: StockInput, auth: Session):
    await membership(tenant_id, auth[0])
    rows = await user_request("GET", "product_variants", auth[0], params={
        "id": eq(str(variant_id)), "tenant_id": eq(str(tenant_id)), "select": "id", "limit": "1",
    })
    if not rows:
        raise HTTPException(404, "Variant not found")
    stock = await user_request("POST", "rpc/pulse_adjust_stock", auth[0], body={
        "p_variant_id": str(variant_id), "p_delta": data.delta, "p_reason": data.reason,
    })
    return {"stock": stock}


@router.get("/variants/{variant_id}/movements")
async def movements(tenant_id: UUID, variant_id: UUID, auth: Session):
    await membership(tenant_id, auth[0])
    return await user_request("GET", "stock_movements", auth[0], params={
        "tenant_id": eq(str(tenant_id)), "variant_id": eq(str(variant_id)),
        "select": "id,delta,reason,created_at,actor_user_id,order_id",
        "order": "created_at.desc", "limit": "100",
    })


def _minor(raw: str, label: str, optional: bool = False) -> int | None:
    if not raw.strip() and optional:
        return None
    try:
        number = Decimal(raw)
        if not number.is_finite() or number < 0 or number.as_tuple().exponent < -2:
            raise InvalidOperation
        result = int(number * 100)
        if result > MAX_MINOR:
            raise InvalidOperation
        return result
    except (InvalidOperation, ValueError):
        raise ValueError(f"Invalid {label}") from None


CSV_COLUMNS = ("product_key", "title", "category", "description", "sku", "options",
               "regular_price", "offer_price", "stock", "image_urls", "delivery_charge")


def parse_csv(text: str, tenant_id: UUID) -> tuple[list[dict], list[dict]]:
    reader = csv.DictReader(io.StringIO(text.lstrip("\ufeff")))
    if not reader.fieldnames or any(column not in reader.fieldnames for column in CSV_COLUMNS):
        return [], [{"row": 1, "error": "CSV columns do not match the template"}]
    grouped: dict[str, dict] = {}
    errors: list[dict] = []
    used_skus: set[str] = set()
    for index, row in enumerate(reader, start=2):
        if index > 1001:
            errors.append({"row": index, "error": "Maximum 1000 rows"})
            break
        try:
            key = (row["product_key"] or "").strip()
            title = (row["title"] or "").strip()
            sku = (row["sku"] or "").strip()
            if not re.fullmatch(r"[a-z0-9][a-z0-9-]{0,79}", key) or not title or not sku:
                raise ValueError("Product key, title, and SKU are required")
            if len(title) > 160 or len(sku) > 80 or len(row["category"] or "") > 100 \
                    or len(row["description"] or "") > 5000:
                raise ValueError("Title, SKU, category, or description is too long")
            stock = int(row["stock"] or "0")
            if stock < 0 or stock > INT4_MAX:
                raise ValueError("Stock must be 0 to 2147483647")
            options = {}
            for pair in (row["options"] or "").split("|"):
                if pair:
                    if "=" not in pair:
                        raise ValueError("Options must use Name=Value pairs")
                    name, value = (part.strip() for part in pair.split("=", 1))
                    if not name or not value or name in options or len(name) > 50 or len(value) > 100:
                        raise ValueError("Invalid option")
                    options[name] = value
            if len(options) > 10:
                raise ValueError("At most 10 options per variant")
            media = _media(tenant_id, [{"url": url.strip()} for url in
                (row["image_urls"] or "").split("|") if url.strip()])
            regular = _minor(row["regular_price"] or "", "regular price")
            offer = _minor(row["offer_price"] or "", "offer price", optional=True)
            delivery = _minor(row["delivery_charge"] or "", "delivery charge", optional=True)
            if offer is not None and offer > regular:
                raise ValueError("Offer price exceeds regular price")
            if sku.casefold() in used_skus:
                raise ValueError("Duplicate SKU")
            used_skus.add(sku.casefold())
            product = grouped.setdefault(key, {"handle": key, "title": title,
                "category": row["category"] or "", "description": row["description"] or "",
                "media": media, "delivery_minor": delivery,
                "state": "active" if media else "draft", "variants": []})
            if (product["title"] != title or product["category"] != (row["category"] or "")
                or product["description"] != (row["description"] or "")
                or product["media"] != media or product["delivery_minor"] != delivery):
                raise ValueError("Grouped product details differ between rows")
            if len(product["variants"]) >= 100:
                raise ValueError("Maximum 100 variants per product")
            product["variants"].append({"sku": sku, "options": options,
                "regular_price_minor": regular, "offer_price_minor": offer, "stock": stock})
        except (ValueError, KeyError, TypeError, HTTPException) as exc:
            errors.append({"row": index, "error": str(exc.detail if isinstance(exc, HTTPException) else exc)})
    return list(grouped.values()), errors


@router.post("/csv/preview", dependencies=[user_limit("csv", 20, 60)])
async def csv_preview(tenant_id: UUID, data: CsvInput, auth: Session):
    await membership(tenant_id, auth[0])
    products, errors = parse_csv(data.csv_text, tenant_id)
    return {"sha256": hashlib.sha256(data.csv_text.encode()).hexdigest(),
            "products": products, "errors": errors, "product_count": len(products),
            "variant_count": sum(len(p["variants"]) for p in products)}


@router.post("/csv/commit", dependencies=[user_limit("csv", 20, 60)])
async def csv_commit(tenant_id: UUID, data: CsvInput, auth: Session):
    await membership(tenant_id, auth[0])
    digest = hashlib.sha256(data.csv_text.encode()).hexdigest()
    if data.sha256 != digest:
        raise HTTPException(409, "CSV changed after preview")
    products, errors = parse_csv(data.csv_text, tenant_id)
    if errors or not products:
        raise HTTPException(422, {"errors": errors or [{"row": 1, "error": "No rows"}]})
    count = await user_request("POST", "rpc/pulse_import_products", auth[0], body={
        "p_tenant_id": str(tenant_id), "p_products": products,
    })
    return {"imported": count}


@router.get("/orders")
async def orders(tenant_id: UUID, auth: Session, state: str | None = None,
                 include_archived: bool = False):
    await membership(tenant_id, auth[0])
    params = {"tenant_id": eq(str(tenant_id)), "select": "*,commerce_payments(amount_minor)", "order": "created_at.desc", "limit": "200"}
    if not include_archived:
        params["archived_at"] = "is.null"
    if state:
        if state not in ("draft","pending_confirmation","confirmed","processing","completed","cancelled"):
            raise HTTPException(422, "Invalid state")
        params["state"] = eq(state)
    rows = await user_request("GET", "commerce_orders", auth[0], params=params)
    return [_payment_totals(row) for row in rows]


@router.get("/orders/unseen-count")
async def unseen_agent_orders(tenant_id: UUID, auth: Session):
    """AI-created orders nobody has opened yet, for the Orders nav badge."""
    await membership(tenant_id, auth[0])
    rows = await user_request("GET", "commerce_orders", auth[0], params={
        "tenant_id": eq(str(tenant_id)), "source": "eq.agent", "seen_at": "is.null",
        "archived_at": "is.null", "select": "id", "limit": "100",
    })
    return {"count": len(rows)}


def _payment_totals(row: dict) -> dict:
    paid = sum(item["amount_minor"] for item in row.get("commerce_payments", []))
    row["paid_minor"] = paid
    row["refund_due_minor"] = paid if row["state"] == "cancelled" else 0
    return row


@router.get("/orders/{order_id}")
async def order_detail(tenant_id: UUID, order_id: UUID, auth: Session):
    await membership(tenant_id, auth[0])
    rows = await user_request("GET", "commerce_orders", auth[0], params={
        "id": eq(str(order_id)), "tenant_id": eq(str(tenant_id)),
        "select": "*,commerce_order_items(*),commerce_payments(*)", "limit": "1",
    })
    if not rows:
        raise HTTPException(404, "Order not found")
    return _payment_totals(rows[0])


@router.post("/orders")
async def save_order(tenant_id: UUID, data: OrderInput, auth: Session):
    await membership(tenant_id, auth[0])
    order_id = await user_request("POST", "rpc/pulse_save_order", auth[0], body={
        "p_tenant_id": str(tenant_id), "p_id": str(data.id) if data.id else None,
        "p_customer_name": data.customer_name, "p_customer_phone": data.customer_phone,
        "p_delivery_address": data.delivery_address, "p_discount_type": data.discount_type,
        "p_discount_value": data.discount_value, "p_delivery_minor": data.delivery_minor,
        "p_items": [item.model_dump(mode="json") for item in data.items],
    })
    return {"id": order_id}


@router.post("/orders/{order_id}/action")
async def order_action(tenant_id: UUID, order_id: UUID, data: ActionInput, auth: Session):
    await order_detail(tenant_id, order_id, auth)
    return await user_request("POST", "rpc/pulse_order_action", auth[0], body={
        "p_order_id": str(order_id), "p_action": data.action, "p_reason": data.reason,
    })


@router.post("/orders/{order_id}/seen")
async def mark_order_seen(tenant_id: UUID, order_id: UUID, auth: Session):
    await membership(tenant_id, auth[0])
    rows = await asyncio.to_thread(service_request, "PATCH", "commerce_orders", params={
        "id": eq(str(order_id)), "tenant_id": eq(str(tenant_id)), "seen_at": "is.null",
    }, body={"seen_at": datetime.now(timezone.utc).isoformat()}, prefer="return=representation")
    return {"seen": bool(rows)}


@router.post("/orders/{order_id}/archive")
async def archive_order(tenant_id: UUID, order_id: UUID, archive: bool, auth: Session):
    member = await membership(tenant_id, auth[0])
    if member["role"] not in ("owner", "manager"):
        raise HTTPException(403, "Order management access required")
    return await user_request("POST", "rpc/pulse_archive_order", auth[0], body={
        "p_tenant_id": str(tenant_id), "p_order_id": str(order_id),
        "p_archive": archive,
    })


async def _shipment_manager(tenant_id: UUID, token: str) -> None:
    member = await membership(tenant_id, token)
    if member["role"] not in ("owner", "manager"):
        raise HTTPException(403, "Shipment management access required")


@router.get("/orders/{order_id}/shipment")
async def order_shipment(tenant_id: UUID, order_id: UUID, auth: Session):
    await membership(tenant_id, auth[0])
    rows = await user_request("GET", "commerce_shipments", auth[0], params={
        "tenant_id": eq(str(tenant_id)), "order_id": eq(str(order_id)),
        "select": "*,commerce_shipment_return_items(order_item_id,damaged_quantity)", "limit": "1",
    })
    return rows[0] if rows else None


@router.post("/orders/{order_id}/shipment")
async def courier_handoff(tenant_id: UUID, order_id: UUID, data: HandoffInput, auth: Session):
    await _shipment_manager(tenant_id, auth[0])
    return await user_request("POST", "rpc/pulse_courier_handoff", auth[0], body={
        "p_tenant_id": str(tenant_id), "p_order_id": str(order_id), "p_courier": data.courier,
        "p_courier_name": data.courier_name, "p_tracking_code": data.tracking_code,
        "p_delivery_fee_minor": data.delivery_fee_minor,
    })


@router.post("/orders/{order_id}/shipment/status")
async def courier_status(tenant_id: UUID, order_id: UUID, data: CourierStatusInput, auth: Session):
    await _shipment_manager(tenant_id, auth[0])
    return await user_request("POST", "rpc/pulse_courier_status", auth[0], body={
        "p_tenant_id": str(tenant_id), "p_order_id": str(order_id), "p_state": data.state,
    })


@router.post("/orders/{order_id}/shipment/return")
async def courier_return(tenant_id: UUID, order_id: UUID, data: ReturnInput, auth: Session):
    await _shipment_manager(tenant_id, auth[0])
    return await user_request("POST", "rpc/pulse_courier_return", auth[0], body={
        "p_tenant_id": str(tenant_id), "p_order_id": str(order_id),
        "p_damaged": [{"item_id": str(item.item_id), "quantity": item.quantity} for item in data.damaged],
        "p_damage_loss_minor": data.damage_loss_minor,
        "p_delivery_fee_minor": data.delivery_fee_minor, "p_note": data.note,
    })


@router.post("/orders/{order_id}/conversation")
async def attach_order_conversation(tenant_id: UUID, order_id: UUID,
                                    data: ConversationLink, auth: Session):
    await membership(tenant_id, auth[0])
    linked = await user_request("POST", "rpc/pulse_attach_order_to_conversation", auth[0], body={
        "p_tenant_id": str(tenant_id), "p_order_id": str(order_id),
        "p_conversation_id": str(data.conversation_id),
    })
    return {"id": linked}


@router.post("/orders/{order_id}/payments")
async def record_payment(tenant_id: UUID, order_id: UUID, data: PaymentInput, auth: Session):
    await order_detail(tenant_id, order_id, auth)
    payment_id = await user_request("POST", "rpc/pulse_record_payment", auth[0], body={
        "p_order_id": str(order_id), "p_amount_minor": data.amount_minor,
        "p_method": data.method, "p_note": data.note,
    })
    return {"id": payment_id}


@router.post("/media", dependencies=[user_limit("media-upload", 60, 60)])
async def upload_media(tenant_id: UUID, request: Request, auth: Session):
    await membership(tenant_id, auth[0])
    mime = request.headers.get("content-type", "").split(";")[0]
    if mime not in ("image/jpeg", "image/png", "image/webp"):
        raise HTTPException(415, "Only JPEG, PNG, and WebP images are supported")
    data = await read_limited_body(request, 15 * 1024 * 1024, "Image must be 1 byte to 15 MB")
    if not data:
        raise HTTPException(413, "Image must be 1 byte to 15 MB")
    path = f"{tenant_id}/{uuid4().hex}"
    settings = get_settings()
    async with httpx.AsyncClient(timeout=30) as client:
        response = await client.post(
            f"{settings.supabase_url}/storage/v1/object/catalog-media/{storage_path(path)}",
            headers=service_headers(mime), content=data,
        )
    if response.status_code >= 400:
        raise HTTPException(502, "Image upload failed")
    return {"path": path}


@router.get("/media/sign")
async def sign_media(tenant_id: UUID, auth: Session, path: Annotated[str, Query(max_length=300)]):
    await membership(tenant_id, auth[0])
    if not tenant_owned_path(tenant_id, path):
        raise HTTPException(404, "Image not found")
    settings = get_settings()
    async with httpx.AsyncClient(timeout=10) as client:
        response = await client.post(
            f"{settings.supabase_url}/storage/v1/object/sign/catalog-media/{storage_path(path)}",
            headers=service_headers(),
            json={"expiresIn": 300},
        )
    if response.status_code != 200:
        raise HTTPException(502, "Image link failed")
    return {"url": f"{settings.supabase_url}/storage/v1{response.json()['signedURL']}"}
