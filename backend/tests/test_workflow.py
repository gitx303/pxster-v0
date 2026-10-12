from datetime import timedelta
from io import BytesIO
from uuid import uuid4
from PIL import Image
from sqlalchemy import select
from pxster.models import ConnectedAccount, MediaAsset, Post, PostDestination, PublishAttempt, Session, now
from pxster import providers, worker


def image_bytes():
    file = BytesIO()
    Image.new("RGB", (320, 320), "green").save(file, format="PNG")
    return file.getvalue()


def setup_post(client, schedule=None):
    account = client.post("/accounts/demo/facebook").json()
    media = client.post("/media", files={"file": ("test.png", image_bytes(), "image/png")})
    assert media.status_code == 201, media.text
    payload = {"caption": "Hello from Pxster", "media_id": media.json()["id"], "account_ids": [account["id"]], "scheduled_at": schedule}
    return payload


def submit(client, payload, key=None):
    return client.post("/posts", json=payload, headers={"Idempotency-Key": key or str(uuid4())})


def test_publish_flow_and_history(creator):
    result = submit(creator, setup_post(creator))
    assert result.status_code == 201, result.text
    assert result.json()["state"] == "queued"
    assert worker.run_once()
    post = creator.get("/posts").json()[0]
    assert post["state"] == "published"
    dest = post["destinations"][0]
    assert dest["platform_post_id"].startswith("demo-")
    assert len(dest["attempts"]) == 1
    assert not worker.run_once()


def test_future_schedule_waits_and_survives_sessions(creator):
    result = submit(creator, setup_post(creator, (now() + timedelta(hours=1)).isoformat()))
    assert result.json()["state"] == "scheduled"
    assert not worker.run_once()
    with Session() as db:
        dest = db.scalar(select(PostDestination))
        dest.next_attempt_at = now() - timedelta(seconds=1)
        db.commit()
    assert worker.run_once()
    assert creator.get("/posts").json()[0]["state"] == "published"


def test_idempotency_prevents_duplicate_destinations(creator):
    payload = setup_post(creator)
    key = str(uuid4())
    first, second = submit(creator, payload, key), submit(creator, payload, key)
    assert first.json()["id"] == second.json()["id"]
    assert len(creator.get("/posts").json()) == 1
    assert submit(creator, {**payload, "caption": "Changed"}, key).status_code == 409


def test_ownership_isolation(creator):
    payload = setup_post(creator)
    first = submit(creator, payload).json()
    creator.post("/auth/logout")
    creator.post("/auth/register", json={"email": "second@example.com", "password": "second-password-123"})
    assert creator.get("/posts").json() == []
    assert creator.get("/accounts").json() == []
    assert submit(creator, payload).status_code == 404
    assert creator.post(f"/destinations/{first['destinations'][0]['id']}/retry").status_code == 404
    assert creator.get(f"/media/{payload['media_id']}/content").status_code == 404


def test_invalid_media_and_schedule(creator):
    result = creator.post("/media", files={"file": ("fake.png", b"not an image", "image/png")})
    assert result.status_code == 422
    result = creator.post("/media", files={"file": ("wrong.jpg", image_bytes(), "image/jpeg")})
    assert result.status_code == 422
    payload = setup_post(creator)
    assert submit(creator, {**payload, "scheduled_at": (now() - timedelta(minutes=1)).isoformat()}).status_code == 422
    assert submit(creator, {**payload, "scheduled_at": "2030-01-01T12:00:00"}).status_code == 422
    account = creator.post("/accounts/demo/youtube").json()
    assert submit(creator, {**payload, "account_ids": [account["id"]]}).status_code == 422


def test_disconnected_account_fails_before_send(creator):
    payload = setup_post(creator)
    submit(creator, payload)
    creator.delete('/accounts/' + payload['account_ids'][0])
    assert worker.run_once()
    post = creator.get("/posts").json()[0]
    assert post["state"] == "failed"
    assert post["destinations"][0]["attempts"][0]["error_code"] == "reconnect_required"


def test_retry_does_not_republish_successful_siblings(creator, monkeypatch):
    payload = setup_post(creator)
    with Session() as db:
        original = db.get(ConnectedAccount, payload["account_ids"][0])
        other = ConnectedAccount(owner_id=original.owner_id, platform="facebook", platform_account_id="demo-second", display_name="Other Page")
        db.add(other); db.commit()
        payload["account_ids"].append(other.id)
        fail_id = other.id
    real = providers.publish
    seen = []
    def fail_once(account, *args):
        seen.append(account.id)
        if account.id == fail_id:
            raise providers.ProviderError("invalid_media", "Please check the media.")
        return real(account, *args)
    monkeypatch.setattr(providers, "publish", fail_once)
    submit(creator, payload)
    worker.run_once(); worker.run_once()
    post = creator.get("/posts").json()[0]
    assert post["state"] == "partial_failure"
    failed = next(d for d in post["destinations"] if d["state"] == "failed")
    monkeypatch.setattr(providers, "publish", real)
    assert creator.post(f"/destinations/{failed['id']}/retry").status_code == 200
    worker.run_once()
    post = creator.get("/posts").json()[0]
    assert post["state"] == "published"
    assert sorted(len(d["attempts"]) for d in post["destinations"]) == [1, 2]


def test_ambiguous_publish_is_not_automatically_retried(creator, monkeypatch):
    submit(creator, setup_post(creator))
    def timeout(*args):
        raise providers.ProviderError("network_error", "Unknown outcome.", ambiguous=True)
    monkeypatch.setattr(providers, "publish", timeout)
    worker.run_once()
    post = creator.get("/posts").json()[0]
    assert post["state"] == "needs_attention"
    assert not worker.run_once()
    assert creator.post(f"/destinations/{post['destinations'][0]['id']}/retry").status_code == 409


def test_transient_error_schedules_bounded_retry(creator, monkeypatch):
    submit(creator, setup_post(creator))
    def rate_limit(*args):
        raise providers.ProviderError("http_429", "Rate limited", retryable=True)
    monkeypatch.setattr(providers, "publish", rate_limit)
    for expected in range(1, 6):
        assert worker.run_once()
        with Session() as db:
            dest = db.scalar(select(PostDestination))
            assert dest.attempt_count == expected
            assert dest.state == ("failed" if expected == 5 else "retry_wait")
            dest.next_attempt_at = now() - timedelta(seconds=1)
            db.commit()
    assert not worker.run_once()


def test_provider_processing_is_polled_without_second_upload(creator, monkeypatch):
    submit(creator, setup_post(creator))
    calls = []
    def publish(*args):
        calls.append('upload'); return {"state": "processing", "job_id": "remote-job"}
    def poll(*args):
        calls.append('poll'); return {"state": "published", "post_id": "remote-post"}
    monkeypatch.setattr(providers, "publish", publish)
    monkeypatch.setattr(providers, "poll", poll)
    worker.run_once()
    with Session() as db:
        dest = db.scalar(select(PostDestination)); dest.next_attempt_at = now() - timedelta(seconds=1); db.commit()
    worker.run_once()
    assert calls == ['upload', 'poll']
    assert creator.get('/posts').json()[0]['state'] == 'published'


def test_expired_worker_lease_needs_review(creator):
    submit(creator, setup_post(creator))
    with Session() as db:
        dest = db.scalar(select(PostDestination))
        dest.state = 'publishing'; dest.lease_until = now() - timedelta(minutes=1)
        db.add(PublishAttempt(destination_id=dest.id)); db.commit()
    assert not worker.run_once()
    assert creator.get('/posts').json()[0]['state'] == 'needs_attention'


def test_auth_and_csrf(client, creator):
    assert creator.post('/auth/logout', headers={'Origin': 'https://evil.example'}).status_code == 403
    assert creator.get('/auth/me').status_code == 200
    assert creator.post('/auth/logout').status_code == 200
    assert creator.get('/posts').status_code == 401
