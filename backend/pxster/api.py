from contextlib import asynccontextmanager
from datetime import datetime, timedelta
import hmac
import json
import secrets
import time
from collections import OrderedDict, deque
from typing import Literal
from fastapi import Depends, FastAPI, File, HTTPException, Request, Response, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, RedirectResponse
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import delete, or_, select, text
from sqlalchemy.exc import IntegrityError
from .config import settings
from .models import ConnectedAccount, LoginSession, MediaAsset, OAuthState, Post, PostDestination, PublishAttempt, Session, User, as_utc, now, uid
from .security import digest, encrypt_tokens, passwords
from . import providers, storage
from .features.router import capabilities, install_reserved_routes


@asynccontextmanager
async def lifespan(app):
    settings.validate()
    yield


app = FastAPI(title="Pxster API", version="0.1.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=[settings.app_origin], allow_credentials=True, allow_methods=["GET", "POST", "DELETE"], allow_headers=["Content-Type", "Idempotency-Key"])
auth_requests = OrderedDict()


@app.middleware("http")
async def security_headers(request, call_next):
    if request.method == "POST" and request.url.path == "/media":
        length = request.headers.get("content-length", "")
        if not length.isdigit():
            return JSONResponse({"detail": "Upload requires Content-Length."}, status_code=411)
        if int(length) > settings.max_upload + 1024 * 1024:
            return JSONResponse({"detail": "Upload exceeds 64 MiB."}, status_code=413)
    if request.method == "POST" and request.url.path in {"/auth/login", "/auth/register"}:
        address = request.headers.get("cf-connecting-ip") if settings.environment == "production" else None
        address = address or (request.client.host if request.client else "unknown")
        bucket = auth_requests.setdefault(address, deque())
        auth_requests.move_to_end(address)
        while bucket and bucket[0] < time.monotonic() - 60:
            bucket.popleft()
        if len(bucket) >= 15:
            return JSONResponse({"detail": "Too many sign-in attempts. Try again in a minute."}, status_code=429, headers={"Retry-After": "60"})
        bucket.append(time.monotonic())
        if len(auth_requests) > 10000:
            auth_requests.popitem(last=False)
    if request.method in {"POST", "DELETE", "PUT", "PATCH"} and request.headers.get("origin") != settings.app_origin:
        return JSONResponse({"detail": "Request origin is not allowed."}, status_code=403)
    response = await call_next(request)
    response.headers["Cache-Control"] = "no-store"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "no-referrer"
    return response


@app.exception_handler(providers.ProviderError)
async def provider_error(request, exc):
    return JSONResponse({"detail": exc.message, "code": exc.code}, status_code=502)


def database():
    with Session() as db:
        yield db


def current_user(request: Request, db=Depends(database)):
    token = request.cookies.get("pxster_session", "")
    session = db.get(LoginSession, digest(token)) if token else None
    if not session or as_utc(session.expires_at) <= now():
        raise HTTPException(401, "Sign in to your workspace.")
    return db.get(User, session.user_id)


def owned(db, model, record_id, user):
    record = db.get(model, record_id)
    if not record or record.owner_id != user.id:
        raise HTTPException(404, "Record not found.")
    return record


class Credentials(BaseModel):
    email: str = Field(min_length=3, max_length=254, pattern=r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
    password: str = Field(min_length=12, max_length=256)
    username: str | None = Field(default=None, min_length=3, max_length=32, pattern=r"^[A-Za-z0-9][A-Za-z0-9_.-]*$")


class LoginCredentials(BaseModel):
    identifier: str | None = Field(default=None, min_length=1, max_length=254)
    # Preserve compatibility with existing email-based clients.
    email: str | None = Field(default=None, min_length=3, max_length=254)
    password: str = Field(min_length=12, max_length=256)

    @model_validator(mode="after")
    def require_identifier(self):
        if not (self.identifier or self.email or "").strip():
            raise ValueError("Enter your username or email.")
        return self


class YouTubeOptions(BaseModel):
    title: str = Field(min_length=1, max_length=100, pattern=r"^[^<>]+$")
    privacy: Literal["private", "unlisted", "public"]
    made_for_kids: bool


class TikTokOptions(BaseModel):
    privacy_level: str
    disable_comment: bool = True
    disable_duet: bool = True
    disable_stitch: bool = True
    brand_content_toggle: bool = False
    brand_organic_toggle: bool = False
    consent: bool


class PostInput(BaseModel):
    caption: str = Field(max_length=5000)
    media_id: str
    account_ids: list[str] = Field(min_length=1, max_length=20)
    scheduled_at: datetime | None = None
    youtube: YouTubeOptions | None = None
    tiktok: TikTokOptions | None = None


def start_session(db, user, response):
    token = secrets.token_urlsafe(48)
    db.add(LoginSession(token_hash=digest(token), user_id=user.id, expires_at=now() + timedelta(days=7)))
    db.commit()
    response.set_cookie("pxster_session", token, max_age=604800, httponly=True, secure=settings.environment == "production", samesite="lax", path="/")
    return {"id": user.id, "email": user.email, "username": user.username}


@app.get("/health")
def health(db=Depends(database)):
    db.execute(text("SELECT 1"))
    return {"status": "ok"}


@app.get("/config")
def config():
    return {"features": capabilities(), "demo": settings.demo, "registration": settings.registration, "platforms": {p: providers.configured(p) for p in providers.PLATFORMS}, "max_upload_bytes": settings.max_upload}


@app.post("/auth/register", status_code=201)
def register(payload: Credentials, response: Response, db=Depends(database)):
    if not settings.registration:
        raise HTTPException(403, "Registration is disabled. Ask the workspace owner for an account.")
    user = User(email=payload.email.lower(), username=payload.username.lower() if payload.username else None, password_hash=passwords.hash(payload.password))
    db.add(user)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "That email or username is already in use. Try another or log in.") from None
    return start_session(db, user, response)


@app.post("/auth/login")
def login(payload: LoginCredentials, response: Response, db=Depends(database)):
    identifier = (payload.identifier or payload.email).strip().lower()
    user = db.scalar(select(User).where(or_(User.email == identifier, User.username == identifier)))
    # Also perform the hash check for unknown users to avoid an obvious timing oracle.
    check_hash = user.password_hash if user else DUMMY_HASH
    if not passwords.verify(payload.password, check_hash) or not user:
        raise HTTPException(401, "Username, email, or password is incorrect.")
    return start_session(db, user, response)


DUMMY_HASH = passwords.hash(secrets.token_urlsafe(32))


@app.get("/auth/me")
def me(user=Depends(current_user)):
    return {"id": user.id, "email": user.email, "username": user.username}


@app.post("/auth/logout")
def logout(request: Request, response: Response, db=Depends(database)):
    db.execute(delete(LoginSession).where(LoginSession.token_hash == digest(request.cookies.get("pxster_session", ""))))
    db.commit()
    response.delete_cookie("pxster_session", path="/")
    return {"ok": True}


def account_view(account):
    return {"id": account.id, "platform": account.platform, "display_name": account.display_name, "platform_account_id": account.platform_account_id, "status": account.status, "permissions": account.permissions, "expires_at": account.expires_at, "demo": account.platform_account_id.startswith("demo-")}


@app.get("/accounts")
def accounts(user=Depends(current_user), db=Depends(database)):
    return [account_view(a) for a in db.scalars(select(ConnectedAccount).where(ConnectedAccount.owner_id == user.id).order_by(ConnectedAccount.platform))]


@app.post("/accounts/demo/{platform}", status_code=201)
def demo_account(platform: Literal["facebook", "tiktok", "youtube"], user=Depends(current_user), db=Depends(database)):
    if not settings.demo:
        raise HTTPException(404, "Demo mode is disabled.")
    account = db.scalar(select(ConnectedAccount).where(ConnectedAccount.owner_id == user.id, ConnectedAccount.platform == platform, ConnectedAccount.platform_account_id == f"demo-{platform}"))
    if not account:
        account = ConnectedAccount(owner_id=user.id, platform=platform, platform_account_id=f"demo-{platform}", display_name=f"Demo {platform.title()}", permissions=["demo.publish"])
        db.add(account)
    account.status = "connected"
    db.commit()
    return account_view(account)


@app.delete("/accounts/{account_id}")
def disconnect(account_id: str, user=Depends(current_user), db=Depends(database)):
    account = owned(db, ConnectedAccount, account_id, user)
    # Keep the record for historical posts; remove credentials and stop future sends.
    account.status = "disconnected"
    account.encrypted_tokens = None
    db.commit()
    return {"ok": True}


@app.get("/accounts/{account_id}/creator-info")
def creator_info(account_id: str, user=Depends(current_user), db=Depends(database)):
    account = owned(db, ConnectedAccount, account_id, user)
    if account.platform != "tiktok" or account.status != "connected":
        raise HTTPException(400, "Select a connected TikTok account.")
    return providers.creator_info(account, db)


@app.post("/oauth/{platform}/start")
def oauth_start(platform: Literal["facebook", "tiktok", "youtube"], user=Depends(current_user), db=Depends(database)):
    if not providers.configured(platform):
        raise HTTPException(503, "Configure this platform's OAuth credentials on the API host first.")
    state = secrets.token_urlsafe(48)
    db.add(OAuthState(state_hash=digest(state), owner_id=user.id, platform=platform, expires_at=now() + timedelta(minutes=10)))
    db.commit()
    return {"url": providers.authorization_url(platform, state)}


@app.get("/oauth/{platform}/callback")
def oauth_callback(platform: Literal["facebook", "tiktok", "youtube"], state: str = "", code: str = "", error: str = "", user=Depends(current_user), db=Depends(database)):
    entry = db.scalar(select(OAuthState).where(OAuthState.state_hash == digest(state)).with_for_update())
    if not entry or entry.owner_id != user.id or entry.platform != platform or as_utc(entry.expires_at) <= now():
        raise HTTPException(400, "OAuth session expired or invalid. Start the connection again.")
    db.delete(entry)
    db.commit()
    if error or not code:
        return RedirectResponse(f"{settings.app_origin}/?connection=cancelled#accounts")
    try:
        results = providers.exchange(platform, code)
        if not results:
            return RedirectResponse(f"{settings.app_origin}/?connection=no_accounts#accounts")
        for platform_id, name, tokens in results:
            account = db.scalar(select(ConnectedAccount).where(ConnectedAccount.owner_id == user.id, ConnectedAccount.platform == platform, ConnectedAccount.platform_account_id == platform_id))
            if not account:
                account = ConnectedAccount(owner_id=user.id, platform=platform, platform_account_id=platform_id, display_name=name)
                db.add(account)
            account.display_name = name
            account.encrypted_tokens = encrypt_tokens(tokens)
            account.permissions = tokens.get("scope", providers.SCOPES[platform]).replace(",", " ").split()
            account.expires_at = now() + timedelta(seconds=int(tokens["expires_in"])) if tokens.get("expires_in") else None
            account.status = "connected"
        db.commit()
    except (providers.ProviderError, KeyError):
        db.rollback()
        return RedirectResponse(f"{settings.app_origin}/?connection=failed#accounts")
    return RedirectResponse(f"{settings.app_origin}/?connection=success#accounts")


@app.post("/media", status_code=201)
def upload(file: UploadFile = File(...), user=Depends(current_user), db=Depends(database)):
    data = file.file.read(settings.max_upload + 1)
    try:
        validation = storage.validate_media(data, file.content_type)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from None
    asset_id = uid()
    key = f"{user.id}/{asset_id}"
    storage.save(key, data, file.content_type)
    asset = MediaAsset(id=asset_id, owner_id=user.id, object_key=key, filename=(file.filename or "media")[:255], content_type=file.content_type, size=len(data), validation=validation)
    db.add(asset)
    db.commit()
    return {"id": asset.id, "filename": asset.filename, "content_type": asset.content_type, "size": asset.size, "validation": asset.validation}


@app.get("/media/{asset_id}/content")
def media_content(asset_id: str, user=Depends(current_user), db=Depends(database)):
    asset = owned(db, MediaAsset, asset_id, user)
    return Response(storage.read(asset.object_key), media_type=asset.content_type)


@app.get("/media-delivery/{asset_id}")
def media_delivery(asset_id: str, expires: int, signature: str, request: Request, db=Depends(database)):
    if not settings.token_key or expires < time.time() or not hmac.compare_digest(signature, providers.media_signature(asset_id, expires)):
        raise HTTPException(403, "Media link expired or invalid.")
    asset = db.get(MediaAsset, asset_id)
    if not asset:
        raise HTTPException(404, "Media not found.")
    data = storage.read(asset.object_key)
    headers = {"Accept-Ranges": "bytes"}
    if range_header := request.headers.get("range"):
        import re
        match = re.fullmatch(r"bytes=(\d+)-(\d*)", range_header)
        if not match:
            raise HTTPException(416, "Unsupported byte range.")
        start, end = int(match[1]), int(match[2]) if match[2] else len(data) - 1
        if start > end or end >= len(data):
            raise HTTPException(416, "Invalid byte range.")
        headers["Content-Range"] = f"bytes {start}-{end}/{len(data)}"
        return Response(data[start:end + 1], status_code=206, media_type=asset.content_type, headers=headers)
    return Response(data, media_type=asset.content_type, headers=headers)


def post_view(post, db):
    destinations = []
    for dest in db.scalars(select(PostDestination).where(PostDestination.post_id == post.id)):
        account = db.get(ConnectedAccount, dest.account_id)
        attempts = [{"id": a.id, "attempted_at": a.attempted_at, "finished_at": a.finished_at, "state": a.state, "error_code": a.error_code, "error": a.error, "retry_at": a.retry_at, "platform_post_id": a.platform_post_id} for a in db.scalars(select(PublishAttempt).where(PublishAttempt.destination_id == dest.id).order_by(PublishAttempt.attempted_at))]
        destinations.append({"id": dest.id, "platform": account.platform, "account": account.display_name, "state": dest.state, "last_error": dest.last_error, "platform_post_id": dest.platform_post_id, "next_attempt_at": dest.next_attempt_at, "attempts": attempts})
    return {"id": post.id, "caption": post.caption, "media_id": post.media_id, "state": post.state, "created_at": post.created_at, "scheduled_at": post.scheduled_at, "options": post.options, "destinations": destinations}


@app.post("/posts", status_code=201)
def create_post(payload: PostInput, request: Request, user=Depends(current_user), db=Depends(database)):
    key = request.headers.get("idempotency-key", "")
    if not 16 <= len(key) <= 100:
        raise HTTPException(400, "Provide an Idempotency-Key between 16 and 100 characters.")
    request_hash = digest(json.dumps(payload.model_dump(mode="json"), sort_keys=True))
    existing = db.scalar(select(Post).where(Post.owner_id == user.id, Post.idempotency_key == key))
    if existing:
        if existing.request_hash != request_hash:
            raise HTTPException(409, "This submission key was already used for a different post.")
        return post_view(existing, db)
    media = owned(db, MediaAsset, payload.media_id, user)
    if not media.validation.get("valid"):
        raise HTTPException(422, "Media must pass validation before publishing.")
    selected = [owned(db, ConnectedAccount, a, user) for a in set(payload.account_ids)]
    if any(a.status != "connected" for a in selected):
        raise HTTPException(422, "Reconnect the selected accounts before publishing.")
    platforms = {a.platform for a in selected}
    if platforms & {"tiktok", "youtube"} and media.content_type != "video/mp4":
        raise HTTPException(422, "TikTok and YouTube require MP4 video in this release. Photos are supported on Facebook.")
    if "youtube" in platforms and not payload.youtube:
        raise HTTPException(422, "Set YouTube title, visibility, and audience.")
    if "tiktok" in platforms:
        opts = payload.tiktok
        if not all(360 <= media.validation.get(key, 0) <= 4096 for key in ("width", "height")) or not 23 <= media.validation.get("fps", 0) <= 60:
            raise HTTPException(422, "TikTok video must be 360–4096 pixels on each side and 23–60 frames per second.")
        if not opts or not opts.consent or len(payload.caption) > 2200:
            raise HTTPException(422, "TikTok needs consent, explicit visibility, and a caption no longer than 2,200 characters.")
        if opts.brand_content_toggle and opts.privacy_level == "SELF_ONLY":
            raise HTTPException(422, "TikTok branded content cannot use private visibility.")
        for account in (a for a in selected if a.platform == "tiktok"):
            info = providers.creator_info(account, db)
            if opts.privacy_level not in info["privacy_level_options"] or media.validation["duration"] > info["max_video_post_duration_sec"]:
                raise HTTPException(422, "TikTok visibility or video duration does not match this creator's settings.")
            if any(info.get(f"{action}_disabled") and not getattr(opts, f"disable_{action}") for action in ("comment", "duet", "stitch")):
                raise HTTPException(422, "TikTok interactions conflict with creator settings.")
    scheduled = payload.scheduled_at
    if scheduled and (scheduled.tzinfo is None or scheduled <= now()):
        raise HTTPException(422, "Choose a future schedule with a timezone.")
    when = scheduled or now()
    post = Post(owner_id=user.id, caption=payload.caption, media_id=media.id, scheduled_at=when, state="scheduled" if scheduled else "queued", idempotency_key=key, request_hash=request_hash, options={"youtube": payload.youtube.model_dump() if payload.youtube else None, "tiktok": payload.tiktok.model_dump() if payload.tiktok else None})
    db.add(post)
    try:
        db.flush()
        for account in selected:
            db.add(PostDestination(post_id=post.id, account_id=account.id, next_attempt_at=when))
        db.commit()
    except IntegrityError:
        db.rollback()
        existing = db.scalar(select(Post).where(Post.owner_id == user.id, Post.idempotency_key == key))
        if existing and existing.request_hash == request_hash:
            return post_view(existing, db)
        raise HTTPException(409, "A conflicting submission already exists.") from None
    return post_view(post, db)


@app.get("/posts")
def history(user=Depends(current_user), db=Depends(database), offset: int = 0):
    if offset < 0:
        raise HTTPException(422, "Offset must be non-negative.")
    return [post_view(p, db) for p in db.scalars(select(Post).where(Post.owner_id == user.id).order_by(Post.created_at.desc()).offset(offset).limit(50))]


@app.post("/destinations/{destination_id}/retry")
def retry(destination_id: str, user=Depends(current_user), db=Depends(database)):
    dest = db.scalar(select(PostDestination).where(PostDestination.id == destination_id).with_for_update())
    if not dest:
        raise HTTPException(404, "Destination not found.")
    post = owned(db, Post, dest.post_id, user)
    if dest.state not in {"failed", "needs_attention"}:
        raise HTTPException(409, "Only failed destinations or pending status checks can be retried.")
    if dest.state == "needs_attention" and not dest.provider_job_id:
        raise HTTPException(409, "The publish outcome is unknown. Check the platform before creating another post.")
    dest.state = "processing" if dest.provider_job_id else "queued"
    dest.next_attempt_at = now()
    dest.last_error = None
    post.state = "publishing"
    db.commit()
    return {"ok": True}


# Install last so reservations cannot silently shadow existing API routes.
install_reserved_routes(app, current_user)
