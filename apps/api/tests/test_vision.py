from types import SimpleNamespace

from pulse_api import tasks, vision


def settings(**extra):
    return SimpleNamespace(vision_url="http://vision:8000", vision_model="m",
                           vision_match_threshold=0.7, supabase_url="http://db", **extra)


def test_confident_matches_requires_threshold_and_keeps_near_best(monkeypatch):
    monkeypatch.setattr(vision, "get_settings", settings)
    assert vision.confident_matches([{"product_id": "a", "similarity": 0.65}]) == []
    matches = [{"product_id": "a", "similarity": 0.86}, {"product_id": "b", "similarity": 0.79},
               {"product_id": "c", "similarity": 0.70}]
    assert [m["product_id"] for m in vision.confident_matches(matches)] == ["a", "b"]


def test_index_product_adds_new_and_drops_removed_photos(monkeypatch):
    monkeypatch.setattr(vision, "get_settings", settings)
    calls = []

    def store(method, path, **kw):
        calls.append((method, path, kw))
        if path == "products":
            return [{"id": "p1", "tenant_id": "t1", "media": [{"path": "t1/new"}, {"path": "t1/kept"}]}]
        if method == "GET":
            return [{"media_key": "t1/kept", "model": "m"}, {"media_key": "t1/gone", "model": "m"}]
        return None

    monkeypatch.setattr(vision, "service_request", store)
    monkeypatch.setattr(vision, "storage_bytes", lambda bucket, path: b"img-" + path.encode())
    monkeypatch.setattr(vision, "embed", lambda image: [0.1, 0.2])
    assert vision.index_product("p1") == 1
    deletes = [kw["params"]["media_key"] for method, _, kw in calls if method == "DELETE"]
    posts = [kw["body"]["media_key"] for method, _, kw in calls if method == "POST"]
    assert deletes == ["eq.t1/gone"] and posts == ["t1/new"]


def test_photo_job_uses_matches_or_hands_off(monkeypatch):
    monkeypatch.setattr(vision, "get_settings", settings)
    job = {"id": "j", "tenant_id": "t1", "source_message_id": "m1"}
    monkeypatch.setattr(tasks, "service_request", lambda *a, **k: [
        {"media": [{"path": "t1/photo", "mime_type": "image/jpeg"}]}])
    monkeypatch.setattr(vision, "storage_bytes", lambda bucket, path: b"img")
    monkeypatch.setattr(tasks, "product_facts", lambda tenant, ids: [{"id": i} for i in ids])

    monkeypatch.setattr(vision, "match_photo", lambda tenant, image: [{"product_id": "p1", "similarity": 0.9}])
    assert tasks._photo_matches(job) == [{"id": "p1"}]

    monkeypatch.setattr(vision, "match_photo", lambda tenant, image: [{"product_id": "p1", "similarity": 0.4}])
    assert tasks._photo_matches(job) is None

    def broken(*_):
        raise RuntimeError("vision down")
    monkeypatch.setattr(vision, "match_photo", broken)
    assert tasks._photo_matches(job) is None


def test_photo_job_skips_when_vision_disabled(monkeypatch):
    monkeypatch.setattr(vision, "get_settings", lambda: SimpleNamespace(vision_url=""))
    assert tasks._photo_matches({"id": "j", "tenant_id": "t", "source_message_id": "m"}) is None
