"""Commerce validation and authorization checks that do not need local Supabase."""

from uuid import UUID

import httpx
import pytest

from pulse_api import commerce, main

TENANT = UUID("00000000-0000-0000-0000-000000000001")
HEADER = "product_key,title,category,description,sku,options,regular_price,offer_price,stock,image_urls,delivery_charge\n"


def test_csv_groups_variants_and_rejects_inconsistent_rows():
    valid = HEADER + (
        "shirt,Shirt,Tops,Soft,S-M,Size=M,12.50,,3,https://example.com/shirt.jpg,2.00\n"
        "shirt,Shirt,Tops,Soft,S-L,Size=L,12.50,10.00,4,https://example.com/shirt.jpg,2.00\n"
    )
    products, errors = commerce.parse_csv(valid, TENANT)
    assert errors == []
    assert len(products) == 1
    assert products[0]["state"] == "active"
    assert len(products[0]["variants"]) == 2
    assert products[0]["variants"][1]["offer_price_minor"] == 1000

    inconsistent = valid.replace("shirt,Shirt,Tops,Soft,S-L", "shirt,Shirt,Other,Soft,S-L")
    products, errors = commerce.parse_csv(inconsistent, TENANT)
    assert len(products[0]["variants"]) == 1
    assert errors == [{"row": 3, "error": "Grouped product details differ between rows"}]


def test_payment_totals_preserve_cancelled_refund_due():
    row = {"state": "cancelled", "commerce_payments": [{"amount_minor": 500}, {"amount_minor": 250}]}
    assert commerce._payment_totals(row)["refund_due_minor"] == 750
    row["state"] = "confirmed"
    assert commerce._payment_totals(row)["refund_due_minor"] == 0


@pytest.mark.asyncio
async def test_commerce_requires_membership_before_store_request(monkeypatch):
    async def fake_session():
        return ("token", {"id": "other"})

    async def deny_membership(*_):
        raise main.HTTPException(404, "Tenant not found")

    async def unexpected_store(*_, **__):
        raise AssertionError("Store must not be read")

    main.app.dependency_overrides[main.session] = fake_session
    monkeypatch.setattr(commerce, "membership", deny_membership)
    monkeypatch.setattr(commerce, "user_request", unexpected_store)
    try:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app), base_url="http://test") as client:
            response = await client.get(f"/tenants/{TENANT}/commerce/products")
        assert response.status_code == 404
    finally:
        main.app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_courier_return_is_manager_only_and_forwards_damage(monkeypatch):
    order = "00000000-0000-0000-0000-0000000000aa"
    item = "00000000-0000-0000-0000-0000000000bb"
    calls = []
    role = {"value": "staff"}

    async def fake_session():
        return ("token", {"id": "user"})

    async def fake_membership(*_):
        return {"role": role["value"]}

    async def fake_store(method, path, token, **kwargs):
        calls.append((path, kwargs.get("body")))
        return {"state": "returned"}

    main.app.dependency_overrides[main.session] = fake_session
    monkeypatch.setattr(commerce, "membership", fake_membership)
    monkeypatch.setattr(commerce, "user_request", fake_store)
    body = {"damaged": [{"item_id": item, "quantity": 1}], "damage_loss_minor": 5000, "note": "Torn"}
    url = f"/tenants/{TENANT}/commerce/orders/{order}/shipment/return"
    try:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app), base_url="http://test") as client:
            assert (await client.post(url, json=body)).status_code == 403
            role["value"] = "manager"
            assert (await client.post(url, json={**body, "damage_loss_minor": -1})).status_code == 422
            bad_courier = await client.post(f"/tenants/{TENANT}/commerce/orders/{order}/shipment",
                                            json={"courier": "dhl"})
            assert bad_courier.status_code == 422
            assert (await client.post(url, json=body)).status_code == 200
    finally:
        main.app.dependency_overrides.clear()
    assert calls == [("rpc/pulse_courier_return", {
        "p_tenant_id": str(TENANT), "p_order_id": order,
        "p_damaged": [{"item_id": item, "quantity": 1}], "p_damage_loss_minor": 5000,
        "p_delivery_fee_minor": None, "p_note": "Torn",
    })]
