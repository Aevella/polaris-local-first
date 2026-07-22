# Runtime And Provider

## Purpose

Runtime and provider code decides how model requests are configured, which capabilities are available, and how requests are transported.

## Owns

- Provider profiles and model capability metadata.
- Request capability decisions.
- Direct provider calls, relay routing, and native HTTP transport choices.
- Provider-specific cache controls, stable request-session identifiers, and normalized usage evidence.
- Runtime settings that affect model/tool availability.

## Does Not Own

- Chat message mutation.
- UI persistence as a durable source of truth.
- Official Polaris server defaults.
- Credential material in public source.

## Main Entrypoints

- `src/engines/provider-runtime/`
- `src/engines/request/`
- `src/engines/chat-api/`
- `src/stores/runtimeStore.ts`
- `src/stores/runtimeLocalDataPersistence.ts`
- provider settings UI under `src/ui/` and `src/app/`

## Data It Reads

- Runtime/provider LocalData rows.
- User-configured provider profiles and capability settings.
- Optional backend origin configuration.
- Native transport availability.

## Data It Writes

- Runtime provider/profile rows.
- Runtime projection state.
- Request capability and transport evidence used by chat.

## Important Failure States

- Provider profile is incomplete or lacks required credentials.
- Model capability is unavailable for the requested action.
- Relay/backend route is not configured or rejects the target.
- Native HTTP transport is unavailable and browser transport cannot satisfy the request.
- A browser network failure may retry through the configured relay; native provider calls do not cross that relay boundary.
- A provider omits cache usage fields, which is distinct from reporting a zero cache read.

## Tests And Verification

- `npm run test:data-boundary`
- runtime LocalData persistence tests.
- provider/runtime request tests under `src/engines/` and `src/app/chat/`.

## Known Cleanup Still Owed

- Keep old official-domain references as blocked, archival, or test-only facts until they can be removed or replaced with neutral sentinels.
