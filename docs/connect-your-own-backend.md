# Connect Your Own Backend

Polaris uses explicit backend ownership. A build should either use same-origin `/api` routes or an explicitly configured backend that the deployer owns.

This document explains how to connect a local or self-hosted backend.

## The Short Version

For frontend-only web development:

```bash
npm i
npm run dev
```

This starts Vite. It does not start a backend, and it does not make same-origin `/api` handlers available by itself.

If your backend runs on another origin, configure it explicitly:

```bash
cp .env.example .env.local
```

Then set:

```bash
VITE_POLARIS_API_ORIGIN=https://your-backend.example.com
```

Set this to your selfhost, preview backend, local tunnel, or relay.

For true same-origin `/api` behavior, deploy or run a runtime that serves both the frontend and the handlers in `api/`. Vite can proxy to that runtime during development when `VITE_POLARIS_API_ORIGIN` is set.

## What The Frontend Expects

Relative internal routes such as `/api/provider-relay` are resolved by `src/engines/chat-api/chatApiEndpoint.ts`.

- Web builds use the current browser origin for relative `/api` routes.
- Web builds with no browser origin keep routes relative, for example `/api/health`.
- Native builds require `VITE_POLARIS_API_ORIGIN` for internal `/api` routes.
- Desktop host builds require an explicit API origin at build time; the `polaris://app` bundle URL is only a file/app shell, not an API origin.
- Vite dev proxy only exists when `VITE_POLARIS_API_ORIGIN` is set.

Backend origin selection is explicit so the frontend does not silently send API requests to an unrelated server.

## Backend Shapes

### Same-Origin Serverless API

The `api/` directory contains Vercel-style handlers. These are the closest match for frontend `/api/...` calls:

| Route | Purpose | Notes |
| --- | --- | --- |
| `/api/chat/completions` | Optional built-in/free chat route | Requires upstream provider keys such as `POLARIS_FREE_UPSTREAM_API_KEY`, `OPENROUTER_API_KEY`, `MIMO_API_KEY`, or `SILICONFLOW_API_KEY` depending on model route. |
| `/api/provider-relay` | Text/chat provider relay | Fallback when browser or native direct transport receives no response. Requires the client to send upstream auth headers; validates public HTTPS upstream targets. |
| `/api/provider-models` | Provider model-list relay | Referenced by the frontend, but this repository does not currently include a matching `api/provider-models.ts` handler. Add one before relying on model discovery through relay. |
| `/api/provider-embeddings` | Embedding relay | Used by cross-chat vector search when browser direct calls need relay. |
| `/api/provider-images` | Image generation relay | Used by configured image generation providers when relay is needed. |
| `/api/provider-audio` | Voice/audio relay | Streams configured speech-provider responses after validating public HTTPS targets and request authentication. |
| `/api/search` | Web search and webpage read helper | Uses Brave when configured, otherwise can degrade through Bing HTML behavior. |
| `/api/client-diagnostics` | Privacy-safe client diagnostics receiver | Logs normalized diagnostics, not raw chat content. |
| `/api/material-shares` and `/shared-materials/...` | Shared image/material upload and readback | Referenced by collection image sharing/import; this repository does not currently include the server handlers. Add them before enabling public material sharing. |

The remaining missing handler rows mark routes that need implementation before use.

### Node Selfhost Status

The current `server/` directory contains shared relay-target validators used by API surfaces. It is a responsibility area, not a complete standalone Node selfhost application. The `selfhost:*` scripts are kept for the release-channel server build shape, but public readers should treat the Vercel-style `api/` handlers and the Worker package below as the concrete backend surfaces currently present here.

### Cloudflare Worker Example

`workers/polaris-api/` is a smaller Cloudflare Worker package. It is not a full replacement for the `/api/...` surface above.

Current Worker shape:

- `GET /health`
- `POST /v1/chat/completions`
- KV-backed rate limiting through `RATE_LIMIT`
- Provider secrets through Worker secrets such as `MIMO_API_KEY` and `SILICONFLOW_API_KEY`

Use it as an example built-in model gateway, or adapt it behind your own `/api/chat/completions` route. Do not assume it already implements provider relay, embeddings, image relay, search, diagnostics, companion, or shared materials.

## CORS And Origins

The easiest public deployment is same-origin: serve the frontend and `/api` routes from the same origin.

If you split frontend and backend origins, update the backend CORS policy. The current serverless handlers call `isAllowedPolarisApiOrigin()` from `src/engines/server/corsOrigin.ts`, which allows local development, native app origins, Vercel preview origins, and configured Polaris domain patterns. A deployment with its own domain should either:

- deploy same-origin, or
- add its frontend origin pattern to `src/engines/server/corsOrigin.ts`, with tests in `src/engines/server/corsOrigin.test.ts`.

Do not loosen CORS to `*` for routes that forward provider keys or receive diagnostics.

## Provider Relay Security

Provider relay routes are request forwarders. They should not become arbitrary network fetchers.

Keep these rules:

- Only allow public HTTPS upstream targets.
- Reject localhost, private-network, and link-local upstreams.
- Require upstream auth headers when the upstream provider needs them.
- Do not log provider API keys, raw prompts, raw chat content, or full request bodies.
- Keep `Cache-Control: no-store` on provider responses.

The target validators live in:

- `server/providerRelayTarget.ts`
- `server/providerEmbeddingRelayTarget.ts`
- `server/providerImageRelayTarget.ts`

## Environment Variables

Frontend:

```bash
VITE_POLARIS_API_ORIGIN=https://your-backend.example.com
```

Serverless built-in chat route:

```bash
POLARIS_FREE_UPSTREAM_API_KEY=
OPENROUTER_API_KEY=
OPENROUTER_KEY=
OPENROUTER_HTTP_REFERER=
OPENROUTER_X_TITLE=
MIMO_API_KEY=
SILICONFLOW_API_KEY=
POLARIS_FREE_UPSTREAM_BASE_URL=
POLARIS_FREE_UPSTREAM_PATH=
POLARIS_CHAT_DAILY_LIMIT=
```

Search:

```bash
BRAVE_SEARCH_API_KEY=
```

Cloudflare Worker:

```bash
wrangler secret put MIMO_API_KEY
wrangler secret put SILICONFLOW_API_KEY
```

Create and bind `RATE_LIMIT` before deploying the Worker. The Worker also reads `DAILY_LIMIT` and `DEFAULT_MODEL` from `workers/polaris-api/wrangler.toml`.

## Local Smoke Checks

After configuring your backend, run:

```bash
npm run typecheck
npm run test:data-boundary
npm test
npm run build
```

For a separate backend origin, also smoke-check:

```bash
curl -i "$VITE_POLARIS_API_ORIGIN/api/client-diagnostics"
curl -i "$VITE_POLARIS_API_ORIGIN/api/provider-relay"
```

Those GET requests may return `405 Method not allowed`; that still proves DNS/TLS/routing reached the handler. A CORS failure in the browser means the backend origin policy still needs alignment.

## What This Does Not Mean

- It does not make this repo a live-user release channel.
- It does not make the old official Polaris server part of the public default.
- It does not guarantee the backend surface is complete; missing handlers above must be implemented before those features are advertised.
