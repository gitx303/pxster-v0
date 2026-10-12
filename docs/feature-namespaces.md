# Reserved security feature namespaces

The machine-readable registry is `backend/pxster/features/namespaces.json`. It reserves Python modules, API operations, future table names, and dashboard hash-route names for revisions, approvals, notifications, passkeys, audit events, receipts, reports, and provider webhooks.

## Current behavior

- Authenticated placeholders under `/api/v1` return HTTP 501 with `feature_not_implemented`. They never approve, sign, send, or publish anything. Unauthenticated callers receive 401; existing origin checks still apply to mutations.
- `/config` reports all reserved features as `enabled: false`. No setting can activate an unimplemented feature.
- Webhook and passkey sign-in paths are recorded but deliberately not mounted: they need provider verification or a real WebAuthn implementation before exposure.
- The existing API remains operational. **This scaffold does not add an approval requirement to the existing publishing worker. Do not describe approvals as active or use the reservations as a live publishing safety control.**
- Table names are reserved by the registry and collision tests, not by creating empty database tables. No data migration is needed until concrete models and constraints are implemented.
- Namespaces are repository conventions, not an exclusive reservation across Cloudflare, GitHub, or third-party providers. They do not reserve DNS names or new accounts.

## Ownership and activation rules

Keep existing `posts`, `post_destinations`, `connected_accounts`, `media_assets`, `publish_attempts`, `users`, and `login_sessions`; do not create duplicate scheduling or identity tables. Add immutable revisions and decision records around those entities.

When implementing a feature, replace its placeholder routes, update the registry status and capability reporting, and add migrations and authorization tests in the same change. Any table claim must explicitly identify its owning feature. New routes must not conflict with registered method/path pairs or their parameterized equivalents. Do not reuse a reserved operation ID or dashboard route for another feature.

Approval activation requires media-byte digests, exact destination and option snapshots, explicit revision-bound decisions, expiration/revocation, and a final atomic dispatch check. Editing or rescheduling invalidates approval. Migrate existing pending posts into a hold state. Define the dispatch cutoff and test concurrent approval, revocation, edits, and retry behavior against PostgreSQL before launch.

Notifications require a transactional outbox, delivery deduplication, verified contact/permission handling, and links that require login and never approve through GET. The preview at `/notification-preview` uses sample data only and sends nothing.

Passkeys require real challenge verification, RP ID/origin validation, expiry, replay prevention, and step-up evidence. Never label ordinary session approval as passkey verification.

Receipts require a separate signing key, key identifiers and verification tooling. Do not reuse the provider-token encryption key. Audit tables alone are not tamper-proof; scope database permissions and external archival controls before making immutability claims. Distinguish provider publication results from public visibility verification.

Reports require platform-specific permissions and timestamped metrics. Webhooks require signatures, replay protection, and idempotent event handling. These integrations are not activated by the namespace reservation.
