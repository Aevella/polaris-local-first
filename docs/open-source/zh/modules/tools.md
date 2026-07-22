# Tools

## Purpose

Tool protocol 让模型可见工具在 prompt、parser、executor、UI evidence 和下一轮 request replay 中保持可靠。

## Owns

- Tool schemas 和 prompt catalog visibility。
- Parser/canonicalizer behavior。
- Execution result semantics。
- Tool result evidence 和 replay projection。
- Tool visibility 与 user toggles/runtime capability 的一致性。

## Does Not Own

- Feature-specific layout。
- Unrelated provider limits。
- Hidden side effects。
- 用户已经关闭的工具组。

## Main Entrypoints

- `src/engines/tool-protocol/`
- `src/app/chat/chatAssistantToolRuntime.ts`
- `src/app/chat/chatAssistantActionResolver.ts`
- `src/app/chat/chatAssistantTargetResolution.ts`
- `src/app/chat/chatToolActionIngress.ts`
- `src/app/chat/chatToolExecutionContext.ts`
- Tool executor 与 Tool UI surfaces。

## Contract

一个工具只有在这条链闭合时才算完成：

- 模型能看见它
- 模型知道什么时候该用
- parser 能解析成正确 action
- executor 能执行真实动作
- UI 能显示发生了什么
- 下一轮 request 能回放必要证据
- 测试能证明链路没断

少一环都不是完整工具。

## Failure States

- Prompt 说有工具，但 native/runtime 不暴露。
- Native/runtime 有工具，但 prompt 没说明清楚。
- 执行成功只显示在 UI，不留下模型下一轮可用证据。
- 工具失败把 malformed payload 或 raw parser snippet 投进后续上下文。

## Ownership Notes

- `chatAssistantToolRuntime.ts` 只做出口聚合；ingress、目标解析、房间卡、工作区和 native tool 各自有明确 owner。
- desktop、MCP 和 proactive execution context 由 `chatToolExecutionContext.ts` 组合，不在主 return object 里重复实现。
- environment-directory execution 有独立 context owner，并继续使用同一组 runtime、协作者、收藏、附件、原生能力和 desktop-host 事实。
- follow-up 只依据已落定 exchange 的稳定指纹继续，不注入按领域编排的 system message，同一个 exchange 不能重复触发自己。
