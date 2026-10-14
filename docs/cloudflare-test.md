# API ownership moved

The Cloudflare test API, tests and migrations now live in `../social-media-tool-publisher/infrastructure/cloudflare/api/`. Its README owns backend operations. Deploy the frontend here with `cloudflare/app.wrangler.jsonc`; its public API address remains https://api.pxster.xyz. Local FastAPI is separate and has not been moved.
