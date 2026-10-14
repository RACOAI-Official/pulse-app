import hashlib
import hmac

from pulse_api.meta import extract_messages, verify_signature


def test_webhook_signature_rejects_tampering():
    body = b'{"object":"page"}'
    signature = "sha256=" + hmac.new(b"test-secret", body, hashlib.sha256).hexdigest()
    assert verify_signature(body, signature)
    assert not verify_signature(body + b" ", signature)
    assert not verify_signature(body, "sha1=abc")


def test_extract_three_channel_inbound_and_ignore_echo():
    messenger = {"object": "page", "entry": [{"id": "page-1", "messaging": [
        {"sender": {"id": "customer-1"}, "message": {"mid": "mid-1", "text": "Hello"}},
        {"sender": {"id": "page-1"}, "message": {"mid": "echo-1", "text": "Reply", "is_echo": True}},
    ]}]}
    instagram = {"object": "instagram", "entry": [{"id": "ig-1", "messaging": [
        {"sender": {"id": "ig-customer"}, "message": {"mid": "ig-mid", "attachments": [
            {"type": "image", "payload": {"url": "https://example.com/image"}},
        ]}},
    ]}]}
    whatsapp = {"object": "whatsapp_business_account", "entry": [{"changes": [{"value": {
        "metadata": {"phone_number_id": "phone-1"},
        "contacts": [{"wa_id": "15551234567", "profile": {"name": "Ada"}}],
        "messages": [{"id": "wamid-1", "from": "15551234567", "type": "text",
                      "text": {"body": "Hi"}}],
    }}]}]}
    fb = extract_messages(messenger)
    ig = extract_messages(instagram)
    wa = extract_messages(whatsapp)
    assert len(fb) == len(ig) == len(wa) == 1
    assert (fb[0].channel, fb[0].account_id, fb[0].provider_id) == ("messenger", "page-1", "mid-1")
    assert (ig[0].channel, ig[0].media[0]["type"]) == ("instagram", "image")
    assert (wa[0].channel, wa[0].customer_name, wa[0].body) == ("whatsapp", "Ada", "Hi")


def test_extract_unsupported_whatsapp_media_to_human_inbox():
    payload = {"object": "whatsapp_business_account", "entry": [{"changes": [{"value": {
        "metadata": {"phone_number_id": "phone"},
        "messages": [{"id": "mid", "from": "customer", "type": "audio",
                      "audio": {"id": "media", "mime_type": "audio/ogg"}}],
    }}]}]}
    result = extract_messages(payload)
    assert result[0].body is None
    assert result[0].media[0]["id"] == "media"
