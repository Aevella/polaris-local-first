# Chat

## Purpose

Chat 运行和协作者、模型 provider、上下文、模型可见工具相关的对话工作流。

## Owns

- Conversation submit、stop、retry、edit、fork、continuation flows。
- Message timeline projection 和 body loading status。
- Request lifecycle、streaming state、tool invocation lifecycle、task settlement。
- 修改 messages 前的 writable conversation-body intent。
- Tool exchange、长度恢复、参数修复和任务激活的显式 continuation state。

## Does Not Own

- LocalData row schema definitions。
- Provider credential storage policy。
- Collection project storage。
- Native platform capability decisions。

## Main Entrypoints

- `src/ui/worlds/ChatWorld.tsx`
- `src/ui/worlds/chat/`
- `src/app/chat/`
- `src/app/group/`
- `src/stores/chatStore.ts`
- `src/stores/chatCurrentPersistence.ts`
- `src/stores/chatLocalDataPersistence.ts`

## Data It Reads

- 当前 chat catalog rows 和 conversation body rows。
- 构造请求需要的 runtime/provider state。
- 选入 context 的 persona 和 collection references。
- Tool invocation 和 task state。

## Data It Writes

- Chat catalog rows、conversation body rows、active pointer state、task projections。
- Tool call records 和 tool result evidence。
- 通过 writable conversation body 做 message edit 和 replacement slices。

## Important Failure States

- Conversation body missing、unloaded、incomplete、timed out 或 deleted。
- Provider request 在 streaming 前或 streaming 中失败。
- Tool execution 返回明确 error 或需要确认。
- 已落定 tool exchange 被重复回放，或 pending invocation 被投影成 completed evidence。
- 历史 lifecycle row 留在 live hydration 外，而不是变成空 live conversation。

## Verification

- `npm run test:data-boundary`
- `src/stores/storeHydrationFailure.test.ts`
- `src/app/chat/chatReplyRuntime.test.ts`
- `src/app/chat/chatToolActionRunner.test.ts`
- `src/app/chat/chatActions.test.ts`

## Known Cleanup

- `src/stores/chatStore.ts` 仍是大 control room，需要按 conversation directory、body loading、task state、runtime feedback、hydration/persistence adapter 拆。
- `src/app/chat/chatReplyRuntime.ts` 仍负责 request/session orchestration；continuation state、follow-up planning、tool evidence staging、task settlement 和 runtime audit 已由独立 owner 承担。

## Related

- [记忆与群聊意图实现对照](../memory-and-group-chat-intent.md)
