"""Owner alert rendering, transports (email + Pulse's WhatsApp number) and durable worker operations."""

import logging
import smtplib
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from html import escape
from urllib.parse import urlencode

import httpx

from .emails import FONT, INK, LIME, LIME_DIM, LINE, MUTED, TEAL, TEAL_DEEP, _layout, send
from .settings import get_settings
from .store import eq, service_request

logger = logging.getLogger(__name__)
MAX_ATTEMPTS = 5
PLAN_NAMES = {"bangla": {"trial": "ফ্রি ট্রায়াল", "pro": "Pro", "enterprise": "Enterprise"},
              "english": {"trial": "Free trial", "pro": "Pro", "enterprise": "Enterprise"}}
PAYMENT = {"bangla": {"paid": "পরিশোধিত", "partial": "আংশিক পরিশোধিত", "unpaid": "অপরিশোধিত"},
           "english": {"paid": "Paid", "partial": "Partially paid", "unpaid": "Unpaid"}}
LABELS = {"bangla": {"business": "ব্যবসা", "order": "অর্ডার", "customer": "ক্রেতা", "units": "পণ্যের পরিমাণ",
                     "total": "মোট", "payment": "পেমেন্ট", "left": "বাকি ক্রেডিট", "plan": "প্ল্যান",
                     "ends": "শেষ হবে", "order_cta": "অর্ডার দেখুন", "plan_cta": "প্ল্যান দেখুন"},
          "english": {"business": "Business", "order": "Order", "customer": "Customer", "units": "Item quantity",
                      "total": "Total", "payment": "Payment", "left": "Credits left", "plan": "Plan",
                      "ends": "Ends", "order_cta": "View order", "plan_cta": "View plan"}}
TEXT = {
    "bangla": {
        "order_confirmed": ("অর্ডার নিশ্চিত হয়েছে", "একটি অর্ডার নিশ্চিত হয়েছে। নিশ্চিতকরণ মানে পেমেন্ট পাওয়া নয়।"),
        "order_drafted": ("AI একটি অর্ডার তৈরি করেছে", "AI একজন গ্রাহকের জন্য খসড়া অর্ডার তৈরি করেছে। পর্যালোচনা করে নিশ্চিত করুন।"),
        "credits_low": ("AI ক্রেডিট কমে গেছে", "এই চক্রের AI ক্রেডিট প্রায় শেষ। AI উত্তর চালু রাখতে প্ল্যান আপগ্রেড করুন।"),
        "credits_empty": ("AI ক্রেডিট শেষ", "AI ক্রেডিট শেষ। নতুন ক্রেডিট না পাওয়া পর্যন্ত AI গ্রাহকদের উত্তর দেবে না।"),
        "plan_ending": ("আপনার প্ল্যান শীঘ্রই শেষ হবে", "AI উত্তর চালু রাখতে শেষ হওয়ার আগে প্ল্যান রিনিউ বা আপগ্রেড করুন।"),
        "plan_expired": ("আপনার প্ল্যান শেষ হয়েছে", "AI উত্তর ও পরিবর্তন বন্ধ আছে। আবার চালু করতে প্ল্যান কিনুন।"),
        "test": ("পরীক্ষামূলক বিজ্ঞপ্তি", "Pulse বিজ্ঞপ্তি এই ঠিকানায় ঠিকভাবে পৌঁছাচ্ছে।"),
    },
    "english": {
        "order_confirmed": ("Order confirmed", "An order was confirmed. Confirmation does not mean payment was received."),
        "order_drafted": ("AI drafted an order", "The AI drafted an order for a customer. Review and confirm it."),
        "credits_low": ("AI credits are running low", "This cycle's AI credits are almost used up. Upgrade to keep AI replies running."),
        "credits_empty": ("AI credits used up", "AI credits are used up. The AI will not reply to customers until credits are added."),
        "plan_ending": ("Your plan ends soon", "Renew or upgrade before it ends to keep AI replies running."),
        "plan_expired": ("Your plan has ended", "AI replies and changes are paused. Choose a plan to restore them."),
        "test": ("Test notification", "Pulse alerts reach this address."),
    },
}


def now() -> datetime:
    return datetime.now(timezone.utc)


def _web(path: str, **params) -> str:
    base = get_settings().pulse_web_origin.rstrip("/") + path
    return base + ("?" + urlencode(params) if params else "")


def _money(minor, currency) -> str:
    return f"{Decimal(int(minor or 0)) / 100:.2f} {currency}"


def _date(value: str | None) -> str:
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")).strftime("%d %b %Y")
    except ValueError:
        return str(value or "")


def content(delivery: dict) -> dict:
    """Subject, rows and call to action for one delivery, plus WhatsApp template parameters in order."""
    kind, language = delivery["kind"], delivery["language"]
    data, labels = delivery["summary"], LABELS[language]
    title, intro = TEXT[language][kind]
    business = str(data.get("business") or "Pulse")
    rows: list[tuple[str, str]] = [(labels["business"], business)]
    cta: tuple[str, str] | None = None
    params = [business]
    if kind in ("order_confirmed", "order_drafted"):
        order = str(data.get("order_id") or "")
        ref = order[:8].upper()
        total = _money(data.get("total_minor"), data.get("currency") or "")
        rows += [(labels["order"], ref), (labels["customer"], str(data.get("customer") or "—")),
                 (labels["units"], str(data.get("units") or 0)), (labels["total"], total)]
        params += [ref, str(data.get("customer") or "—"), str(data.get("units") or 0), total]
        if kind == "order_confirmed":
            payment = PAYMENT[language].get(data.get("payment"), str(data.get("payment") or ""))
            rows.append((labels["payment"], payment))
            params.append(payment)
        cta = (labels["order_cta"], _web("/orders", tenant_id=delivery["tenant_id"], order_id=order))
    elif kind == "credits_low":
        left = f"{data.get('available', 0)} / {data.get('allowance', 0)}"
        rows.append((labels["left"], left))
        params += [str(data.get("available", 0)), str(data.get("allowance", 0))]
        cta = (labels["plan_cta"], _web("/plan"))
    elif kind == "credits_empty":
        cta = (labels["plan_cta"], _web("/plan"))
    elif kind in ("plan_ending", "plan_expired"):
        plan = PLAN_NAMES[language].get(data.get("plan"), str(data.get("plan") or ""))
        rows.append((labels["plan"], plan))
        params.append(plan)
        if kind == "plan_ending":
            rows.append((labels["ends"], _date(data.get("ends_at"))))
            params.append(_date(data.get("ends_at")))
        cta = (labels["plan_cta"], _web("/plan"))
    if cta:
        params.append(cta[1])
    return {"subject": f"Pulse — {title}", "title": title, "intro": intro, "rows": rows, "cta": cta,
            "params": params}


def render_email(delivery: dict) -> tuple[str, str, str]:
    c = content(delivery)
    text = "\n".join([c["title"], "", c["intro"], ""] + [f"{label}: {value}" for label, value in c["rows"]]
                     + ([f"\n{c['cta'][0]}: {c['cta'][1]}"] if c["cta"] else []))
    table = "".join(
        f'<tr><td style="padding:8px 0;border-bottom:1px solid {LINE};font:14px {FONT};color:{MUTED};">{escape(label)}</td>'
        f'<td style="padding:8px 0;border-bottom:1px solid {LINE};font:600 14px {FONT};color:{INK};text-align:right;">'
        f'{escape(value)}</td></tr>' for label, value in c["rows"])
    button = ""
    if c["cta"]:
        button = (f'<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:24px;"><tr>'
                  f'<td style="background:{TEAL_DEEP};border-radius:12px;"><a href="{escape(c["cta"][1], quote=True)}" '
                  f'style="display:inline-block;padding:12px 22px;font:600 15px {FONT};color:#ffffff;text-decoration:none;">'
                  f'{escape(c["cta"][0])}</a></td></tr></table>')
    body = f"""
      <p style="margin:0 0 6px;font:600 12px {FONT};letter-spacing:1.6px;text-transform:uppercase;color:{TEAL};">Pulse alert</p>
      <h1 style="margin:0 0 12px;font:700 24px/1.3 {FONT};letter-spacing:-0.4px;color:{INK};">{escape(c["title"])}</h1>
      <p style="margin:0 0 20px;font:16px/1.6 {FONT};color:{MUTED};">{escape(c["intro"])}</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
        style="background:{LIME_DIM};border:1px solid {LIME};border-radius:14px;padding:4px 16px;">{table}</table>{button}"""
    return c["subject"], text, _layout(c["intro"], body)


class DeliveryFailure(Exception):
    def __init__(self, kind: str, detail: str):
        self.kind, self.detail = kind, detail
        super().__init__(detail)


def email_ready() -> bool:
    s = get_settings()
    return bool(s.resend_api_key or (s.mail_host and s.mail_user and s.mail_pass))


def whatsapp_ready() -> bool:
    s = get_settings()
    return bool(s.pulse_whatsapp_phone_id and s.pulse_whatsapp_number and s.pulse_whatsapp_token
                and s.pulse_whatsapp_app_secret)


def send_email(destination: str, subject: str, text: str, html: str) -> str:
    if not email_ready():
        raise DeliveryFailure("failed", "Email is not configured")
    try:
        return send(destination, subject, text, html)
    except smtplib.SMTPRecipientsRefused as exc:
        raise DeliveryFailure("failed", "Email recipient rejected") from exc
    except smtplib.SMTPResponseException as exc:
        raise DeliveryFailure("retry" if 400 <= exc.smtp_code < 500 else "failed",
                              f"Mail server rejected the message ({exc.smtp_code})") from exc
    except (OSError, smtplib.SMTPException, RuntimeError) as exc:
        raise DeliveryFailure("retry", type(exc).__name__) from exc


def send_whatsapp(delivery: dict) -> str:
    settings = get_settings()
    if not whatsapp_ready():
        raise DeliveryFailure("failed", "Pulse WhatsApp is not configured")
    template = getattr(settings, f"pulse_whatsapp_template_{delivery['kind']}", "")
    if not template:
        raise DeliveryFailure("suppressed", "WhatsApp template not configured")
    body = {"messaging_product": "whatsapp", "to": delivery["destination"].lstrip("+"), "type": "template",
            "biz_opaque_callback_data": f"{delivery['id']}:{delivery['claim_token']}",
            "template": {"name": template, "language": {"code": "bn" if delivery["language"] == "bangla" else "en"},
                         "components": [{"type": "body", "parameters": [
                             {"type": "text", "text": value[:1000]} for value in content(delivery)["params"]]}]}}
    url = f"https://graph.facebook.com/{settings.meta_graph_version}/{settings.pulse_whatsapp_phone_id}/messages"
    try:
        with httpx.Client(timeout=15) as client:
            response = client.post(url, headers={"Authorization": f"Bearer {settings.pulse_whatsapp_token}"}, json=body)
    except (httpx.ConnectError, httpx.ConnectTimeout) as exc:
        raise DeliveryFailure("retry", type(exc).__name__) from exc
    except httpx.HTTPError as exc:
        raise DeliveryFailure("uncertain", type(exc).__name__) from exc
    if response.status_code == 429:
        raise DeliveryFailure("retry", "WhatsApp rate limit")
    if response.status_code >= 500:
        raise DeliveryFailure("uncertain", "WhatsApp server error")
    if response.status_code >= 400:
        raise DeliveryFailure("failed", f"WhatsApp rejected the request ({response.status_code})")
    try:
        return response.json()["messages"][0]["id"]
    except (ValueError, KeyError, IndexError, TypeError) as exc:
        raise DeliveryFailure("uncertain", "WhatsApp returned no message ID") from exc


def deliver(delivery_id: str) -> None:
    if not get_settings().pulse_notifications_enabled:
        return
    row = service_request("POST", "rpc/pulse_claim_notification", body={"p_id": delivery_id})
    if not row:
        return
    result: dict = {"updated_at": now().isoformat()}
    try:
        if row["channel"] == "email":
            provider = send_email(row["destination"], *render_email(row))
        else:
            provider = send_whatsapp(row)
        result.update(status="accepted", provider_id=provider if row["channel"] == "whatsapp" else None, error=None)
    except DeliveryFailure as exc:
        status = exc.kind
        if status == "retry":
            status = "queued" if row["attempts"] < MAX_ATTEMPTS else "failed"
        result.update(status=status, error=exc.detail,
                      next_attempt_at=(now() + timedelta(seconds=min(900, 30 * 2 ** row["attempts"]))).isoformat())
    except Exception as exc:
        # Once claimed, an unknown failure may have followed external acceptance.
        logger.error("notification_failure id=%s type=%s", delivery_id, type(exc).__name__)
        result.update(status="uncertain", error="Unexpected delivery failure")
    service_request("PATCH", "notification_deliveries", body=result, params={
        "id": eq(row["id"]), "claim_token": eq(row["claim_token"]), "status": "eq.sending"})


def reconcile(dispatch) -> None:
    if not get_settings().pulse_notifications_enabled:
        return
    service_request("PATCH", "notification_deliveries",
                    params={"status": "eq.sending", "claimed_at": "lt." + (now() - timedelta(minutes=3)).isoformat()},
                    body={"status": "uncertain", "error": "Worker stopped during send", "updated_at": now().isoformat()})
    ready = service_request("GET", "notification_deliveries", params={
        "status": "eq.queued", "next_attempt_at": "lte." + now().isoformat(), "select": "id",
        "order": "next_attempt_at.asc", "limit": "100"})
    for row in ready:
        dispatch(row["id"])
    service_request("DELETE", "notification_challenges",
                    params={"expires_at": "lt." + (now() - timedelta(days=1)).isoformat()})
