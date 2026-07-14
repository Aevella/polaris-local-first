# Tool Contract Intent

Tools let the model act inside Polaris. A tool is a model-visible contract: the
model can see that an action exists, call it with structured arguments, receive a
clear result, and rely on that result in a later turn.

The product goal is to make actions feel accountable. When the model changes a
theme, creates a card, reads a project file, searches memory, or calls an MCP
server, the user should see what happened and the next request should carry the
right evidence forward.

## Product Principles

### Visibility and execution share one contract

Tool schemas, prompt guidance, parser behavior, action routing, and executor
results all describe the same capability. A visible tool should be executable,
and an executed tool should leave understandable evidence.

Implementation evidence:

- `src/engines/tool-protocol/`
- `src/app/chat/chatAssistantToolRuntime.ts`
- `src/app/chat/chatToolActionRunner.ts`
- `src/app/chat/chatToolDirectActionExecutor.ts`
- `src/engines/toolExecutor.ts`

### Tool results become product evidence

Tool output is recorded as invocation state, message UI, and next-turn request
context. The model and user both get a stable description of the result.

Implementation evidence:

- `src/app/chat/chatToolEvidenceStage.ts`
- `src/app/chat/chatToolCallRecords.ts`
- `src/engines/toolLedger.ts`
- `src/engines/request/requestToolResultProjection.ts`
- `src/ui/worlds/chat/message/MessageToolEvent.tsx`

### Side effects have product shape

Write tools land in feature domains such as theme, collection, project files,
attachments, memory, or runtime settings. Preview/apply/rollback flows are used
where a visible user confirmation is part of the action.

Implementation evidence:

- `src/app/chat/chatToolPreviewController.ts`
- `src/app/theme/themePreviewTransaction.ts`
- `src/engines/toolExecutorThemePlugin.ts`
- `src/engines/toolExecutorCollectionCodeCards.ts`
- `src/engines/toolExecutorCollectionRoomProjects.ts`

### External facts stay inspectable

Tools expose stable external identifiers instead of making decisions from display names or
provider/model word lists. System-calendar tools list writable calendars with `calendarId` and
source metadata before an explicit target is chosen. Provider image capability comes from the
configured route; transport adapters format that capability but do not silently replace it from a
model-name allowlist.

## Adjacent Responsibilities

- Feature domains own their durable rows and visual presentation.
- Context governance owns how completed tool results appear in later requests.
- Runtime settings own which tool groups are enabled.
- Provider runtime owns transport-specific formatting of tool calls.
