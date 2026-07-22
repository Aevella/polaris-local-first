# Server And Selfhost

## Purpose

Server and selfhost code provide optional deployer-owned API and relay capability.

## Owns

- Serverless `/api` route surfaces.
- Worker gateway example package.
- Shared relay-target validators and origin policy.
- Provider relay, diagnostics receiver, search/helper routes, and material sharing routes when implemented.

## Does Not Own

- Required default service for local/public use.
- Hidden Polaris-owned server dependency.
- Credential material in public source.
- Frontend product semantics.

## Main Entrypoints

- `api/`
- `server/`
- `workers/polaris-api/`
- `src/engines/server/`
- `docs/connect-your-own-backend.md`
- `docs/open-source/backend-and-selfhost-intent.md`

## Data It Reads

- Deployer environment variables.
- Request bodies sent to API routes.
- Allowed origin and relay-target configuration.

## Data It Writes

- Provider relay responses.
- Diagnostics events, if the deployer enables a receiver.
- Shared-material records only when the corresponding handlers are implemented.

## Important Failure States

- Backend origin is missing when a native or split-origin path requires one.
- Relay target is localhost, private-network, link-local, or otherwise rejected.
- CORS allows a caller that should not be trusted.
- Frontend references a handler that is planned but not implemented.

## Tests And Verification

- `npm run verify`
- server validator tests.
- Worker typecheck included by the verify gate.
- Manual selfhost route checks before advertising a handler as complete.

## Known Cleanup Still Owed

- `/api/provider-models`, `/api/material-shares`, and `/shared-materials/...` still need public handler completion before those surfaces are advertised as ready.
