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
- `src/app/chat/chatAssistantActionResolver.ts`
- `src/app/chat/chatAssistantTargetResolution.ts`
- `src/app/chat/chatToolActionIngress.ts`
- `src/app/chat/chatToolExecutionContext.ts`
- `src/app/chat/chatToolActionRunner.ts`
- `src/app/chat/chatToolDirectActionExecutor.ts`
- `src/app/chat/chatToolEvidenceStage.ts`
- `src/stores/runtimeStoreToolbox.ts`

## Data It Reads

- Enabled tool groups and runtime capability settings.
- Current chat, collection, project, file, image, and desktop-local targets when the host surface provides them.
- Settled tool exchanges when assembling next-turn context.

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
- Request replay loses the last authoritative copy of a result while deduplicating paired tool calls and human-readable detail.

## Tests And Verification

- `npm run test:data-boundary`
- `src/app/chat/chatAssistantToolRuntime.test.ts`
- `src/app/chat/chatToolActionRunner.test.ts`
- `src/app/chat/chatToolDirectActionExecutor.test.ts`
- tool protocol parser tests under `src/engines/tool-protocol/`.

## Ownership Notes

- `chatAssistantToolRuntime.ts` is a compatibility-free barrel over focused ingress, target-resolution, card, workspace, and native-tool owners.
- Desktop, MCP, and proactive execution contexts are composed by `chatToolExecutionContext.ts` instead of being implemented in its main return object.
- Environment-directory execution is a separate context owner and preserves the same runtime, collaborator, collection, attachment, native-capability, and desktop-host facts.
- Follow-up planning uses settled exchange fingerprints. It does not inject domain-specific system choreography, and the same exchange cannot schedule itself twice.
