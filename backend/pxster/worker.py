"""Durable database queue. Run separately from the API; PostgreSQL supports multiple workers."""
import logging
import time
from datetime import timedelta
from sqlalchemy import select
from .models import ConnectedAccount, MediaAsset, Post, PostDestination, PublishAttempt, Session, now
from .config import settings
from . import providers

log = logging.getLogger("pxster.worker")


def aggregate(db, post_id):
    post = db.scalar(select(Post).where(Post.id == post_id).with_for_update())
    states = list(db.scalars(select(PostDestination.state).where(PostDestination.post_id == post_id)))
    if all(s == "published" for s in states):
        post.state = "published"
    elif any(s in {"queued", "publishing", "processing", "retry_wait"} for s in states):
        post.state = "publishing"
    elif any(s == "needs_attention" for s in states):
        post.state = "needs_attention"
    elif "published" in states:
        post.state = "partial_failure"
    else:
        post.state = "failed"


def recover_leases(db):
    expired = db.scalars(select(PostDestination).where(PostDestination.state == "publishing", PostDestination.lease_until < now()).with_for_update(skip_locked=True)).all()
    for dest in expired:
        dest.state = "processing" if dest.provider_job_id else "needs_attention"
        dest.last_error = "Worker interrupted. Checking existing platform job." if dest.provider_job_id else "Worker interrupted; publishing outcome is unknown. Check the platform before resubmitting."
        dest.next_attempt_at = now()
        attempt = db.scalar(select(PublishAttempt).where(PublishAttempt.destination_id == dest.id).order_by(PublishAttempt.attempted_at.desc()).limit(1))
        if attempt:
            attempt.state, attempt.error_code, attempt.error = dest.state, "worker_interrupted", dest.last_error
        db.flush()
        aggregate(db, dest.post_id)
    db.commit()


def run_once():
    with Session() as db:
        recover_leases(db)
        dest = db.scalar(select(PostDestination).where(PostDestination.state.in_(["queued", "retry_wait", "processing"]), PostDestination.next_attempt_at <= now()).order_by(PostDestination.next_attempt_at).with_for_update(skip_locked=True).limit(1))
        if not dest:
            return False
        polling = bool(dest.provider_job_id)
        dest.state, dest.lease_until = "publishing", now() + timedelta(minutes=10)
        if polling:
            attempt = db.scalar(select(PublishAttempt).where(PublishAttempt.destination_id == dest.id).order_by(PublishAttempt.attempted_at.desc()).limit(1))
        else:
            dest.attempt_count += 1
            attempt = PublishAttempt(destination_id=dest.id)
            db.add(attempt)
        db.flush()
        aggregate(db, dest.post_id)
        db.commit()
        try:
            account = db.get(ConnectedAccount, dest.account_id)
            if account.status != "connected":
                raise providers.ProviderError("reconnect_required", "Account disconnected. Reconnect before retrying.")
            post = db.get(Post, dest.post_id)
            media = db.get(MediaAsset, post.media_id)
            result = providers.poll(account, dest, db) if polling else providers.publish(account, post, media, db)
            dest.state = result["state"]
            dest.provider_job_id = result.get("job_id") or dest.provider_job_id
            dest.platform_post_id = result.get("post_id") or dest.platform_post_id
            dest.last_error = None
            dest.next_attempt_at = now() + timedelta(seconds=60)
            attempt.state = dest.state
            attempt.platform_post_id = dest.platform_post_id
            attempt.error = attempt.error_code = None
            if dest.state == "published":
                attempt.finished_at = now()
        except providers.ProviderError as exc:
            dest.last_error = exc.message
            attempt.error_code, attempt.error = exc.code, exc.message
            if polling:
                # Never submit another upload while a known job might still be live.
                dest.state = "processing" if exc.retryable else "needs_attention"
            elif exc.ambiguous:
                dest.state = "needs_attention"
            elif exc.retryable and dest.attempt_count < 5:
                dest.state = "retry_wait"
            else:
                dest.state = "failed"
            dest.next_attempt_at = now() + timedelta(seconds=min(3600, 30 * 2 ** min(dest.attempt_count, 7)))
            attempt.state = dest.state
            attempt.retry_at = dest.next_attempt_at if dest.state in {"retry_wait", "processing"} else None
            attempt.finished_at = now() if not polling else None
        except Exception:
            # Do not log response bodies, credentials, or ambiguous publish requests.
            log.error("Unexpected provider failure for destination %s", dest.id)
            dest.state, dest.last_error = "needs_attention", "Unexpected error. Review this destination before resubmitting."
            attempt.state, attempt.error_code, attempt.error = dest.state, "unexpected_error", dest.last_error
        dest.lease_until = None
        db.flush()
        aggregate(db, dest.post_id)
        db.commit()
        return True


if __name__ == "__main__":
    settings.validate()
    logging.basicConfig(level=logging.INFO)
    while True:
        try:
            worked = run_once()
        except Exception:
            log.error("Worker database operation failed; retrying in 5 seconds")
            worked = False
        if not worked:
            time.sleep(5)
