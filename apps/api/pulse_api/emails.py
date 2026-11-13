"""Branded transactional emails. Table layout with inline styles so Gmail, Outlook and Apple Mail render alike."""

import base64
import logging
import smtplib
import ssl
from email.message import EmailMessage
from email.utils import formataddr, formatdate, make_msgid
from html import escape
from pathlib import Path

import httpx

from .settings import get_settings

logger = logging.getLogger(__name__)
RESEND_URL = "https://api.resend.com/emails"
# Embedded (cid:) rather than linked: a remote image that fails to load is a strong spam signal,
# and an inline logo still shows when the mail client blocks remote images.
LOGO_CID = "pulse-logo"
LOGO_PNG = (Path(__file__).parent / "assets" / "pulse-logo.png").read_bytes()

# Brand palette (apps/web/app/tokens.css)
TEAL_DEEP = "#0c4f4b"
TEAL = "#11635d"
LIME = "#c7eba4"
LIME_DIM = "#e2f0d2"
PAPER = "#fbfcf7"
CANVAS = "#eef3ef"
INK = "#153b37"
MUTED = "#536d66"
LINE = "#d6e0d9"

PUBLIC_SITE = "https://pulse.racoai.io"
FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,Helvetica,Arial,sans-serif"


def _site() -> str:
    origin = get_settings().pulse_web_origin.rstrip("/")
    # Mail clients can only load images from a public HTTPS host.
    return origin if origin.startswith("https://") else PUBLIC_SITE


def _layout(preheader: str, body: str) -> str:
    site = _site()
    return f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><title>Pulse</title></head>
<body style="margin:0;padding:0;background:{CANVAS};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:{CANVAS};">{escape(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:{CANVAS};">
<tr><td align="center" style="padding:32px 16px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;">
    <tr><td style="padding:0 4px 20px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
        <td style="vertical-align:middle;"><img src="cid:{LOGO_CID}" width="40" height="40" alt="Pulse" style="display:block;border:0;border-radius:10px;"></td>
        <td style="vertical-align:middle;padding-left:10px;font:700 22px {FONT};letter-spacing:-0.5px;color:{INK};">pulse<span style="color:{TEAL};">.</span></td>
      </tr></table>
    </td></tr>
    <tr><td style="background:{PAPER};border:1px solid {LINE};border-radius:20px;padding:36px 32px;font-family:{FONT};color:{INK};">
      {body}
    </td></tr>
    <tr><td style="padding:20px 8px 0;font:13px/1.6 {FONT};color:{MUTED};text-align:center;">
      Pulse by RACO AI Technologies · <a href="{site}" style="color:{TEAL};text-decoration:none;">pulse.racoai.io</a>
    </td></tr>
  </table>
</td></tr></table>
</body></html>"""


def signup_code(code: str) -> tuple[str, str, str]:
    """Subject, plain text and HTML for the sign-up verification code."""
    subject = f"{code} is your Pulse sign-up code"
    text = (f"Your Pulse sign-up code is {code}.\n\n"
            "Enter it on the sign-up page to confirm your email. It expires in 10 minutes.\n\n"
            "If you didn't request this, you can ignore this email.\n\n"
            "Pulse by RACO AI Technologies · https://pulse.racoai.io")
    spaced = escape(code)
    body = f"""
      <p style="margin:0 0 6px;font:600 12px {FONT};letter-spacing:1.6px;text-transform:uppercase;color:{TEAL};">Confirm your email</p>
      <h1 style="margin:0 0 12px;font:700 26px/1.25 {FONT};letter-spacing:-0.5px;color:{INK};">Your sign-up code</h1>
      <p style="margin:0 0 24px;font:16px/1.6 {FONT};color:{MUTED};">Enter this code on the Pulse sign-up page to finish creating your workspace.</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
        <td align="center" style="background:{LIME_DIM};border:1px solid {LIME};border-radius:14px;padding:20px 12px;">
          <span style="font:700 36px/1 'SFMono-Regular',Menlo,Consolas,monospace;letter-spacing:10px;color:{TEAL_DEEP};padding-left:10px;">{spaced}</span>
        </td>
      </tr></table>
      <p style="margin:24px 0 0;font:14px/1.6 {FONT};color:{MUTED};">The code expires in <strong style="color:{INK};">10 minutes</strong>. If you didn't request it, you can safely ignore this email.</p>"""
    return subject, text, _layout(f"Your Pulse code is {code}. It expires in 10 minutes.", body)


def build_message(to: str, subject: str, text: str, html: str) -> EmailMessage:
    """Message with the headers receiving servers expect from a legitimate sender."""
    settings = get_settings()
    sender = settings.company_email_from or settings.mail_user
    domain = sender.rsplit("@", 1)[-1] or "racoai.io"
    message = EmailMessage()
    message["Subject"] = subject
    message["From"] = formataddr(("Pulse", sender))
    message["To"] = to
    message["Reply-To"] = sender
    message["Date"] = formatdate(localtime=False)
    message["Message-ID"] = make_msgid(domain=domain)
    message.set_content(text)
    message.add_alternative(html, subtype="html")
    if f"cid:{LOGO_CID}" in html:
        message.get_payload()[1].add_related(LOGO_PNG, "image", "png", cid=f"<{LOGO_CID}>",
                                              filename="pulse-logo.png", disposition="inline")
    return message


def send(to: str, subject: str, text: str, html: str) -> str:
    """Deliver one email. Uses Resend when configured (fast inbox delivery), else or on failure SMTP.

    Returns the transport that accepted it ("resend" or "smtp").
    """
    settings = get_settings()
    message = build_message(to, subject, text, html)
    if settings.resend_api_key:
        try:
            response = httpx.post(RESEND_URL, timeout=15, headers={"Authorization": f"Bearer {settings.resend_api_key}"}, json={
                "from": message["From"], "to": [to], "reply_to": message["Reply-To"],
                "subject": subject, "text": text, "html": html,
                "attachments": [{"filename": "pulse-logo.png", "content_id": LOGO_CID,
                                 "content": base64.b64encode(LOGO_PNG).decode()}] if f"cid:{LOGO_CID}" in html else [],
            })
            response.raise_for_status()
            return "resend"
        except httpx.HTTPError as exc:
            detail = exc.response.text[:300] if isinstance(exc, httpx.HTTPStatusError) else type(exc).__name__
            logger.warning("Resend delivery failed, falling back to SMTP: %s", detail)
    _send_smtp(message)
    return "smtp"


def _send_smtp(message: EmailMessage) -> None:
    settings = get_settings()
    if not settings.mail_host or not settings.mail_user or not settings.mail_pass:
        raise RuntimeError("No email transport is configured")
    context = ssl.create_default_context()
    if settings.mail_port == 465:
        with smtplib.SMTP_SSL(settings.mail_host, settings.mail_port, context=context, timeout=20) as smtp:
            smtp.login(settings.mail_user, settings.mail_pass)
            smtp.send_message(message)
    else:
        with smtplib.SMTP(settings.mail_host, settings.mail_port, timeout=20) as smtp:
            smtp.starttls(context=context)
            smtp.login(settings.mail_user, settings.mail_pass)
            smtp.send_message(message)
