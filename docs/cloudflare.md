# Ownership update — 2026-10-14

API/media Worker commands run from social-media-tool-publisher, not this folder. Media is not deployed: the current live API lacks its required endpoint. The following FastAPI/R2 instructions describe a future alternative, not the active test API.

# Deploy to Cloudflare

## Current hosting decision — Workers Free

As of 12 October 2026, use **Workers Free** for the initial TikTok Sandbox integration, with D1 on its free allowance. Do not enable Workers Paid, Containers, or other paid subscriptions without the operator's explicit approval.

The intended first scope is authenticated account connection, TikTok OAuth state/callback handling, and encrypted token storage. The isolated connection-only Workers/D1 implementation is described in [Cloudflare test setup](cloudflare-test.md). It does not migrate the FastAPI publishing backend. The Docker/PostgreSQL/Tunnel instructions below describe the existing alternative architecture, not the selected Free deployment.

Workers Free currently allows 100,000 dynamic requests per day across the account and 10 ms CPU time per invocation. D1's free allowance includes 5 million rows read/day, 100,000 rows written/day, and 5 GB total storage; per-database limits also apply. Validate authentication, encryption, dependencies, and database operations in the actual runtime before claiming this deployment works. Do not weaken password hashing to meet the CPU budget. Account-wide quotas include other applications. Exceeding free quotas can make the API unavailable.

Defer media processing and scheduled publishing until separately adapted and verified. R2 is a separate metered product with its own free allowance; Workers Free does not make all media storage or operations free. Creating D1 or setting a DNS record alone does not deploy a functioning API.

References: [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/).

## 1. Provision Workers Static Assets and private R2

The landing website and dashboard use **Workers Static Assets**, not Pages. The supplied Wrangler configurations declare custom domains, disable workers.dev/preview URLs, and upload only their respective public asset directories. The app uses hash routes and retains real 404 responses for unknown paths.

| URL | Implementation |
| --- | --- |
| `https://pxster.xyz` | `pxster-landing` Worker, `landing/public` |
| `https://pxster.xyz/privacy` | Static `privacy.html` |
| `https://pxster.xyz/terms` | Static `terms.html` |
| `https://pxster.xyz/data-deletion` | Static `data-deletion.html` instructions, not a callback |
| `https://app.pxster.xyz` | `pxster-app` Worker, `app/public` |
| `https://api.pxster.xyz` | Cloudflare Tunnel to FastAPI |
| `https://api.pxster.xyz/oauth/facebook/callback` | Existing FastAPI Facebook OAuth handler |
| `https://api.pxster.xyz/oauth/tiktok/callback` | Existing FastAPI TikTok OAuth handler |
| `https://api.pxster.xyz/oauth/youtube/callback` | Existing FastAPI Google/YouTube OAuth handler |
| `https://media.pxster.xyz/media-delivery/<asset-id>` | Delivery Worker → signed FastAPI endpoint → private R2 |

**Operator decisions (12 October 2026):** X303 operates in the Philippines. `hey@pxster.xyz` and `privacy@pxster.xyz` still need setup, delivery testing, and monitoring. Proposed acknowledgement within 7 days, verified deletion within 30 days, and backup expiry within 90 days are review placeholders only, not approved operational commitments. Keep policy pages in draft/noindex until these items and the remaining terms are resolved.

**Launch prerequisite:** policy pages are clearly labeled drafts. Replace all bracketed placeholders with the legal operator and monitored contact information, decide the stated retention/recovery policies, review the terms, and remove draft/noindex markers only after approval. Do not submit draft policies for platform verification. The current code has no automated account-deletion workflow; establish the manual process before publishing deletion instructions as final.

Add `pxster.xyz` as an active zone in your Cloudflare account. Review existing DNS and Pages bindings before assigning these domains: moving an existing domain changes live routing. Preserve a record of the old configuration for rollback. Do not create competing A/CNAME records. Workers custom domains manage DNS and certificates for the three Worker hostnames; Tunnel manages the API hostname.

Authenticate Wrangler using your own Cloudflare account. From the repository root:

```sh
npx wrangler login
npx wrangler whoami
npx wrangler r2 bucket create pxster-media
# Validate first (does not deploy or change DNS):
npx wrangler deploy --dry-run --config cloudflare/landing.wrangler.jsonc
npx wrangler deploy --dry-run --config cloudflare/app.wrangler.jsonc
npx wrangler deploy --dry-run --config infrastructure/cloudflare/media/wrangler.jsonc
# After policy finalization and routing review:
npx wrangler deploy --config cloudflare/landing.wrangler.jsonc
npx wrangler deploy --config cloudflare/app.wrangler.jsonc
npx wrangler deploy --config infrastructure/cloudflare/media/wrangler.jsonc
```

For Git-connected Workers Builds, select `gitx303/pxster-v0`, branch `main`, and root `/` for each Worker. No frontend compilation is required. Use the corresponding `npx wrangler deploy --config cloudflare/<name>.wrangler.jsonc` as its deploy command. Connect only the intended repository; do not put backend secrets in frontend build variables.

Keep `pxster-media` private: leave its `r2.dev` URL disabled and do not attach a public bucket domain. Generate R2 S3 credentials scoped to Object Read & Write on this bucket. The API proxies uploads, so bucket browser CORS and public read permissions are unnecessary. R2 keys never enter frontend files.

The media Worker has no R2 credentials or encryption key. It permits only GET requests on the media-delivery path, validates the signature format/expiry, and lets FastAPI verify the actual HMAC before returning media. It forwards only the Range header, does not follow redirects, and sets no-store responses. The root `https://media.pxster.xyz/` intentionally returns 404; there is no media browser or directory listing. The equivalent signed API URL remains reachable and enforces the same HMAC check.

## 2. Prepare the backend host

Use a Docker host with outbound Internet access. Copy `.env.example` to `.env` and fill in:

- A strong database password; use its URL-encoded equivalent in `DATABASE_URL`.
- A Fernet key generated by `.venv/bin/python -c 'from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())'`.
- R2 endpoint `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`, bucket name, and scoped access credentials.
- Platform credentials described in [platforms.md](platforms.md).
- `ENVIRONMENT=production`, `DEMO_MODE=false`, `ALLOW_REGISTRATION=true` to enable the requested Sign up flow.

The frontend's public API address is in `app/public/config.js`. Backend `APP_ORIGIN` controls credentialed CORS; `API_URL` controls OAuth callbacks; `MEDIA_URL=https://media.pxster.xyz` controls signed delivery URLs (falls back to `API_URL` when unset for local development). The supplied production addresses are already set to the Pxster domains. Keep `TOKEN_ENCRYPTION_KEY` stable and back it up separately from the database. Rotation requires re-encrypting existing provider tokens or reconnecting accounts.

## 3. Create the API tunnel

In Cloudflare Zero Trust, create a remotely managed tunnel, select the Docker connector, and place its token in `.env` as `TUNNEL_TOKEN`. Configure its published application route:

| Hostname | Service |
| --- | --- |
| `api.pxster.xyz` | `http://api:8000` |

`api` is the Compose service name on the shared network. Cloudflare creates the tunnel DNS record. `cloudflare/tunnel-ingress.example.json` shows the corresponding ingress configuration for automation; it is not automatically applied by Compose. Do not point the tunnel back at its own public hostname.

```sh
docker compose up -d --build
docker compose exec api python -m pxster.create_user
docker compose logs --tail 100 api worker
```

Compose waits for PostgreSQL, runs migrations once, then starts the API and worker. The API exposes no host port; the tunnel is its public ingress. Do not put an interactive Cloudflare Access challenge in front of social OAuth callbacks or signed media delivery, since provider requests must be able to reach them.

## 4. Cloudflare request settings

- Use HTTPS for all four hostnames. Workers custom domains and Tunnel terminate public TLS.
- Bypass cache for all `api.pxster.xyz` and `media.pxster.xyz` requests; do not enable a Cache Everything override for signed delivery. API responses already use `Cache-Control: no-store`.
- Apply an account-appropriate rate limiting rule to `/auth/login` and `/auth/register`; the API also has a per-process 15-request/minute limiter. Shared edge limiting is required if scaling API replicas.
- Allow POST uploads below 65 MiB on `/media`. Pxster itself accepts at most 64 MiB of media. Do not challenge `/media-delivery/*`; these paths require expiring HMAC signatures and are used by TikTok's verified URL fetcher.
- Never log query strings on OAuth callbacks or media-delivery routes. Uvicorn access logs are disabled in the supplied launch commands.

## 5. Verify before using live accounts

Confirm `/privacy`, `/terms`, and `/data-deletion` serve finalized policies on the landing domain. Confirm Workers custom-domain certificates are active. Requesting OAuth callbacks without valid state/session must fail, not grant access. Fetch an actual signed URL at the media domain, test a byte range, then confirm modified/expired signatures fail. Ensure media root and unrelated routes return 404. Verify TikTok ownership for `media.pxster.xyz`, not the R2 S3 hostname.


1. Check `https://api.pxster.xyz/health` and log in through the app.
2. Connect approved platform apps and confirm the expected Pages/channels appear.
3. Upload a small media file and confirm its validation result.
4. Use private/test visibility for a first live publish; inspect its destination and attempt records.
5. Schedule another post, restart the API, and confirm the worker still processes it.
6. Disconnect an account and confirm subsequent sends fail with a reconnection message.

Back up PostgreSQL and the encryption key. Configure R2 retention based on your product policy; no automatic deletion is enabled because scheduled posts and history may still reference media. An upload that is never used remains in storage until a future retention job is implemented.

## 6. Production security notes

These notes describe the supplied implementation and the deployment controls you must configure. Setting `ENVIRONMENT=production` enables configuration checks and Secure cookies; it does not provision backups, disk encryption, edge rules, or multi-factor authentication.

### Secrets and access

| Value | Handling |
| --- | --- |
| `TOKEN_ENCRYPTION_KEY` | Backend-only Fernet key for provider credentials; also used to sign media delivery URLs. Keep a separately protected backup. |
| `POSTGRES_PASSWORD`, `DATABASE_URL` | Treat both as secrets: the connection URL contains the database password. Use a unique production password. |
| `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | Backend-only credentials scoped to the production media bucket. |
| `FACEBOOK_CLIENT_SECRET`, `TIKTOK_CLIENT_SECRET`, `GOOGLE_CLIENT_SECRET` | Store on the backend host only; use separate provider applications/credentials for development and production. |
| `TUNNEL_TOKEN` | Protect as a credential that authorizes a connector for your tunnel; rotate it if exposed. |
| `APP_ORIGIN`, `API_URL`, `MEDIA_URL`, provider client IDs | Public configuration, not authentication secrets. Never place a client secret beside these in frontend configuration. |

- Keep `.env` outside `app/public` and `landing/public`. It is Git-ignored, but Git ignore does not protect file copies, archives, backups, or CI artifacts. Never commit, upload, or include it in the distributable ZIP.
- Restrict the backend host's `.env` permissions with `chmod 600 .env`. Use your hosting platform's secret manager where available. The supplied Compose file uses environment variables; it does not integrate a secret vault or Docker secrets automatically. Restrict host, Docker, and CI access because administrators can inspect container environments.
- Use unique credentials for production, staging, and local development. Create your own production user with `python -m pxster.create_user`; do not import local demo accounts or reuse the supplied local login password.
- Enable MFA for Cloudflare, the Docker hosting account, source control, and platform developer accounts. Give operators only the access they need; avoid shared administrator accounts.
- Redact passwords, cookies, authorization headers, database URLs, OAuth codes, token responses, and signed media URLs from logs and error reports. Do not paste `docker compose config`, environment dumps, or debug traces into support tickets without reviewing them for secrets. Keep callback/media query strings out of Cloudflare log exports and other proxy logs too.

### Encryption and private storage

- Provider access and refresh tokens are encrypted with Fernet before database storage. Passwords use Argon2 hashing rather than reversible encryption. Login session tokens and OAuth state are stored as SHA-256 hashes.
- Token encryption does **not** encrypt captions, user emails, post history, or the entire database. Configure encrypted host/database volumes and encrypted backups with restricted access. Protect R2 credentials and keep the bucket private as described above; this app does not add client-side encryption to uploaded media.
- Public traffic uses HTTPS through Workers and Tunnel. The configured tunnel-to-API hop is `http://api:8000` on the local Docker network; the supplied local PostgreSQL connection is also not configured for TLS. If either hop moves across hosts or untrusted networks, configure TLS with certificate verification for that connection. Do not expose PostgreSQL or the API directly to the Internet.
- Signed `/media-delivery/*` URLs grant anyone holding the URL access to that asset until expiry (currently two hours). They intentionally work without a login so platforms can fetch media. Treat them as temporary bearer credentials, keep them out of analytics and logs, and never make the underlying R2 bucket public to simplify delivery.

### Authentication and authorization

- The API issues seven-day, host-only `pxster_session` cookies with `HttpOnly`, `SameSite=Lax`, and `Secure` in production. Sessions are checked against the database, and logout revokes the current session. Do not broaden the cookie to `.pxster.xyz` or move session tokens into browser local storage.
- Workspace data requires API authentication and owner checks; hiding the workspace UI is not the security boundary. Verify that unauthenticated API requests fail and one user's account cannot read or publish another user's content.
- Keep `APP_ORIGIN=https://app.pxster.xyz` exact. Credentialed CORS permits that origin, and state-changing requests must supply a matching `Origin` header. Do not replace these checks with wildcard origins or disable them to resolve a deployment issue. If moving domains, update the frontend configuration and its Content Security Policy as well.
- Configure shared Cloudflare rate limits for login and registration. The built-in IP limiter is per process and resets on restart. In production it trusts `CF-Connecting-IP`, so keep the API reachable only through the intended Cloudflare ingress; do not allow direct clients to supply that header to an exposed origin.
- `ALLOW_REGISTRATION=true` enables public account creation. Use `false` for a closed pilot and create users through the administrative CLI. Email verification, password reset, application MFA, and a user-facing “revoke all sessions” screen are not implemented. Plan those features and a verified account-recovery procedure before offering a broader service; Cloudflare administrator MFA does not add MFA to Pxster user accounts.
- OAuth state is single-use, bound to the initiating user and platform, and expires after ten minutes. Register exact HTTPS callback URLs with each provider and request only the permissions needed for publishing. Keep callback routes reachable without interactive edge challenges while preserving the API's session and state checks.
- Disconnecting removes Pxster's stored platform credentials; revoke the provider's application grant in the platform settings when full revocation is required. Webhook receivers are not currently implemented. Before adding them, implement each provider's signature verification and replay protection rather than exposing an unauthenticated publishing endpoint.
- Preserve the frontend `_headers` files when deploying Workers Static Assets: they set Content Security Policy, frame restrictions, and other browser protections. Recheck those headers if moving to another frontend host.

### Rotation, backups, and incident recovery

1. For an exposed credential, revoke or rotate it at its issuer, update the backend secret store, and recreate affected containers so both the API and worker receive the new value. Restarting an existing container alone does not load changed Compose environment variables. Changing the PostgreSQL `.env` password alone also does not change an existing database role password; coordinate the database change with `DATABASE_URL` and dependent services.
2. Do not simply replace `TOKEN_ENCRYPTION_KEY`: existing connected accounts will become unreadable. This version has no automatic key-rotation migration. Pause publishing, preserve a recoverable database/key backup, then use a reviewed re-encryption migration or require affected accounts to reconnect. API and worker must use the same key. Changing it also invalidates outstanding signed media URLs, so check in-flight deliveries before resuming.
3. If login sessions may be compromised, invalidate the affected `LoginSession` database records through a controlled administrative operation. Rotating the provider-token key does not revoke Pxster login sessions. Investigate the exposure and rotate provider grants or infrastructure credentials as appropriate.
4. Back up PostgreSQL, required R2 objects, and the matching encryption key. Encrypt backups and keep key access separate from database-backup access. Test a restore in an isolated environment with publishing workers disabled so restored scheduled posts cannot accidentally publish.
5. Maintain the host and container dependencies, restrict SSH/Docker access, and monitor failed logins, unexpected OAuth connections, publishing errors, and storage growth. Set retention rules deliberately so they do not delete assets still needed by scheduled posts.

### Security checks before launch

- Confirm production mode, demo mode disabled, private R2, no public API/database host ports, and HTTPS on all public addresses.
- Inspect the login response for `Secure`, `HttpOnly`, and `SameSite=Lax`; verify logout and expired sessions deny access to protected endpoints.
- With two test users, confirm each sees only their own media, connected accounts, posts, and history. Confirm a state-changing request with an unexpected origin is rejected.
- Check edge rate limiting and verify that API responses are not cached. Confirm callbacks and valid signed media fetches work without a browser challenge, while invalid or expired signatures fail.
- Review deployed static files, the distribution ZIP, logs, and backup access for secret exposure. Record who can rotate credentials and restore the service.

## Changing infrastructure later

The frontend only depends on `https://api.pxster.xyz`. Move the Docker services and database, connect a new tunnel, and update the tunnel route while retaining that hostname. For frontend host changes, keep the same public names and update DNS/custom-domain associations. For domain changes, also update CORS, frontend config, provider callback allowlists, and TikTok verified URL ownership.

## Official references

- [Workers Static Assets configuration](https://developers.cloudflare.com/workers/static-assets/binding/)
- [Workers custom domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)
- [R2 S3 compatibility](https://developers.cloudflare.com/r2/api/s3/)
- [Cloudflare Tunnel setup](https://developers.cloudflare.com/tunnel/get-started/)
