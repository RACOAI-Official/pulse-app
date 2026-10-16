"""Opt-in Phase 2 API acceptance against local Supabase (no real payments)."""

import asyncio
import hashlib
from uuid import uuid4

import httpx

from pulse_api.main import app
from pulse_api.settings import get_settings
from pulse_api.store import service_auth_request, service_request


async def request(client, method, path, token, **kwargs):
    response = await client.request(method, path, headers={"Authorization": f"Bearer {token}"}, **kwargs)
    if response.status_code >= 400:
        raise AssertionError(f"{method} {path}: {response.status_code} {response.text}")
    return response.json()


async def main():
    settings = get_settings()
    assert settings.supabase_url.startswith("http://127.0.0.1:"), "Local stack only"
    suffix = uuid4().hex[:10]
    tokens = []
    tenants = []
    for index in range(2):
        email = f"commerce-{suffix}-{index}@example.test"
        password = f"Local-test-{uuid4().hex}!"
        user = service_auth_request("POST", "admin/users", body={
            "email": email, "password": password, "email_confirm": True,
        })
        tenant = service_request("POST", "tenants", body={"name": f"Commerce {suffix} {index}"},
                                 prefer="return=representation")[0]
        service_request("POST", "memberships", body={
            "tenant_id": tenant["id"], "user_id": user["id"], "role": "owner",
        })
        async with httpx.AsyncClient() as client:
            auth = await client.post(f"{settings.supabase_url}/auth/v1/token?grant_type=password",
                                     headers={"apikey": settings.supabase_anon_key},
                                     json={"email": email, "password": password})
            assert auth.status_code == 200, auth.text
            tokens.append(auth.json()["access_token"])
        tenants.append(tenant["id"])

    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://local") as client:
        base = f"/tenants/{tenants[0]}/commerce"
        other = f"/tenants/{tenants[1]}/commerce"
        token = tokens[0]
        assert (await request(client, "GET", f"{base}/config", token))["currency_locked"] is False
        await request(client, "POST", f"{base}/currency", token, json={"currency": "USD"})
        product = await request(client, "POST", f"{base}/products", token, json={
            "handle": f"item-{suffix}", "title": "Test item", "state": "active",
            "media": [{"url": "https://example.com/item.png"}],
            "variants": [{"sku": f"sku-{suffix}", "options": {}, "regular_price_minor": 1200,
                          "offer_price_minor": 1000, "stock": 5}],
        })
        rows = await request(client, "GET", f"{base}/products", token)
        variant = rows[0]["product_variants"][0]
        assert product["id"] == rows[0]["id"] and variant["stock"] == 5
        assert (await request(client, "GET", f"{other}/products", tokens[1])) == []
        denied = await client.get(f"{base}/products", headers={"Authorization": f"Bearer {tokens[1]}"})
        assert denied.status_code == 404, denied.text

        csv_text = ("product_key,title,category,description,sku,options,regular_price,offer_price,stock,image_urls,delivery_charge\n"
                    f"import-{suffix},Imported,,,import-sku-{suffix},,4.50,,2,https://example.com/import.png,\n")
        preview = await request(client, "POST", f"{base}/csv/preview", token, json={"csv_text": csv_text})
        assert preview["errors"] == [] and preview["sha256"] == hashlib.sha256(csv_text.encode()).hexdigest()
        imported = await request(client, "POST", f"{base}/csv/commit", token,
                                 json={"csv_text": csv_text, "sha256": preview["sha256"]})
        assert imported["imported"] == 1

        order = await request(client, "POST", f"{base}/orders", token, json={
            "customer_name": "Ada", "customer_phone": "555", "delivery_address": "Main St",
            "items": [{"variant_id": variant["id"], "quantity": 2}],
        })
        order_path = f"{base}/orders/{order['id']}"
        await request(client, "POST", f"{order_path}/action", token, json={"action": "submit"})
        await request(client, "POST", f"{order_path}/action", token, json={"action": "confirm"})
        current = await request(client, "GET", f"{base}/products", token)
        assert next(p for p in current if p["id"] == product["id"])["product_variants"][0]["stock"] == 3
        await request(client, "POST", f"{order_path}/payments", token,
                      json={"amount_minor": 500, "method": "cash"})
        await request(client, "POST", f"{order_path}/action", token,
                      json={"action": "cancel", "reason": "Customer request"})
        detail = await request(client, "GET", order_path, token)
        assert detail["state"] == "cancelled" and detail["refund_due_minor"] == 500
        current = await request(client, "GET", f"{base}/products", token)
        assert next(p for p in current if p["id"] == product["id"])["product_variants"][0]["stock"] == 5
        await request(client, "POST", f"{base}/products/{product['id']}/remove", token)
        assert next(p for p in await request(client, "GET", f"{base}/products", token) if p["id"] == product["id"])["state"] == "archived"
        await request(client, "POST", f"{base}/products/{product['id']}/restore", token)
        print("Phase 2 local acceptance passed")


if __name__ == "__main__":
    asyncio.run(main())
