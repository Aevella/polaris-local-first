# Layout Surfaces

## Purpose

Layout surfaces decide how the shared Polaris runtime is arranged on screen. They are not release channels, native platforms, or separate product implementations.

## Owns

- Phone, tablet, and desktop layout selection.
- Sidebar availability and auto-collapse behavior.
- Top-level shell arrangement for shared product worlds.
- Public explanation of how viewport layout differs from native platform capability.

## Does Not Own

- iOS, Android, or desktop bridge permissions.
- Chat, collection, persona, or provider behavior.
- Release-channel status.
- Theme geometry or keyboard viewport ownership.

## Main Entrypoints

- `src/app/shell/appLayoutSurface.ts`
- `src/ui/app-shell/useAppLayoutSurface.ts`
- `src/app/bootstrap/appLayoutSurfaceBootstrap.ts`
- `src/ui/AppShell.tsx`
- `docs/layout-contract.md`

## Surface Map

| Surface | Meaning | Typical Host |
| --- | --- | --- |
| `phone` | Narrow single-column arrangement | phones, narrow browser windows |
| `tablet` | Wider shared runtime layout without desktop-local privilege by itself | iPad, Android tablets, wide browser windows |
| `desktop` | Wide shared runtime layout selected by explicit shell/bootstrap facts | desktop shell or explicit desktop layout testing |

An iPad build is iOS native bridge plus `tablet` layout surface. A Mac host build is desktop host capability plus whatever layout surface the shell selects. These are separate axes.

Native iOS keeps compact widths on the phone surface. Tablet layout is selected only for a wide landscape viewport, and viewport variables use the measured window rather than a historical screen-height floor.

## Important Failure States

- Treating `iPad` as a second product instead of `iOS capability + tablet layout`.
- Treating `desktop` layout as proof that local privileged desktop tools are available.
- Adding layout branches based on release channel instead of measured layout surface.
- Letting theme, keyboard, or viewport code take ownership away from the layout contract.

## Tests And Verification

- Unit tests around layout surface resolution and shell hooks when behavior changes.
- Manual viewport checks for phone, tablet, and desktop-sized windows.
- Native checks only when the behavior crosses an actual platform bridge boundary.
