"""Pulse-owned subscription billing and AI credits.

Owners pay Pulse (not their customers) for the Pro or Enterprise plan, monthly or yearly.
USD/GBP go through Stripe as auto-renewing subscriptions; BDT goes through SSLCOMMERZ as
prepaid terms. Gateway notifications are verified with the provider before access changes.
"""

import asyncio
import hashlib
import hmac
import json
import logging
import math
import re
import time
from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation
from urllib.parse import parse_qs, urlparse
from uuid import UUID, uuid4

import httpx
from dateutil.relativedelta import relativedelta
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field

from .deps import Session, membership, owner, user_limit
from .request_body import read_limited_body
from .settings import get_settings
from .store import eq, service_request

router = APIRouter(prefix="/tenants/{tenant_id}/billing", tags=["billing"])
webhooks = APIRouter(tags=["billing-webhooks"])
logger = logging.getLogger(__name__)

PLANS = ("pro", "enterprise")
NAMES = {"pro": "Pro", "enterprise": "Enterprise"}
INTERVALS = ("month", "year")
CURRENCIES = ("USD", "GBP", "BDT")
STRIPE_CURRENCIES = ("USD", "GBP")
# Rough conversations/day each plan covers at ~8 AI replies per conversation.
REPLIES_PER_CONVERSATION = 8
RETURN_PATH = "/plan"
RETURN_PATHS = {"plan": "/plan", "onboarding": "/onboarding"}


class CheckoutInput(BaseModel):
    plan: str = Field(pattern="^(pro|enterprise)$")
    interval: str = Field(default="month", pattern="^(month|year)$")
    currency: str = Field(default="USD", pattern="^(USD|GBP|BDT)$")
    auto_renew: bool = True
    accepted_policies: bool = False
    billing_name: str = Field(default="", max_length=100)
    billing_phone: str = Field(default="", max_length=30)
    billing_address: str = Field(default="", max_length=200)
    billing_city: str = Field(default="", max_length=50)
    billing_postcode: str = Field(default="", max_length=10)
    return_to: str = Field(default="plan", pattern="^(plan|onboarding)$")


def provider_for(currency: str) -> str:
    return "sslcommerz" if currency == "BDT" else "stripe"


PRICE_CACHE_SECONDS = 60
_price_cache: tuple[float, dict] = (0.0, {})


def default_price(plan: str, interval: str, currency: str) -> int:
    return int(getattr(get_settings(), f"pulse_price_{plan}_{interval}_{currency.lower()}"))


def default_stripe_price_id(plan: str, interval: str, currency: str) -> str:
    return getattr(get_settings(), f"pulse_stripe_price_{plan}_{interval}_{currency.lower()}", "")


def live_prices(fresh: bool = False) -> dict[tuple[str, str, str], dict]:
    """Newest admin-set price per (plan, interval, currency); cached briefly per process."""
    global _price_cache
    now = time.monotonic()
    if not fresh and now - _price_cache[0] < PRICE_CACHE_SECONDS:
        return _price_cache[1]
    latest: dict[tuple[str, str, str], dict] = {}
    for row in rows("plan_price_versions", order="created_at.desc,id.desc", limit="1000",
                    select="plan_key,billing_interval,currency_code,amount_minor,stripe_price_id,created_at"):
        latest.setdefault((row["plan_key"], row["billing_interval"], row["currency_code"]), row)
    _price_cache = (now, latest)
    return latest


def clear_price_cache() -> None:
    global _price_cache
    _price_cache = (0.0, {})


def price(plan: str, interval: str, currency: str) -> int:
    row = live_prices().get((plan, interval, currency))
    return int(row["amount_minor"]) if row else default_price(plan, interval, currency)


def stripe_price_id(plan: str, interval: str, currency: str) -> str:
    row = live_prices().get((plan, interval, currency))
    return (row.get("stripe_price_id") or "") if row else default_stripe_price_id(plan, interval, currency)


def sold_stripe_prices(plan: str, interval: str, currency: str) -> dict[str, int]:
    """Every Stripe price ID Pulse has sold for this plan with its amount, so grandfathered
    subscriptions keep renewing at the price they bought."""
    known: dict[str, int] = {}
    original = default_stripe_price_id(plan, interval, currency)
    if original:
        known[original] = default_price(plan, interval, currency)
    for row in rows("plan_price_versions", plan_key=eq(plan), billing_interval=eq(interval),
                    currency_code=eq(currency), select="stripe_price_id,amount_minor"):
        if row.get("stripe_price_id"):
            known[row["stripe_price_id"]] = int(row["amount_minor"])
    return known


def subscription_amount(sub: dict, plan: str, interval: str, currency: str) -> int | None:
    """Amount a renewal must charge: the subscription's own (possibly older) Pulse price."""
    items = (sub.get("items") or {}).get("data") or []
    price_id = ((items[0].get("price") or {}).get("id") if len(items) == 1 else None)
    if not price_id:
        return price(plan, interval, currency)
    return sold_stripe_prices(plan, interval, currency).get(price_id)


def allowance(plan: str) -> int:
    return int(getattr(get_settings(), f"pulse_credits_{plan}"))


def term_delta(interval: str) -> relativedelta:
    return relativedelta(years=1) if interval == "year" else relativedelta(months=1)


def parse_time(value: str | None) -> datetime | None:
    return datetime.fromisoformat(value.replace("Z", "+00:00")) if value else None


def rows(table: str, **params) -> list[dict]:
    return service_request("GET", table, params=params)


def account(tenant_id: str) -> dict | None:
    found = rows("billing_accounts", tenant_id=eq(tenant_id), select="*", limit="1")
    return found[0] if found else None


def credits(tenant_id: str) -> dict | None:
    found = rows("credit_accounts", tenant_id=eq(tenant_id),
                 select="allowance,balance,bonus_balance,cycle_start,cycle_end", limit="1")
    return found[0] if found else None


def credit_summary(row: dict | None) -> dict:
    """Header view of AI credits; low means at most 10% of this cycle's allowance is left."""
    row = row or {}
    allowance = int(row.get("allowance") or 0)
    available = int(row.get("balance") or 0) + int(row.get("bonus_balance") or 0)
    return {"available": available, "allowance": allowance, "bonus_balance": int(row.get("bonus_balance") or 0),
            "cycle_end": row.get("cycle_end"),
            "low": available == 0 or (allowance > 0 and available * 10 <= allowance)}


def has_access(tenant_id: str) -> bool:
    return bool(service_request("POST", "rpc/pulse_billing_has_access", body={"p_tenant_id": tenant_id}))


def paid_access(tenant_id: str) -> bool:
    """True only for a paid, active plan; the free trial does not unlock integrations."""
    return is_active(account(tenant_id))


def require_paid(tenant_id: str) -> None:
    if not paid_access(tenant_id):
        raise HTTPException(402, "Integrations need Pro. Upgrade your plan to connect channels")


def consume_credit(tenant_id: str, source_id: str) -> bool:
    """Charge one AI reply. False means the workspace is out of credits."""
    return bool(service_request("POST", "rpc/pulse_credit_consume",
                                body={"p_tenant_id": tenant_id, "p_source_id": source_id}))


def refund_credit(tenant_id: str, source_id: str) -> None:
    service_request("POST", "rpc/pulse_credit_refund",
                    body={"p_tenant_id": tenant_id, "p_source_id": source_id})


def roll_credit_cycles() -> int:
    return int(service_request("POST", "rpc/pulse_credit_roll_cycles",
                               body={"p_allowances": {plan: allowance(plan) for plan in PLANS}}) or 0)


def providers() -> dict[str, bool]:
    settings = get_settings()
    public = settings.pulse_api_public_url.startswith("https://")
    web_secure = settings.pulse_web_origin.startswith("https://")
    policies = all(url.startswith("https://") for url in
                   (settings.pulse_terms_url, settings.pulse_privacy_url, settings.pulse_refund_url))
    return {"stripe": bool(public and settings.pulse_stripe_secret_key and settings.pulse_stripe_webhook_secret
                           and (not settings.pulse_stripe_secret_key.startswith("sk_live_") or web_secure and policies)),
            "sslcommerz": bool(public and settings.pulse_ssl_store_id and settings.pulse_ssl_store_passwd and
                                settings.pulse_ssl_environment in ("sandbox", "live") and
                                (settings.pulse_ssl_environment != "live" or web_secure and policies))}


def is_active(current: dict | None, now: datetime | None = None) -> bool:
    now = now or datetime.now(timezone.utc)
    paid_end = parse_time((current or {}).get("paid_through"))
    return bool(current and current.get("state") == "active" and paid_end and paid_end > now)


def upgrade_quote(current: dict, now: datetime | None = None) -> int:
    """Prorated price difference (minor units) for the rest of the current term, rounded up to a whole unit."""
    now = now or datetime.now(timezone.utc)
    interval, currency = current["billing_interval"], current["currency_code"]
    difference = price("enterprise", interval, currency) - price("pro", interval, currency)
    end = parse_time(current["paid_through"])
    start = parse_time(current.get("term_start")) or end - term_delta(interval)
    term = (end - start).total_seconds()
    remaining = max(0.0, (end - now).total_seconds())
    if term <= 0 or difference <= 0:
        return 0
    return math.ceil(difference * min(1.0, remaining / term) / 100) * 100


@router.get("/credits")
async def credit_status(tenant_id: UUID, auth: Session) -> dict:
    await membership(tenant_id, auth[0])
    return credit_summary(await asyncio.to_thread(credits, str(tenant_id)))


@router.get("")
async def status(tenant_id: UUID, auth: Session):
    await membership(tenant_id, auth[0])
    return await asyncio.to_thread(_status, tenant_id, auth)


def _status(tenant_id: UUID, auth: tuple[str, dict]):
    tenant = str(tenant_id)
    settings = get_settings()
    invoices = rows("billing_invoices", tenant_id=eq(tenant),
                    select="id,plan_key,billing_interval,kind,provider,amount_minor,currency_code,state,"
                           "period_start,period_end,paid_at,created_at",
                    order="created_at.desc", limit="50")
    current = account(tenant)
    visible = {key: current.get(key) for key in (
        "plan_key", "pending_plan_key", "billing_interval", "currency_code", "provider", "state",
        "auto_renew", "trial_ends_at", "term_start", "paid_through")} if current else None
    quote = None
    if current and is_active(current) and current.get("plan_key") == "pro":
        quote = {"amount_minor": upgrade_quote(current), "currency_code": current["currency_code"],
                 "estimate": current.get("provider") == "stripe"}
    plans = []
    for key in PLANS:
        monthly = allowance(key)
        plans.append({"key": key, "name": NAMES[key], "credits": monthly,
                      "conversations_per_day": round(monthly / REPLIES_PER_CONVERSATION / 30),
                      "prices": {interval: {currency: price(key, interval, currency) for currency in CURRENCIES}
                                 for interval in INTERVALS}})
    return {"account": visible, "credits": credits(tenant), "invoices": invoices,
            "access": has_access(tenant), "providers": providers(), "upgrade_quote": quote,
            "policies": {"terms": settings.pulse_terms_url, "privacy": settings.pulse_privacy_url,
                         "refund": settings.pulse_refund_url},
            "plans": plans}


def stripe(method: str, path: str, *, data: dict | None = None, key: str | None = None) -> dict:
    secret = get_settings().pulse_stripe_secret_key
    if not secret:
        raise HTTPException(503, "Stripe is not configured")
    headers = {"Authorization": f"Bearer {secret}"}
    if key:
        headers["Idempotency-Key"] = key
    with httpx.Client(timeout=30) as client:
        response = client.request(method, f"https://api.stripe.com/v1/{path}", headers=headers, data=data)
    if response.status_code >= 400:
        raise HTTPException(502, "Stripe billing request failed")
    return response.json()


def ssl_base() -> str:
    return ("https://sandbox.sslcommerz.com" if get_settings().pulse_ssl_environment == "sandbox"
            else "https://securepay.sslcommerz.com")


def ssl_session_status(session_id: str) -> dict:
    settings = get_settings()
    with httpx.Client(timeout=30) as client:
        response = client.get(f"{ssl_base()}/validator/api/merchantTransIDvalidationAPI.php",
            params={"sessionkey": session_id, "store_id": settings.pulse_ssl_store_id,
                    "store_passwd": settings.pulse_ssl_store_passwd, "format": "json"})
    response.raise_for_status()
    return response.json()


def ssl_session(checkout: dict, email: str, contact: dict) -> dict:
    settings = get_settings()
    callback = settings.pulse_api_public_url.rstrip("/") + "/webhooks/billing/sslcommerz"
    back = "?return=1" + ("&to=onboarding" if checkout.get("return_path") == "/onboarding" else "")
    label = ("upgrade to Enterprise" if checkout["kind"] == "upgrade" else
             f"{NAMES[checkout['plan_key']]} {'yearly' if checkout['billing_interval'] == 'year' else 'monthly'} subscription")
    form = {"store_id": settings.pulse_ssl_store_id, "store_passwd": settings.pulse_ssl_store_passwd,
            "total_amount": str((Decimal(checkout["amount_minor"]) / 100).quantize(Decimal("0.01"))), "currency": "BDT",
            "tran_id": checkout["merchant_transaction_id"],
            "success_url": callback + back, "fail_url": callback + back,
            "cancel_url": callback + back, "ipn_url": callback, "emi_option": "0",
            "cus_name": contact.get("billing_name") or "", "cus_email": email,
            "cus_add1": contact.get("billing_address") or "", "cus_phone": contact.get("billing_phone") or "",
            "cus_city": contact.get("billing_city") or "Dhaka", "cus_postcode": contact.get("billing_postcode") or "1000",
            "cus_country": "Bangladesh", "shipping_method": "NO",
            "product_name": f"Pulse {label}", "product_category": "software",
            "product_profile": "non-physical-goods", "value_a": checkout["id"]}
    with httpx.Client(timeout=30) as client:
        response = client.post(f"{ssl_base()}/gwprocess/v4/api.php", data=form)
    response.raise_for_status()
    payload = response.json()
    url = payload.get("GatewayPageURL", "")
    session_id = payload.get("sessionkey", "")
    parsed = urlparse(url)
    if (parsed.scheme != "https" or parsed.hostname not in
            ("sandbox.sslcommerz.com", "securepay.sslcommerz.com") or not session_id):
        raise HTTPException(502, "Gateway did not return a trusted checkout URL")
    return {"url": url, "session_id": session_id}


def create_checkout(tenant: str, *, plan: str, interval: str, currency: str, kind: str,
                    auto_renew: bool, amount: int, return_path: str = RETURN_PATH) -> dict:
    return service_request("POST", "billing_checkouts", body={"tenant_id": tenant,
        "plan_key": plan, "billing_interval": interval, "provider": provider_for(currency), "kind": kind,
        "auto_renew": auto_renew, "amount_minor": amount, "currency_code": currency,
        "merchant_transaction_id": uuid4().hex[:30], "return_path": return_path}, prefer="return=representation")[0]


def stripe_session(checkout: dict, customer_id: str) -> dict:
    settings = get_settings()
    price_id = stripe_price_id(checkout["plan_key"], checkout["billing_interval"], checkout["currency_code"])
    back = settings.pulse_web_origin + (checkout.get("return_path") or RETURN_PATH)
    form = {"customer": customer_id, "mode": "subscription",
            "success_url": back + "?return=success",
            "cancel_url": back + "?return=cancel",
            "client_reference_id": checkout["id"], "metadata[checkout_id]": checkout["id"],
            "line_items[0][price]": price_id, "line_items[0][quantity]": "1",
            "subscription_data[metadata][tenant_id]": checkout["tenant_id"],
            "subscription_data[metadata][plan_key]": checkout["plan_key"],
            "subscription_data[metadata][interval]": checkout["billing_interval"],
            "subscription_data[metadata][checkout_id]": checkout["id"],
            "subscription_data[metadata][auto_renew]": "true" if checkout["auto_renew"] else "false"}
    return stripe("POST", "checkout/sessions", data=form, key=f"pulse-checkout-{checkout['id']}")


def valid_ssl_contact(data: CheckoutInput) -> bool:
    return bool(data.billing_name.strip() and data.billing_address.strip() and data.billing_city.strip()
                and re.fullmatch(r"\d{4}", data.billing_postcode)
                and re.fullmatch(r"01[3-9]\d{8}", data.billing_phone))


def refresh_stripe(tenant: str, current: dict | None) -> dict | None:
    """Apply a renewal whose webhook may still be in flight before deciding what the owner can buy."""
    if current and current.get("stripe_subscription_id"):
        sub = stripe("GET", f"subscriptions/{current['stripe_subscription_id']}")
        if sub.get("latest_invoice"):
            stripe_subscription_paid(stripe("GET", f"invoices/{sub['latest_invoice']}"))
        return account(tenant)
    return current


def open_checkout(tenant: str, now: datetime) -> dict | None:
    """Return the still-open checkout, expiring abandoned ones first."""
    pending = rows("billing_checkouts", tenant_id=eq(tenant), state="eq.pending",
                   select="*", order="created_at.desc", limit="1")
    if not pending:
        return None
    existing = pending[0]
    expired = False
    if existing["provider"] == "stripe" and existing.get("gateway_session_id"):
        expired = stripe("GET", f"checkout/sessions/{existing['gateway_session_id']}").get("status") == "expired"
    elif existing["provider"] == "sslcommerz" and existing.get("gateway_session_id"):
        if now - parse_time(existing["created_at"]) > timedelta(hours=1):
            expired = ssl_session_status(existing["gateway_session_id"]).get("status") in (
                "EXPIRED", "FAILED", "CANCELLED", "")
    elif now - parse_time(existing["created_at"]) > timedelta(minutes=10):
        expired = True
    if expired:
        service_request("PATCH", "billing_checkouts", params={"id": eq(existing["id"])}, body={"state": "failed"})
        return None
    return existing


@router.post("/checkout", dependencies=[user_limit("billing-write", 10, 600)])
async def checkout(tenant_id: UUID, data: CheckoutInput, auth: Session):
    await owner(tenant_id, auth[0])
    return await asyncio.to_thread(_checkout, tenant_id, data, auth)


def _checkout(tenant_id: UUID, data: CheckoutInput, auth: tuple[str, dict]):
    tenant = str(tenant_id)
    provider = provider_for(data.currency)
    if not providers()[provider]:
        raise HTTPException(503, f"{provider} billing is not configured")
    if not data.accepted_policies:
        raise HTTPException(422, "Review and accept the billing policies before checkout")
    auto_renew = data.auto_renew and provider == "stripe"
    now = datetime.now(timezone.utc)
    current = refresh_stripe(tenant, account(tenant))
    paid_end = parse_time((current or {}).get("paid_through"))
    renew_plan = (current or {}).get("pending_plan_key") or (current or {}).get("plan_key")
    ssl_renewal = bool(provider == "sslcommerz" and current and current.get("provider") == "sslcommerz"
                       and is_active(current, now) and paid_end <= now + timedelta(days=7)
                       and data.plan == renew_plan)
    if is_active(current, now) and not ssl_renewal:
        raise HTTPException(409, "Your plan is already active. Use upgrade, downgrade, or renew instead")
    existing = open_checkout(tenant, now)
    if existing:
        if (existing["plan_key"] != data.plan or existing["provider"] != provider or
                existing["kind"] != "purchase" or existing["billing_interval"] != data.interval or
                existing["currency_code"] != data.currency or bool(existing["auto_renew"]) != auto_renew):
            raise HTTPException(409, "A different checkout is still open for this business")
        if existing.get("gateway_url"):
            return {"checkout_url": existing["gateway_url"]}
        raise HTTPException(409, "A checkout is being prepared. Retry shortly")
    if current and current.get("stripe_subscription_id"):
        sub = stripe("GET", f"subscriptions/{current['stripe_subscription_id']}")
        if sub.get("status") not in ("canceled", "incomplete_expired"):
            stripe("DELETE", f"subscriptions/{sub['id']}", key=f"pulse-retire-{sub['id']}")
        service_request("PATCH", "billing_accounts", params={"tenant_id": eq(tenant)},
                        body={"stripe_subscription_id": None, "auto_renew": False})
    amount = price(data.plan, data.interval, data.currency)
    if amount <= 0:
        raise HTTPException(503, "This price is not configured")
    if provider == "stripe" and not stripe_price_id(data.plan, data.interval, data.currency):
        raise HTTPException(503, "This Stripe price is not configured")
    if provider == "sslcommerz" and not valid_ssl_contact(data):
        raise HTTPException(422, "Billing name, Bangladesh mobile, address, city, and postcode are required")
    email = auth[1].get("email") or ""
    if not email:
        raise HTTPException(422, "Owner email is required for checkout")
    row = create_checkout(tenant, plan=data.plan, interval=data.interval, currency=data.currency,
                          kind="purchase", auto_renew=auto_renew, amount=amount,
                          return_path=RETURN_PATHS[data.return_to])
    try:
        if provider == "stripe":
            customer_id = (current or {}).get("stripe_customer_id")
            if not customer_id:
                customer_id = stripe("POST", "customers", data={"email": email,
                    "metadata[tenant_id]": tenant}, key=f"pulse-customer-{tenant}")["id"]
            service_request("POST", "billing_accounts", body={"tenant_id": tenant,
                "stripe_customer_id": customer_id, "billing_email": email},
                params={"on_conflict": "tenant_id"}, prefer="resolution=merge-duplicates")
            session = stripe_session(row, customer_id)
            result = {"url": session["url"], "session_id": session["id"]}
        else:
            result = ssl_session(row, email, data.model_dump())
            service_request("POST", "billing_accounts", body={"tenant_id": tenant,
                "billing_name": data.billing_name, "billing_email": email,
                "billing_phone": data.billing_phone, "billing_address": data.billing_address},
                params={"on_conflict": "tenant_id"}, prefer="resolution=merge-duplicates")
    except (httpx.HTTPError, KeyError, ValueError, HTTPException) as exc:
        service_request("PATCH", "billing_checkouts", params={"id": eq(row["id"])}, body={"state": "failed"})
        raise HTTPException(502, "Could not start billing checkout") from exc
    service_request("PATCH", "billing_checkouts", params={"id": eq(row["id"])},
                    body={"gateway_url": result["url"], "gateway_session_id": result["session_id"]})
    return {"checkout_url": result["url"]}


def require_owner_plan(current: dict | None, plan: str) -> dict:
    if not is_active(current) or current.get("plan_key") != plan:
        raise HTTPException(409, f"An active {NAMES[plan]} plan is required")
    return current


@router.post("/upgrade", dependencies=[user_limit("billing-write", 10, 600)])
async def upgrade(tenant_id: UUID, auth: Session):
    """Pro -> Enterprise now; pay the prorated difference, keep the term end, top up credits."""
    await owner(tenant_id, auth[0])
    return await asyncio.to_thread(_upgrade, tenant_id, auth)


def _upgrade(tenant_id: UUID, auth: tuple[str, dict]):
    tenant = str(tenant_id)
    current = require_owner_plan(account(tenant), "pro")
    interval, currency = current["billing_interval"], current["currency_code"]
    if current["provider"] == "stripe":
        sub_id = current.get("stripe_subscription_id")
        new_price = stripe_price_id("enterprise", interval, currency)
        if not sub_id or not new_price:
            raise HTTPException(503, "Enterprise Stripe price is not configured")
        sub = stripe("GET", f"subscriptions/{sub_id}")
        items = (sub.get("items") or {}).get("data") or []
        if len(items) != 1:
            raise HTTPException(409, "Subscription items cannot be upgraded automatically")
        # error_if_incomplete charges the proration now and fails the update if payment fails.
        updated = stripe("POST", f"subscriptions/{sub_id}", data={
            "items[0][id]": items[0]["id"], "items[0][price]": new_price,
            "proration_behavior": "always_invoice", "payment_behavior": "error_if_incomplete",
            "metadata[plan_key]": "enterprise"}, key=f"pulse-upgrade-{sub_id}-{current['paid_through']}")
        if updated.get("latest_invoice"):
            stripe_upgrade_paid(stripe("GET", f"invoices/{updated['latest_invoice']}"), updated)
        return {"status": "upgraded"}
    amount = upgrade_quote(current)
    if amount <= 0:
        raise HTTPException(409, "The current term is ending; renew on Enterprise instead")
    now = datetime.now(timezone.utc)
    existing = open_checkout(tenant, now)
    if existing:
        if existing["kind"] == "upgrade" and existing.get("gateway_url"):
            return {"checkout_url": existing["gateway_url"]}
        raise HTTPException(409, "A different checkout is still open for this business")
    email = auth[1].get("email") or current.get("billing_email") or ""
    row = create_checkout(tenant, plan="enterprise", interval=interval, currency=currency,
                          kind="upgrade", auto_renew=False, amount=amount)
    try:
        result = ssl_session(row, email, current)
    except (httpx.HTTPError, KeyError, ValueError, HTTPException) as exc:
        service_request("PATCH", "billing_checkouts", params={"id": eq(row["id"])}, body={"state": "failed"})
        raise HTTPException(502, "Could not start upgrade checkout") from exc
    service_request("PATCH", "billing_checkouts", params={"id": eq(row["id"])},
                    body={"gateway_url": result["url"], "gateway_session_id": result["session_id"]})
    return {"checkout_url": result["url"]}


@router.post("/downgrade")
async def downgrade(tenant_id: UUID, auth: Session):
    """Enterprise -> Pro at the next renewal; the current term keeps Enterprise."""
    await owner(tenant_id, auth[0])
    return await asyncio.to_thread(_downgrade, tenant_id, auth)


def _downgrade(tenant_id: UUID, auth: tuple[str, dict]):
    tenant = str(tenant_id)
    current = require_owner_plan(account(tenant), "enterprise")
    if current["provider"] == "stripe":
        sub_id = current.get("stripe_subscription_id")
        new_price = stripe_price_id("pro", current["billing_interval"], current["currency_code"])
        if not sub_id or not new_price:
            raise HTTPException(503, "Pro Stripe price is not configured")
        sub = stripe("GET", f"subscriptions/{sub_id}")
        items = (sub.get("items") or {}).get("data") or []
        if len(items) != 1:
            raise HTTPException(409, "Subscription items cannot be changed automatically")
        # No proration: the paid period is untouched and the next invoice uses the Pro price.
        stripe("POST", f"subscriptions/{sub_id}", data={
            "items[0][id]": items[0]["id"], "items[0][price]": new_price,
            "proration_behavior": "none", "metadata[plan_key]": "pro"},
            key=f"pulse-downgrade-{sub_id}-{current['paid_through']}")
    service_request("PATCH", "billing_accounts", params={"tenant_id": eq(tenant)},
                    body={"pending_plan_key": "pro"})
    return {"status": "scheduled", "effective_at": current["paid_through"]}


def settle(checkout: dict, invoice_id: str, transaction_id: str,
           period_start: datetime, period_end: datetime, risky: bool = False) -> dict:
    return service_request("POST", "rpc/pulse_billing_settle", body={
        "p_checkout_id": checkout["id"], "p_provider_invoice_id": invoice_id,
        "p_provider_transaction_id": transaction_id,
        "p_amount_minor": checkout["amount_minor"], "p_currency_code": checkout["currency_code"],
        "p_period_start": period_start.isoformat(), "p_period_end": period_end.isoformat(),
        "p_allowance": allowance(checkout["plan_key"]), "p_risky": risky})


def stripe_checkout_completed(session: dict) -> None:
    checkout_id = session.get("client_reference_id")
    found = rows("billing_checkouts", id=eq(checkout_id), provider="eq.stripe", select="*", limit="1")
    if not found:
        raise HTTPException(404, "Billing checkout not found")
    row = found[0]
    if session.get("id") != row.get("gateway_session_id"):
        raise HTTPException(422, "Stripe checkout mismatch")
    if row["state"] == "completed" or session.get("status") != "complete" or not session.get("subscription"):
        return
    sub = stripe("GET", f"subscriptions/{session['subscription']}")
    if sub.get("latest_invoice"):
        stripe_subscription_paid(stripe("GET", f"invoices/{sub['latest_invoice']}"))


def subscription_id(invoice: dict) -> str | None:
    return invoice.get("subscription") or (
        ((invoice.get("parent") or {}).get("subscription_details") or {}).get("subscription"))


def stripe_upgrade_paid(invoice: dict, sub: dict) -> None:
    """Settle the prorated Pro -> Enterprise invoice; idempotent per Stripe invoice."""
    if invoice.get("status") != "paid" or invoice.get("billing_reason") != "subscription_update":
        return
    meta = sub.get("metadata") or {}
    tenant = meta.get("tenant_id")
    currency = (invoice.get("currency") or "").upper()
    current = account(tenant) if tenant else None
    if (not current or meta.get("plan_key") != "enterprise" or currency not in STRIPE_CURRENCIES or
            current.get("stripe_customer_id") != sub.get("customer") or
            current.get("stripe_subscription_id") != sub.get("id")):
        raise HTTPException(422, "Stripe upgrade invoice does not match a Pulse plan")
    if rows("billing_invoices", provider_invoice_id=eq(invoice["id"]), select="id", limit="1"):
        return
    paid_end = parse_time(current["paid_through"])
    amount = int(invoice.get("amount_paid") or 0)
    now = datetime.now(timezone.utc)
    if amount <= 0 or not paid_end or paid_end <= now:
        return
    row = create_checkout(tenant, plan="enterprise", interval=current["billing_interval"], currency=currency,
                          kind="upgrade", auto_renew=bool(current.get("auto_renew")), amount=amount)
    settle(row, invoice["id"], invoice.get("payment_intent") or invoice["id"], now, paid_end)


def stripe_subscription_paid(invoice: dict) -> None:
    if invoice.get("status") != "paid" or invoice.get("amount_paid", 0) <= 0:
        return
    sub_id = subscription_id(invoice)
    if not sub_id:
        return
    sub = stripe("GET", f"subscriptions/{sub_id}")
    if invoice.get("billing_reason") == "subscription_update":
        stripe_upgrade_paid(invoice, sub)
        return
    meta = sub.get("metadata") or {}
    tenant, plan, interval = meta.get("tenant_id"), meta.get("plan_key"), meta.get("interval", "month")
    currency = (invoice.get("currency") or "").upper()
    if not tenant or plan not in PLANS or interval not in INTERVALS or currency not in STRIPE_CURRENCIES:
        raise HTTPException(422, "Stripe invoice does not match a Pulse plan")
    amount = subscription_amount(sub, plan, interval, currency)
    if amount is None or invoice.get("amount_paid") != amount:
        raise HTTPException(422, "Stripe invoice does not match a Pulse plan")
    current = account(tenant)
    if (not current or current.get("stripe_customer_id") != sub.get("customer") or
            invoice.get("customer") != sub.get("customer")):
        raise HTTPException(422, "Stripe customer mismatch")
    if rows("billing_invoices", provider_invoice_id=eq(invoice["id"]), select="id", limit="1"):
        return
    lines = (invoice.get("lines") or {}).get("data") or []
    periods = [line.get("period") for line in lines if line.get("amount") == amount and line.get("period")]
    if len(periods) != 1:
        raise HTTPException(422, "Stripe invoice period cannot be verified")
    start = datetime.fromtimestamp(periods[0]["start"], timezone.utc)
    end = datetime.fromtimestamp(periods[0]["end"], timezone.utc)
    previous_end = parse_time(current.get("paid_through"))
    checkout_id = meta.get("checkout_id")
    found = rows("billing_checkouts", id=eq(checkout_id), tenant_id=eq(tenant), select="*", limit="1") if checkout_id else []
    original = found[0] if found else None
    if (original and original["kind"] == "purchase" and original["state"] == "pending"
            and original["plan_key"] == plan and original["amount_minor"] == amount):
        row = original
    else:
        # Renewal invoices have no checkout session of their own.
        row = create_checkout(tenant, plan=plan, interval=interval, currency=currency, kind="purchase",
                              auto_renew=meta.get("auto_renew") == "true", amount=amount)
    settle(row, invoice["id"], invoice.get("payment_intent") or invoice["id"], start, end)
    if previous_end is None or end > previous_end:
        service_request("PATCH", "billing_accounts", params={"tenant_id": eq(tenant)},
                        body={"stripe_subscription_id": sub_id})
    if meta.get("auto_renew") != "true" and not sub.get("cancel_at_period_end"):
        stripe("POST", f"subscriptions/{sub_id}", data={"cancel_at_period_end": "true"},
               key=f"pulse-stop-after-first-{sub_id}")


def verify_stripe_event(raw: bytes, signature: str) -> dict:
    secret = get_settings().pulse_stripe_webhook_secret
    try:
        parts = [part.split("=", 1) for part in signature.split(",") if "=" in part]
        timestamp = int(next(value for key, value in parts if key == "t"))
        received = [value for key, value in parts if key == "v1"]
    except (StopIteration, ValueError) as exc:
        raise HTTPException(400, "Invalid Stripe signature") from exc
    if not secret or abs(time.time() - timestamp) > 300:
        raise HTTPException(400, "Expired Stripe signature")
    expected = hmac.new(secret.encode(), str(timestamp).encode() + b"." + raw,
                        hashlib.sha256).hexdigest()
    if not any(hmac.compare_digest(expected, candidate) for candidate in received):
        raise HTTPException(400, "Invalid Stripe signature")
    try:
        return json.loads(raw)
    except ValueError as exc:
        raise HTTPException(400, "Invalid Stripe event") from exc


@webhooks.post("/webhooks/billing/stripe")
async def stripe_webhook(request: Request):
    raw = await read_limited_body(request, 128 * 1024, "Stripe event is too large")
    return await asyncio.to_thread(_stripe_webhook, raw, request.headers.get("stripe-signature", ""))


def _stripe_webhook(raw: bytes, signature: str) -> dict:
    event = verify_stripe_event(raw, signature)
    event_id = event.get("id", "")
    if not event_id:
        raise HTTPException(400, "Stripe event ID missing")
    if rows("billing_webhook_events", provider="eq.stripe", event_id=eq(event_id), select="event_id", limit="1"):
        return {"status": "duplicate"}
    obj = (event.get("data") or {}).get("object") or {}
    kind = event.get("type")
    if kind == "checkout.session.completed":
        stripe_checkout_completed(stripe("GET", f"checkout/sessions/{obj['id']}"))
    elif kind == "invoice.paid":
        stripe_subscription_paid(stripe("GET", f"invoices/{obj['id']}"))
    elif kind == "customer.subscription.deleted":
        tenant = (obj.get("metadata") or {}).get("tenant_id")
        if tenant:
            current = account(tenant)
            if current and current.get("stripe_subscription_id") == obj.get("id"):
                service_request("PATCH", "billing_accounts", params={"tenant_id": eq(tenant)},
                                body={"auto_renew": False, "pending_plan_key": None})
    service_request("POST", "billing_webhook_events", body={"provider": "stripe", "event_id": event_id},
                    prefer="resolution=ignore-duplicates")
    return {"status": "ok"}


def ssl_amount(payload: dict) -> int:
    try:
        amount = Decimal(str(payload["amount"]))
        if not amount.is_finite() or amount.as_tuple().exponent < -2:
            raise InvalidOperation
        return int(amount * 100)
    except (KeyError, InvalidOperation, ValueError, TypeError) as exc:
        raise HTTPException(502, "Gateway amount invalid") from exc


def ssl_period(checkout: dict, current: dict | None, now: datetime) -> tuple[datetime, datetime]:
    previous = parse_time((current or {}).get("paid_through"))
    if checkout["kind"] == "upgrade":
        if not previous or previous <= now:
            raise HTTPException(409, "The upgraded term has already ended")
        return now, previous
    start = max(now, previous) if previous and (current or {}).get("state") == "active" else now
    return start, start + term_delta(checkout["billing_interval"])


def validate_ssl_payment(checkout: dict, val_id: str) -> dict:
    settings = get_settings()
    with httpx.Client(timeout=30) as client:
        response = client.get(f"{ssl_base()}/validator/api/validationserverAPI.php",
            params={"val_id": val_id, "store_id": settings.pulse_ssl_store_id,
                    "store_passwd": settings.pulse_ssl_store_passwd, "format": "json"})
    response.raise_for_status()
    verified = response.json()
    if (verified.get("status") not in ("VALID", "VALIDATED") or
            verified.get("tran_id") != checkout["merchant_transaction_id"] or
            verified.get("val_id") != val_id or verified.get("currency") != "BDT" or
            ssl_amount(verified) != checkout["amount_minor"]):
        raise HTTPException(422, "SSLCOMMERZ payment mismatch")
    start, end = ssl_period(checkout, account(checkout["tenant_id"]), datetime.now(timezone.utc))
    return settle(checkout, val_id, verified.get("bank_tran_id") or val_id, start, end,
                  risky=str(verified.get("risk_level")) == "1")


@webhooks.post("/webhooks/billing/sslcommerz")
async def ssl_webhook(request: Request):
    raw = await read_limited_body(request, 8192, "SSLCOMMERZ event is too large")
    return await asyncio.to_thread(_ssl_webhook, raw, dict(request.query_params))


def _ssl_webhook(raw: bytes, query: dict[str, str]):
    path = RETURN_PATHS.get(query.get("to", "plan"), RETURN_PATH)
    back = RedirectResponse(get_settings().pulse_web_origin + path + "?return=check", status_code=303)
    try:
        fields = {key: values[0] for key, values in parse_qs(raw.decode(), keep_blank_values=True).items()}
    except UnicodeDecodeError as exc:
        raise HTTPException(400, "Invalid gateway event") from exc
    transaction, val_id = fields.get("tran_id", ""), fields.get("val_id", "")
    if not transaction or not val_id:
        if query.get("return") == "1":
            return back
        raise HTTPException(400, "Payment validation ID missing")
    found = rows("billing_checkouts", merchant_transaction_id=eq(transaction),
                 provider="eq.sslcommerz", select="*", limit="1")
    if not found:
        raise HTTPException(404, "Billing checkout not found")
    checkout = found[0]
    if checkout["state"] in ("completed", "review"):
        state = checkout["state"]
    else:
        state = validate_ssl_payment(checkout, val_id)["state"]
    if query.get("return") == "1":
        return back
    return {"status": state}


def reconcile() -> None:
    """Recover from missed browser returns or provider webhooks."""
    pending = rows("billing_checkouts", state="eq.pending", select="*", limit="100", order="created_at.asc")
    for row in pending:
        session_id = row.get("gateway_session_id")
        if not session_id:
            continue
        try:
            if row["provider"] == "stripe":
                stripe_checkout_completed(stripe("GET", f"checkout/sessions/{session_id}"))
            else:
                info = ssl_session_status(session_id)
                if info.get("status") in ("VALID", "VALIDATED") and info.get("val_id"):
                    validate_ssl_payment(row, info["val_id"])
        except (HTTPException, httpx.HTTPError, KeyError, ValueError):
            # Keep the checkout pending for an operator to investigate or a later retry.
            logger.exception("Billing checkout reconciliation failed: %s", row["id"])
    # Stripe renewals and upgrades have no checkout session; reconcile each subscription.
    accounts = rows("billing_accounts", stripe_subscription_id="not.is.null",
                    select="tenant_id,stripe_subscription_id", limit="1000")
    for current in accounts:
        try:
            sub = stripe("GET", f"subscriptions/{current['stripe_subscription_id']}")
            if sub.get("latest_invoice"):
                stripe_subscription_paid(stripe("GET", f"invoices/{sub['latest_invoice']}"))
        except (HTTPException, httpx.HTTPError, KeyError, ValueError):
            logger.exception("Stripe subscription reconciliation failed for tenant %s", current["tenant_id"])


@router.post("/cancel")
async def cancel(tenant_id: UUID, auth: Session):
    """Stop Stripe renewal at period end. SSLCOMMERZ terms are prepaid and simply lapse."""
    await owner(tenant_id, auth[0])
    return await asyncio.to_thread(_cancel, tenant_id, auth)


def _cancel(tenant_id: UUID, auth: tuple[str, dict]):
    current = account(str(tenant_id))
    if not current or not current.get("stripe_subscription_id"):
        raise HTTPException(409, "No Stripe subscription to cancel")
    sub_id = current["stripe_subscription_id"]
    stripe("POST", f"subscriptions/{sub_id}", data={"cancel_at_period_end": "true",
           "metadata[auto_renew]": "false"})
    service_request("PATCH", "billing_accounts", params={"tenant_id": eq(str(tenant_id))},
                    body={"auto_renew": False})
    return {"status": "cancelled"}


@router.post("/auto-renew")
async def set_auto_renew(tenant_id: UUID, enabled: bool, auth: Session):
    await owner(tenant_id, auth[0])
    return await asyncio.to_thread(_set_auto_renew, tenant_id, enabled, auth)


def _set_auto_renew(tenant_id: UUID, enabled: bool, auth: tuple[str, dict]):
    current = account(str(tenant_id))
    if not is_active(current) or not current.get("stripe_subscription_id"):
        raise HTTPException(409, "An active Stripe subscription is required")
    sub_id = current["stripe_subscription_id"]
    stripe("POST", f"subscriptions/{sub_id}", data={
        "cancel_at_period_end": "false" if enabled else "true",
        "metadata[auto_renew]": "true" if enabled else "false"})
    service_request("PATCH", "billing_accounts", params={"tenant_id": eq(str(tenant_id))},
                    body={"auto_renew": enabled})
    return {"auto_renew": enabled}
