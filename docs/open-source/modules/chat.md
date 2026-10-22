# Chat

## Purpose

Chat runs conversation workflows with collaborators, model providers, context, and model-visible tools.

## Owns

- Conversation submit, stop, retry, save-only edit, full-turn deletion, fork, and continuation flows.
- Per-window provider/model, reasoning, history scope, image policy, return-key behavior, and MCP selection. Persona defaults are copied only when a window is created.
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
- `src/stores/chat/read.ts`
- `src/stores/chat/rowWrite.ts`

## Data It Reads

- Current chat catalog rows and conversation body rows.
- Runtime/provider state needed to build requests.
- Persona and collection references selected into context.
- Tool invocation and task state.

## Data It Writes

- Chat catalog rows, conversation body rows, active pointer state, and task projections.
- Tool call records and tool result evidence.
- Message edits and replacement slices through writable conversation bodies.
- Provider reasoning state retained with assistant messages, including on-demand translation presented as a separate derived view.
- Generated image and audio attachments projected from message and tool-result evidence.
- Explicit assistant reply boundaries persisted as sibling bubbles while request preparation reconstructs one provider assistant turn.
- Incomplete-reply checkpoints through the ordinary chat writer. Continuing an interrupted reply includes saved tool evidence and never replays side effects merely because their outcome is unknown.
- Window settings in catalog and typed SQLite metadata projections, including unloaded-directory reads.

## Important Failure States

- Conversation body is missing, unloaded, incomplete, timed out, or deleted.
- Provider request fails before or during streaming.
- Tool execution returns an explicit error or needs confirmation.
- A settled tool exchange is replayed twice or a pending invocation is projected as completed evidence.
- A historical lifecycle row stays out of live hydration instead of becoming an empty live conversation.
- A turn deletion removes only part of a user turn, or leaves pending proposals and task state pointing at removed messages.

## Tests And Verification

- `npm run test:data-boundary`
- `src/stores/storeHydrationFailure.test.ts`
- `src/app/chat/chatReplyRuntime.test.ts`
- `src/app/chat/chatToolActionRunner.test.ts`
- `src/app/chat/chatActions.test.ts`

## Known Cleanup Still Owed

- Conversation directory actions, writable body loading, runtime feedback, and persistence routing remain separate store owners.
- `src/app/chat/chatReplyRuntime.ts` still owns request/session orchestration, but continuation state, follow-up planning, tool evidence staging, task settlement, and runtime audit are separate owners.

## Related Intent

- [Memory and group chat intent](../memory-and-group-chat-intent.md)
