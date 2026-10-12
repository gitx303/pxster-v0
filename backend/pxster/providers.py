"""Provider HTTP adapters. Never return token-bearing response bodies to clients/logs."""
import hashlib
import hmac
import os
import time
from datetime import timedelta
from urllib.parse import urlencode, urlparse
import httpx
from .config import settings
from .models import as_utc, now
from .security import decrypt_tokens, encrypt_tokens
from . import storage

PLATFORMS = ("facebook", "tiktok", "youtube")
SCOPES = {
    "facebook": "pages_show_list,pages_read_engagement,pages_manage_posts",
    "tiktok": "user.info.basic,video.publish",
    "youtube": "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly",
}


class ProviderError(Exception):
    def __init__(self, code, message, retryable=False, ambiguous=False):
        self.code, self.message, self.retryable, self.ambiguous = code, message, retryable, ambiguous
        super().__init__(message)


def credentials(platform):
    prefix = "GOOGLE" if platform == "youtube" else platform.upper()
    return os.getenv(f"{prefix}_CLIENT_ID", ""), os.getenv(f"{prefix}_CLIENT_SECRET", "")


def configured(platform):
    return all(credentials(platform)) and bool(settings.token_key)


def callback(platform):
    return f"{settings.api_url}/oauth/{platform}/callback"


def authorization_url(platform, state):
    client_id, _ = credentials(platform)
    params = dict(client_id=client_id, redirect_uri=callback(platform), response_type="code", scope=SCOPES[platform], state=state)
    if platform == "facebook":
        base = f"https://www.facebook.com/{settings.facebook_version}/dialog/oauth"
    elif platform == "tiktok":
        base = "https://www.tiktok.com/v2/auth/authorize/"
        params["client_key"] = params.pop("client_id")
    else:
        base = "https://accounts.google.com/o/oauth2/v2/auth"
        params.update(access_type="offline", prompt="consent", include_granted_scopes="true")
    return base + "?" + urlencode(params)


def request(method, url, *, mutation=False, **kwargs):
    try:
        response = httpx.request(method, url, timeout=120, follow_redirects=False, **kwargs)
    except httpx.TransportError:
        raise ProviderError("network_error", "The platform connection was interrupted.", retryable=not mutation, ambiguous=mutation) from None
    if response.status_code >= 400:
        status = response.status_code
        raise ProviderError(f"http_{status}", "Platform rejected the request. Reconnect for authorization errors; check platform limits and media requirements.",
                            retryable=status == 429 or (status >= 500 and not mutation), ambiguous=status >= 500 and mutation)
    if response.status_code >= 300:
        raise ProviderError("unexpected_redirect", "Unexpected platform redirect; review the integration.", ambiguous=mutation)
    return response


def tiktok(path, token, data=None, mutation=False):
    body = request("POST", f"https://open.tiktokapis.com/v2/{path}/", headers={"Authorization": f"Bearer {token}"}, json=data or {}, mutation=mutation).json()
    code = body.get("error", {}).get("code", "ok")
    if code != "ok":
        raise ProviderError(str(code)[:80], "TikTok rejected this action. Check account permissions, privacy, and posting limits.", retryable=code == "rate_limit_exceeded" or (code == "internal_error" and not mutation), ambiguous=code == "internal_error" and mutation)
    return body["data"]


def exchange(platform, code):
    client_id, secret = credentials(platform)
    data = dict(client_id=client_id, client_secret=secret, code=code, grant_type="authorization_code", redirect_uri=callback(platform))
    if platform == "facebook":
        token = request("GET", f"https://graph.facebook.com/{settings.facebook_version}/oauth/access_token", params=data).json()
        long_token = request("GET", f"https://graph.facebook.com/{settings.facebook_version}/oauth/access_token", params={"grant_type": "fb_exchange_token", "client_id": client_id, "client_secret": secret, "fb_exchange_token": token["access_token"]}).json()
        permissions = request("GET", f"https://graph.facebook.com/{settings.facebook_version}/me/permissions", headers={"Authorization": f"Bearer {long_token['access_token']}"}).json()
        granted = [p["permission"] for p in permissions.get("data", []) if p.get("status") == "granted"]
        if not set(SCOPES[platform].split(',')).issubset(granted):
            raise ProviderError("missing_permissions", "Grant the required Facebook Page permissions to connect.")
        pages = []
        after = None
        for _ in range(20):
            params = {"fields": "id,name,access_token,tasks", "limit": 100}
            if after:
                params["after"] = after
            body = request("GET", f"https://graph.facebook.com/{settings.facebook_version}/me/accounts", headers={"Authorization": f"Bearer {long_token['access_token']}"}, params=params).json()
            pages.extend((p["id"], p["name"], {"access_token": p["access_token"], "scope": ','.join(granted)}) for p in body.get("data", []) if "CREATE_CONTENT" in p.get("tasks", []))
            after = body.get("paging", {}).get("cursors", {}).get("after") if body.get("paging", {}).get("next") else None
            if not after:
                break
        return pages
    if platform == "tiktok":
        data["client_key"] = data.pop("client_id")
        token = request("POST", "https://open.tiktokapis.com/v2/oauth/token/", data=data).json()
        if "access_token" not in token:
            raise ProviderError("oauth_denied", "TikTok did not grant access.")
        if not set(SCOPES[platform].split(',')).issubset(token.get('scope', '').split(',')):
            raise ProviderError("missing_permissions", "Grant TikTok profile and publishing permissions to connect.")
        user = request("GET", "https://open.tiktokapis.com/v2/user/info/", params={"fields": "open_id,display_name"}, headers={"Authorization": f"Bearer {token['access_token']}"}).json()["data"]["user"]
        return [(user["open_id"], user["display_name"], token)]
    token = request("POST", "https://oauth2.googleapis.com/token", data=data).json()
    if not set(SCOPES[platform].split()).issubset(token.get('scope', '').split()):
        raise ProviderError("missing_permissions", "Grant YouTube channel and upload permissions to connect.")
    channels = request("GET", "https://www.googleapis.com/youtube/v3/channels", params={"part": "snippet", "mine": "true"}, headers={"Authorization": f"Bearer {token['access_token']}"}).json()
    return [(c["id"], c["snippet"]["title"], token) for c in channels.get("items", [])]


def access_token(account, db):
    # Row lock serializes refresh-token rotation across API/worker processes.
    from sqlalchemy import select
    from .models import ConnectedAccount
    account = db.scalar(select(ConnectedAccount).where(ConnectedAccount.id == account.id).with_for_update().execution_options(populate_existing=True))
    if account.status != "connected" or not account.encrypted_tokens:
        raise ProviderError("reconnect_required", "Reconnect this account before publishing.")
    token = decrypt_tokens(account.encrypted_tokens)
    if account.expires_at and as_utc(account.expires_at) <= now() + timedelta(minutes=5):
        if not token.get("refresh_token"):
            raise ProviderError("reconnect_required", "This account authorization expired. Reconnect it.")
        client_id, secret = credentials(account.platform)
        data = dict(client_id=client_id, client_secret=secret, grant_type="refresh_token", refresh_token=token["refresh_token"])
        endpoint = "https://oauth2.googleapis.com/token"
        if account.platform == "tiktok":
            data["client_key"] = data.pop("client_id")
            endpoint = "https://open.tiktokapis.com/v2/oauth/token/"
        updated = request("POST", endpoint, data=data).json()
        if "access_token" not in updated:
            raise ProviderError("reconnect_required", "Refresh failed. Reconnect this account.")
        token.update(updated)
        account.encrypted_tokens = encrypt_tokens(token)
        account.expires_at = now() + timedelta(seconds=int(token.get("expires_in", 3600)))
    db.commit()
    return token["access_token"]


def media_signature(asset_id, expires):
    return hmac.new(settings.token_key.encode(), f"{asset_id}:{expires}".encode(), hashlib.sha256).hexdigest()


def delivery_url(asset_id):
    expires = int(time.time()) + 7200
    return f"{settings.api_url}/media-delivery/{asset_id}?expires={expires}&signature={media_signature(asset_id, expires)}"


def creator_info(account, db):
    if account.platform_account_id.startswith("demo-") and settings.demo:
        return {"creator_nickname": account.display_name, "privacy_level_options": ["SELF_ONLY", "PUBLIC_TO_EVERYONE"], "comment_disabled": False, "duet_disabled": False, "stitch_disabled": False, "max_video_post_duration_sec": 600}
    return tiktok("post/publish/creator_info/query", access_token(account, db))


def publish(account, post, media, db):
    if account.platform_account_id.startswith("demo-") and settings.demo:
        return {"state": "published", "post_id": "demo-" + post.id}
    token = access_token(account, db)
    headers = {"Authorization": f"Bearer {token}"}
    if account.platform == "tiktok":
        info = creator_info(account, db)
        options = post.options["tiktok"]
        if options["privacy_level"] not in info["privacy_level_options"] or media.validation["duration"] > info["max_video_post_duration_sec"]:
            raise ProviderError("creator_settings_changed", "TikTok privacy or duration limits changed. Create a new post with updated settings.")
        for action in ("comment", "duet", "stitch"):
            if info.get(f"{action}_disabled") and not options.get(f"disable_{action}", True):
                raise ProviderError("creator_settings_changed", "TikTok interaction settings changed. Review your post.")
        body = tiktok("post/publish/video/init", token, {"post_info": {"title": post.caption, **{k: v for k, v in options.items() if k != "consent"}}, "source_info": {"source": "PULL_FROM_URL", "video_url": delivery_url(media.id)}}, mutation=True)
        return {"state": "processing", "job_id": body["publish_id"]}
    data = storage.read(media.object_key)
    if account.platform == "facebook":
        video = media.content_type == "video/mp4"
        host = "graph-video.facebook.com" if video else "graph.facebook.com"
        endpoint = "videos" if video else "photos"
        body = request("POST", f"https://{host}/{settings.facebook_version}/{account.platform_account_id}/{endpoint}", headers=headers, files={"source": (media.filename, data, media.content_type)}, data={"description" if video else "message": post.caption}, mutation=True).json()
        return {"state": "processing" if video else "published", "post_id": str(body.get("post_id") or body["id"]), "job_id": str(body["id"]) if video else None}
    opts = post.options["youtube"]
    initial = request("POST", "https://www.googleapis.com/upload/youtube/v3/videos", params={"uploadType": "resumable", "part": "snippet,status"}, headers={**headers, "X-Upload-Content-Length": str(media.size), "X-Upload-Content-Type": media.content_type}, json={"snippet": {"title": opts["title"], "description": post.caption}, "status": {"privacyStatus": opts["privacy"], "selfDeclaredMadeForKids": opts["made_for_kids"]}})
    upload_url = initial.headers["Location"]
    parsed = urlparse(upload_url)
    if parsed.scheme != "https" or parsed.hostname != "www.googleapis.com":
        raise ProviderError("invalid_upload_url", "YouTube returned an unexpected upload endpoint.")
    body = request("PUT", upload_url, headers={**headers, "Content-Type": media.content_type}, content=data, mutation=True).json()
    return {"state": "processing", "job_id": body["id"], "post_id": body["id"]}


def poll(account, destination, db):
    token = access_token(account, db)
    if account.platform == "tiktok":
        data = tiktok("post/publish/status/fetch", token, {"publish_id": destination.provider_job_id})
        if data["status"] == "FAILED":
            raise ProviderError(str(data.get("fail_reason", "platform_failed"))[:80], "TikTok could not publish this post. Review the platform error code before retrying.")
        ids = data.get("publicaly_available_post_id", [])
        return {"state": "published" if data["status"] == "PUBLISH_COMPLETE" else "processing", "post_id": str(ids[0]) if ids else None}
    headers = {"Authorization": f"Bearer {token}"}
    if account.platform == "facebook":
        data = request("GET", f"https://graph.facebook.com/{settings.facebook_version}/{destination.provider_job_id}", headers=headers, params={"fields": "status"}).json()
        status = data.get("status", {}).get("video_status")
        if status == "error":
            raise ProviderError("processing_failed", "Facebook video processing failed.")
        return {"state": "published" if status == "ready" else "processing"}
    data = request("GET", "https://www.googleapis.com/youtube/v3/videos", headers=headers, params={"id": destination.provider_job_id, "part": "status,processingDetails"}).json()
    if not data.get("items"):
        raise ProviderError("video_missing", "YouTube could not find this uploaded video.")
    item = data["items"][0]
    status = item["status"]["uploadStatus"]
    if status in ("failed", "rejected", "deleted"):
        raise ProviderError("processing_failed", "YouTube rejected or removed this video.")
    return {"state": "published" if status == "processed" else "processing"}
