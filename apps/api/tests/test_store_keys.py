"""New Supabase API keys are not JWT bearer tokens."""

from types import SimpleNamespace

from pulse_api import store


def test_opaque_secret_uses_api_key_only(monkeypatch):
    monkeypatch.setattr(store, "get_settings", lambda: SimpleNamespace(
        supabase_anon_key="sb_publishable_public",
        supabase_service_role_key="sb_secret_private",
    ))
    assert store.service_headers() == {
        "apikey": "sb_secret_private", "Content-Type": "application/json",
    }
    assert store._headers("session-jwt")["Authorization"] == "Bearer session-jwt"
    assert store._headers("session-jwt")["apikey"] == "sb_publishable_public"


def test_legacy_service_jwt_keeps_bearer(monkeypatch):
    monkeypatch.setattr(store, "get_settings", lambda: SimpleNamespace(
        supabase_anon_key="legacy-anon", supabase_service_role_key="legacy-service",
    ))
    assert store.service_headers()["Authorization"] == "Bearer legacy-service"
