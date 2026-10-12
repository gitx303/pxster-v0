# Platform connection setup

All platforms use `https://api.pxster.xyz/oauth/<platform>/callback`. Set these exact URLs in the respective developer consoles. Credentials belong only in backend `.env`. Start the connection from the app while logged in; single-use OAuth state expires after ten minutes and is bound to that user.

## Facebook Pages

- Set `FACEBOOK_CLIENT_ID`, `FACEBOOK_CLIENT_SECRET`, and the Graph API version your Meta app supports in `FACEBOOK_GRAPH_VERSION` (initial configuration: `v23.0`).
- Callback: `https://api.pxster.xyz/oauth/facebook/callback`.
- Permissions: `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`.
- The callback exchanges the user token for a long-lived token, then obtains eligible Page tokens through `/me/accounts`. Every returned Page with `CREATE_CONTENT` task access is connected. Personal profiles are unsupported.
- Photo publishing uses `/{page-id}/photos`; video publishing uses `/{page-id}/videos`, then checks video processing status. Credentials/permission failures surface in the destination's attempts.
- Complete Meta's required app review, business verification, privacy/data-deletion URLs, and Live mode setup for your intended users. Reconnect when a Page token is revoked; no assumed permanent expiry guarantee is made.

References: [Pages posts](https://developers.facebook.com/docs/pages-api/posts/), [Page videos](https://developers.facebook.com/docs/graph-api/reference/page/videos/). Meta documentation returned rate-limit errors during scaffold verification; verify the configured version and Page video behavior with your app before release.

## TikTok Direct Post

- Enable Login Kit and Content Posting API / Direct Post in your TikTok app.
- `TIKTOK_CLIENT_ID` is the TikTok **client key**; also set `TIKTOK_CLIENT_SECRET`.
- Callback: `https://api.pxster.xyz/oauth/tiktok/callback`.
- Scopes: `user.info.basic`, `video.publish`.
- Verify ownership of `api.pxster.xyz` using TikTok's DNS TXT verification under the app's URL properties. This verifies the media-delivery path without adding a public verification-file route. The exact TXT value is account-specific and must come from your TikTok console.
- The composer loads creator info, requires a manually selected allowed privacy value, starts interaction checkboxes unchecked, handles disabled interactions, and captures commercial-content disclosure and consent. The API rechecks current creator limits before posting.
- Video publishing uses `PULL_FROM_URL`, since media has already been uploaded to Pxster/R2. The worker polls `publish/status/fetch` until TikTok reports completion.
- TikTok video validation additionally enforces 360–4096 pixels on both axes and 23–60 FPS, plus the creator's current duration limit.
- Unaudited clients are restricted to private posting and limited users. Public Direct Post requires TikTok's audit. Confirm product eligibility and the final UI against the current sharing guidelines. This scaffold is not an approval guarantee.

References: [Direct Post setup](https://developers.tiktok.com/docs/en/content-posting-api-get-started), [sharing guidelines](https://developers.tiktok.com/docs/en/content-sharing-guidelines), [token management](https://developers.tiktok.com/docs/en/oauth-user-access-token-management), [publish status](https://developers.tiktok.com/docs/en/content-posting-api-reference-get-video-status).

## YouTube

- Enable YouTube Data API v3 in a Google Cloud project, configure the OAuth consent screen, and create a Web application OAuth client.
- Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.
- Callback: `https://api.pxster.xyz/oauth/youtube/callback`.
- Scopes: `youtube.upload` and `youtube.readonly` (full Google scope URLs are in the adapter).
- Pxster requests offline access, encrypts the refresh token, resolves the signed-in channel, and uses a resumable upload session. Interrupted uploads with uncertain outcomes are flagged for review; chunk-resume recovery is not yet implemented.
- The composer requires title, explicit privacy, and made-for-kids selection. Processing status is checked before marking the destination published.
- Complete Google's OAuth verification and YouTube API compliance audit as applicable. Unverified API projects may have uploads restricted to private visibility; check the actual video on YouTube during launch testing.

References: [Web server OAuth](https://developers.google.com/identity/protocols/oauth2/web-server), [resumable video uploads](https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol), [videos.insert](https://developers.google.com/youtube/v3/docs/videos/insert).

## Webhooks

Publishing status polling is implemented; no webhook routes currently accept platform events. Add signature validation, replay protection, and idempotent event storage before enabling webhook delivery. The stable `api.pxster.xyz` hostname can host those routes later without changing the frontends.
