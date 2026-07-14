# Tool action descriptions

`describeToolAction(action)` turns a `ToolAction` into a `ToolActionDescription` — the
natural-language title/summary (and a little preview metadata) shown when the assistant proposes a
tool action. It lived in one ~950-line switch in `src/engines/toolExecutorDescribe.ts`. The split
keeps that function as the **central dispatcher** and moves each capability domain's descriptions
into a focused `toolExecutorDescribe<Domain>.ts` module.

## The dispatcher pattern

- `toolExecutorDescribe.ts` keeps the public contract — `describeToolAction`,
  `isPreviewableToolAction`, `getToolActionVariables`, and the `ToolActionDescription` type — and
  the big `switch (action.kind)`.
- For an extracted domain, the dispatcher's cases for that domain's kinds collapse to a single
  delegating return, e.g.:
  ```ts
  case 'writeMemory':
  case 'writeMemoryDoc':
  case 'readMemoryDoc':
  case 'searchMemory':
  case 'openMemorySource':
    return describeMemoryToolAction(action);
  ```
  TypeScript narrows `action` to the domain's `Extract<ToolAction, …>` union at that point, so the
  domain describer is fully typed.
- Each domain module imports `ToolActionDescription` **type-only** from `toolExecutorDescribe.ts`.
  The dispatcher imports the describer as a value. That import edge is a type-only cycle, which is
  erased at runtime — no runtime cycle, and `tsc` accepts it. (If a domain ever needed a runtime
  symbol from the dispatcher, `ToolActionDescription` would move to a small types module instead.)

## Extracted domains

| Module | Action kinds |
|---|---|
| `toolExecutorDescribeMemory.ts` | `writeMemory`, `writeMemoryDoc`, `readMemoryDoc`, `searchMemory`, `openMemorySource` |
| `toolExecutorDescribeProactiveMessage.ts` | `createProactiveMessageRule`, `listProactiveMessageRules`, `updateProactiveMessageRule`, `deleteProactiveMessageRule` |
| `toolExecutorDescribeTask.ts` | `startTask`, `completeTask`, `wait` |
| `toolExecutorDescribeToolInvocation.ts` | `invokeCodeCardTool`, `invokeMcpTool` |
| `toolExecutorDescribeDesktop.ts` | the 18 `*Desktop*` kinds: file read/edit, directory/path ops, command/terminal sessions, workspace disk sync |
| `toolExecutorDescribeKnowledgeEnvironment.ts` | `readPolarisKnowledge`, `listEnvironmentNodes`, `inspectEnvironmentNode`, `searchEnvironmentNodes` |
| `toolExecutorDescribeAttachments.ts` | attachment / web / calendar / image / archive kinds + `runCode` (23 kinds) |
| `toolExecutorDescribeWorkspace.ts` | the 30 workspace / room-project / code-card / project-file kinds (incl. `switchWorld`); owns the `summarizeCodeCardPatch` helper |
| `toolExecutorDescribeThemeCss.ts` | the 11 theme/CSS kinds (`applyThemeCoordinates`, `applySurfaceTokens`, `patchRawCss`, the `*ThemeCss` edits, `applyPreset`, `inspectThemeRender`); owns `inferStableThemeScope` / `splitCssSelectorList` / `summarizeRawCssThemeTargets` |

**All domains are extracted.** `toolExecutorDescribe.ts` is now a 174-line pure dispatcher:
`describeToolAction` delegates every kind, plus `isPreviewableToolAction`, `getToolActionVariables`,
the `ToolActionDescription` type, and `assertNever`. The `theme-css` slice was done last and most
carefully because its return value carries the skin **preview metadata**; it was moved verbatim and
is guarded by the 12 theme-metadata assertions in `toolExecutorDescribe.test.ts` (8) and
`requestContextMessages.test.ts` (4). The real CSS / theme apply / preview / rollback paths were
never touched.

## Rules followed for each extraction

1. One domain per commit; move only that domain's cases and any helper it exclusively owns.
2. `describeToolAction` stays the dispatcher with full `assertNever` coverage.
3. Case bodies moved **verbatim** — relocation, not a wording change.
4. Each slice ran `npm run typecheck`, `npm test`, and `npm run build`.
