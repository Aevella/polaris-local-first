# Tools

## Purpose

Tools make model-visible actions reliable across prompt visibility, parsing, execution, UI evidence, and next-turn replay.

## Owns

- Tool schemas, prompt catalog visibility, and detailed tool rules.
- Parser and canonicalizer behavior.
- Direct action conversion and executor routing.
- Tool invocation records, summaries, and replay projection.
- Confirmation, preview, apply, and rollback semantics where a side effect needs them.

## Does Not Own

- Feature-specific layout.
- Provider credential policy.
- Hidden side effects outside the tool result record.
- Ad hoc keyword decisions that hide enabled tools from the model.

## Main Entrypoints

- `src/engines/tool-protocol/`
- `src/app/chat/chatAssistantToolRuntime.ts`
- `src/app/chat/chatToolActionRunner.ts`
- `src/app/chat/chatToolDirectActionExecutor.ts`
- `src/app/chat/chatToolEvidenceStage.ts`
- `src/stores/runtimeStoreToolbox.ts`

## Data It Reads

- Enabled tool groups and runtime capability settings.
- Current chat, collection, project, file, image, and desktop-local targets when the host surface provides them.
- Previous tool result evidence when deciding next-turn context.

## Data It Writes

- Tool invocation records.
- Tool result summaries and detailed evidence.
- Preview/apply/rollback transaction state.
- Feature-domain rows when a tool performs a confirmed write.

## Important Failure States

- Tool is disabled by user settings or unavailable in the current app state.
- Parser cannot canonicalize a model action into a supported command.
- Target object is missing, not writable, or outside the allowed boundary.
- Execution succeeds visually but does not leave replayable evidence; this is a protocol failure and must be fixed at the tool result layer.
- Request replay removes structured parameters, links, or result fields merely because a human-readable detail is also present.

## Tests And Verification

- `npm run test:data-boundary`
- `src/app/chat/chatAssistantToolRuntime.test.ts`
- `src/app/chat/chatToolActionRunner.test.ts`
- `src/app/chat/chatToolDirectActionExecutor.test.ts`
- tool protocol parser tests under `src/engines/tool-protocol/`.

## Known Cleanup Still Owed

- `src/app/chat/chatAssistantToolRuntime.ts` should be split into target resolution, tool-group availability, direct-action conversion, desktop-local access checks, and focused test fixtures.
