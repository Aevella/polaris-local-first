# Backend And Selfhost Intent

Polaris uses explicit backend ownership.

Backend routes are optional deployer-owned capabilities. A public fork can use same-origin `/api` routes, configure `VITE_POLARIS_API_ORIGIN`, or replace the API layer with its own implementation.

Same-origin means the deployment/runtime actually serves both the frontend and API handlers. `npm run dev` alone starts Vite for the frontend; it does not start a backend.

## What The Backend Is For

The backend can provide:

- provider relay fallback when browser or native direct transport receives no response
- built-in chat route for selected upstream providers
- embeddings relay
- image relay
- search helper
- client diagnostics receiver
- material sharing routes, once implemented
- worker-based gateway examples

Backend ownership is a deployment choice.

## Default Routing

The public default is:

- web builds resolve relative `/api` routes against the current origin
- native internal API routes require explicit `VITE_POLARIS_API_ORIGIN`
- Vite dev proxy exists only when `VITE_POLARIS_API_ORIGIN` is set
- backend origin selection is explicit

See [../connect-your-own-backend.md](../connect-your-own-backend.md) for the operational setup.

## Security Boundary

Provider relay endpoints forward requests. That makes them trust boundaries.

They should:

- allow only public HTTPS upstream targets
- reject localhost, private-network, and link-local upstreams
- keep runtime logs minimal and non-sensitive
- keep provider responses `no-store`
- require the deployer to configure allowed frontend origins when using split origins

Do not loosen CORS to `*` on routes that forward credentials or receive diagnostics.

## Known Missing Surface

The current repository references some backend capabilities that are not fully implemented as public handlers yet:

- `/api/provider-models`
- `/api/material-shares`
- `/shared-materials/...`

These should be implemented before those features are advertised as complete in a public release.

## Worker Package

`workers/polaris-api/` is a smaller Cloudflare Worker package. It currently demonstrates a chat gateway shape, not the full `/api/...` surface.

Treat it as an example or adapter base, not as proof that every frontend API route has a worker implementation.

## Node Selfhost Status

The `server/` path currently contains shared relay-target validators. It is part of the server/selfhost responsibility area, but it is not a complete standalone Node selfhost application. Public selfhost docs should describe concrete handlers in `api/`, the Worker package, and any future Node server separately.
