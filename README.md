# Pxster

A Cloudflare-ready publishing foundation for **Facebook Pages, TikTok, and YouTube**.

Creator uploads media → writes a caption → selects accounts → publishes now or schedules.

This folder contains working application code and deployment configuration. **No Cloudflare resources, domains, developer apps, or live social accounts have been provisioned by creating these files.** Provider adapters require credentials, permissions, and live verification before launch.

## Run locally

```sh
python3 -m venv .venv
.venv/bin/pip install -r backend/requirements.lock
.venv/bin/python scripts/dev.py
```

Open <http://localhost:5174> for the landing page. Choose **Log in** or **Sign up**. Sign up accepts a unique username, email, and password of at least 12 characters; log in accepts your username or email. The workspace remains hidden until the API confirms your session. Once logged in, open Connected accounts, add demo accounts, and compose a post. The worker records simulated results. The demo script explicitly removes live OAuth credentials from its child processes. Use JPEG/PNG/WebP for Facebook; install FFmpeg locally for MP4 validation. The Docker image includes FFmpeg.

- App: `http://localhost:5173`
- Landing: `http://localhost:5174`
- API documentation: `http://localhost:8017/docs`
- Tests: `PYTHONPATH=backend .venv/bin/pytest backend/tests -q`

## Deployment layout

| Address | Service | Can change independently |
| --- | --- | --- |
| `pxster.xyz` | Workers Static Assets → `landing/public` | Landing design and hosting |
| `app.pxster.xyz` | Workers Static Assets → `app/public` | App design and frontend implementation |
| `media.pxster.xyz` | Delivery Worker → signed API → private R2 | Controlled media delivery |
| `api.pxster.xyz` | Cloudflare Tunnel → FastAPI Docker service | Docker host and backend infrastructure |

Private Cloudflare R2 stores media. PostgreSQL stores relational records and the durable queue. The worker runs alongside FastAPI, polls due destinations, and records platform responses. D1, KV, and Cloudflare Queues are not required for this deployment: PostgreSQL keeps the FastAPI backend portable and transactionally couples post creation with its queue entries.

See [Cloudflare deployment](docs/cloudflare.md), [data and publishing behavior](docs/architecture.md), and [platform setup](docs/platforms.md).

## Included

- Responsive composer, account management, media preview, history, and attempt details.
- Electric cyan/magenta synthwave branding using the supplied Pxster logo.
- Dedicated Login/Sign up screens, username-or-email login, and a workspace that stays hidden until authentication succeeds.
- Workspace login with Argon2 passwords and revocable HttpOnly cookie sessions.
- OAuth state bound to the initiating user, encrypted provider tokens, and refresh handling.
- Private media storage, server-side image/video validation, and signed TikTok media delivery.
- UTC scheduling that survives API restarts; independent per-account results.
- Idempotent post creation, bounded automatic retries, and explicit unknown-result handling.
- Facebook photo/video, TikTok Direct Post video, and YouTube resumable video adapters.
- Alembic migration, Docker Compose, Workers Static Assets and signed media delivery configurations, and isolated tests.

## Current boundaries

One media asset per post; MP4 video up to 64 MiB and 10 minutes; TikTok's live creator limit may be lower. Facebook personal profiles, albums, Shorts-specific controls, TikTok photo posts, transcoding, team roles, password reset, and email verification are not implemented. Account disconnection removes Pxster's stored credentials; users can revoke the application's grant in each platform's settings.

Provider processing is tracked by polling; webhook receivers are deliberately not exposed yet. Live provider calls and Cloudflare deployment must be checked with your actual credentials. The frontend and backend do not claim a post is published merely because it was queued.

## Branding and accounts

The original supplied PNG is copied unchanged to both frontends under `public/assets/pxster-logo.png`; CSS controls its presentation. Production Sign up follows `ALLOW_REGISTRATION` (enabled in `.env.example`). Preview credentials are created only in the local database and are not embedded in the frontend, source, or distribution ZIP. The username migration preserves existing email-only accounts.

Policy routes `/privacy`, `/terms`, and `/data-deletion` are supplied as drafts pending operator/contact details and review. See the deployment guide before publishing.
