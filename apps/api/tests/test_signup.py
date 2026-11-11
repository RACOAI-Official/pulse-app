import pytest
from fastapi import HTTPException

from pulse_api import signup


class FakeRedis:
    def __init__(self):
        self.data = {}

    async def set(self, key, value, nx=False, ex=None):
        if nx and key in self.data:
            return None
        self.data[key] = value
        return True

    async def hset(self, key, mapping):
        self.data.setdefault(key, {}).update({k: str(v) for k, v in mapping.items()})

    async def expire(self, key, ttl):
        return True

    async def hgetall(self, key):
        return dict(self.data.get(key, {}))

    async def hincrby(self, key, field, amount):
        value = int(self.data[key].get(field, 0)) + amount
        self.data[key][field] = str(value)
        return value

    async def delete(self, key):
        self.data.pop(key, None)

    async def aclose(self):
        pass


@pytest.fixture
def fake(monkeypatch):
    store = FakeRedis()
    sent = {}
    monkeypatch.setattr(signup, "_redis", lambda: store)
    monkeypatch.setattr(signup, "send_code_email", lambda to, code: sent.update(to=to, code=code))
    return store, sent


@pytest.mark.asyncio
async def test_signup_code_creates_user_and_workspace(fake, monkeypatch):
    store, sent = fake
    calls = []
    monkeypatch.setattr(signup, "service_auth_request", lambda method, path, **kw: calls.append((path, kw)) or {"id": "user-1"})
    monkeypatch.setattr(signup, "service_request", lambda method, path, **kw: calls.append((path, kw)) or [{"id": "tenant-1"}])
    await signup.start_signup(signup.StartBody(email=" Owner@Shop.com ", business_name="My Shop"))
    assert sent["to"] == "owner@shop.com" and len(sent["code"]) == 6
    with pytest.raises(HTTPException) as cooldown:
        await signup.start_signup(signup.StartBody(email="owner@shop.com", business_name="My Shop"))
    assert cooldown.value.status_code == 429
    result = await signup.verify_signup(signup.VerifyBody(email="owner@shop.com", code=sent["code"], password="secret123"))
    assert result == {"created": True}
    assert calls[0][1]["body"]["email_confirm"] is True
    assert calls[1] == ("tenants", {"body": {"name": "My Shop"}, "prefer": "return=representation"})
    assert calls[2][1]["body"] == {"tenant_id": "tenant-1", "user_id": "user-1", "role": "owner"}
    assert "signup:owner@shop.com" not in store.data


@pytest.mark.asyncio
async def test_wrong_codes_lock_out(fake):
    store, sent = fake
    await signup.start_signup(signup.StartBody(email="a@b.co", business_name="Shop"))
    wrong = "000000" if sent["code"] != "000000" else "111111"
    for _ in range(signup.MAX_ATTEMPTS):
        with pytest.raises(HTTPException) as bad:
            await signup.verify_signup(signup.VerifyBody(email="a@b.co", code=wrong, password="secret123"))
        assert bad.value.status_code == 400
    with pytest.raises(HTTPException) as locked:
        await signup.verify_signup(signup.VerifyBody(email="a@b.co", code=sent["code"], password="secret123"))
    assert locked.value.status_code == 429
