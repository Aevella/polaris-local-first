import type { AssistantToolPreparationOutcome } from './chatToolOutcome';
import { describeToolArguments, diagnosticToolName, normalizeToolPreparationDiagnostic } from '../../engines/toolPreparationDiagnostics';
import { extractAssistantToolFenceBlocks } from '../../engines/tool-protocol/assistantToolProtocolFence';
import { reportToolPreparationDiagnostics } from '../bootstrap/clientDiagnosticsReporter';

export function reportChatToolPreparation(outcome: AssistantToolPreparationOutcome, attemptId: string, retryDepth: number, lengthRecoveryDepth: number) {
  try {
    const reply = outcome.reply;
    const calls = (reply.nativeToolCalls ?? []).map(call => {
      let payload: unknown; let jsonValid = false;
      try { payload = JSON.parse(call.argumentsText); jsonValid = true; } catch { /* Keep only length for malformed JSON. */ }
      return { tool: diagnosticToolName(call.name), source: 'native', argumentLength: call.argumentsText.length, jsonValid, ...describeToolArguments(payload) };
    });
    for (const block of extractAssistantToolFenceBlocks(reply.content).blocks) {
      try {
        const payload = JSON.parse(block.body);
        const items = Array.isArray(payload) ? payload : Array.isArray(payload?.actions) ? payload.actions : [payload];
        for (const item of items) calls.push({ tool: diagnosticToolName(item?.kind), source: 'text', argumentLength: block.body.length, jsonValid: true, ...describeToolArguments(item) });
      } catch { calls.push({ tool: 'unknown', source: 'text', argumentLength: block.body.length, jsonValid: false, fields: [], unknownFieldCount: 0 }); }
    }
    const diagnostic = normalizeToolPreparationDiagnostic({
      attemptId, retryDepth, lengthRecoveryDepth, status: outcome.status,
      finishReason: reply.finishReason, transportIncomplete: reply.transportIncomplete,
      truncated: outcome.status !== 'ready' && outcome.truncated,
      issueCount: outcome.parsed.issues.length,
      missingCardCode: outcome.parsed.issues.includes('新建卡片时缺少 code 内容。'),
      visibleLength: reply.content.length, calls
    });
    if (diagnostic) void reportToolPreparationDiagnostics(diagnostic);
  } catch { /* Diagnostics must not change tool execution or retries. */ }
}
