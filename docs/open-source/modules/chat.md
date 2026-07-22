# Chat

## Purpose

Chat runs conversation workflows with collaborators, model providers, context, and model-visible tools.

## Owns

- Conversation submit, stop, retry, edit, fork, and continuation flows.
- Message timeline projection and body loading status.
- Request lifecycle coordination, streaming state, tool invocation lifecycle, and task settlement.
- Writable conversation-body intent before mutating messages.
- Explicit continuation state for tool exchanges, length recovery, preparation retry, and task activation.

## Does Not Own

- LocalData row schema definitions.
- Provider credential storage policy.
- Collection project storage.
- Native platform capability decisions.

## Main Entrypoints

- `src/ui/worlds/ChatWorld.tsx`
- `src/ui/worlds/chat/`
- `src/app/chat/`
- `src/app/group/`
- `src/stores/chatStore.ts`
- `src/stores/chatCurrentPersistence.ts`
- `src/stores/chatLocalDataPersistence.ts`

## Data It Reads

- Current chat catalog rows and conversation body rows.
- Runtime/provider state needed to build requests.
- Persona and collection references selected into context.
- Tool invocation and task state.

## Data It Writes

- Chat catalog rows, conversation body rows, active pointer state, and task projections.
- Tool call records and tool result evidence.
- Message edits and replacement slices through writable conversation bodies.

## Important Failure States

- Conversation body is missing, unloaded, incomplete, timed out, or deleted.
- Provider request fails before or during streaming.
- Tool execution returns an explicit error or needs confirmation.
- A settled tool exchange is replayed twice or a pending invocation is projected as completed evidence.
- A historical lifecycle row stays out of live hydration instead of becoming an empty live conversation.

## Tests And Verification

- `npm run test:data-boundary`
- `src/stores/storeHydrationFailure.test.ts`
- `src/app/chat/chatReplyRuntime.test.ts`
- `src/app/chat/chatToolActionRunner.test.ts`
- `src/app/chat/chatActions.test.ts`

## Known Cleanup Still Owed

- `src/stores/chatStore.ts` is still a large control room and should be split by conversation directory, body loading, task state, runtime feedback, and hydration/persistence adapter responsibilities.
- `src/app/chat/chatReplyRuntime.ts` still owns request/session orchestration, but continuation state, follow-up planning, tool evidence staging, task settlement, and runtime audit are separate owners.

## Related Intent

- [Memory and group chat intent](../memory-and-group-chat-intent.md)
