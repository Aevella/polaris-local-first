import { describe, it, expect, vi } from 'vitest';
import { reportChatToolPreparation } from './chatToolPreparationDiagnostics';
import type { AssistantToolPreparationOutcome } from './chatToolOutcome';
const report = vi.hoisted(() => vi.fn());
vi.mock('../bootstrap/clientDiagnosticsReporter', () => ({ reportToolPreparationDiagnostics: report }));
const attemptId = 'tool-diag-12345678-1234-1234-1234-123456789abc';
function failure(argumentsText: string): AssistantToolPreparationOutcome {
  return { status: 'parse_failed', message: 'private error', reply: { content: 'private prose', nativeToolCalls: [{ id: 'private-id', name: 'createCodeCard', argumentsText }], finishReason: 'length' }, parsed: { actions: [], issues: ['新建卡片时缺少 code 内容。'], displayContent: '' }, resolvedActions: [], truncated: true } as AssistantToolPreparationOutcome;
}
describe('reportChatToolPreparation', () => {
  it('reports malformed JSON length without fragments and retains failed retry status', () => {
    report.mockClear();
    reportChatToolPreparation(failure('{"code":"SECRET'), attemptId, 1, 0);
    expect(report).toHaveBeenCalledWith(expect.objectContaining({ status: 'parse_failed', retryDepth: 1, finishReason: 'length', missingCardCode: true,
      calls: [expect.objectContaining({ tool: 'createCodeCard', jsonValid: false, argumentLength: 15, fields: [] })] }));
    expect(JSON.stringify(report.mock.calls)).not.toMatch(/SECRET|private/);
  });
  it('extracts text tool structure and never lets reporting throw into chat', () => {
    report.mockClear();
    const outcome = failure('{}');
    outcome.reply.nativeToolCalls = [];
    outcome.reply.content = '```polaris-tools {"actions":[{"kind":"createCodeCard","card":{"code":"SECRET"}}]}```';
    reportChatToolPreparation(outcome, attemptId, 0, 0);
    expect(report.mock.calls[0][0].calls[0]).toMatchObject({ source: 'text', tool: 'createCodeCard', jsonValid: true });
    expect(JSON.stringify(report.mock.calls)).not.toContain('SECRET');
    report.mockImplementationOnce(() => { throw new Error('offline'); });
    expect(() => reportChatToolPreparation(outcome, attemptId, 0, 0)).not.toThrow();
  });
});
