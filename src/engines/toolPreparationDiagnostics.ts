// Fixed diagnostic vocabulary, not tool availability or execution policy.
const diagnosticTools = ['createCodeCard', 'patchCodeCard', 'appendCodeCard', 'editCodeCardText', 'createProjectFile', 'writeProjectFiles', 'appendProjectFile', 'insertProjectFile', 'replaceProjectFileLines', 'editProjectFileText', 'runCode'];

export const TOOL_DIAGNOSTIC_FIELDS = ['kind', 'title', 'language', 'code', 'content', 'html', 'card', 'patch', 'arguments', 'parameters', 'tags', 'cardNote', 'cardFaceCss'] as const;
const statuses = ['ready', 'parse_failed', 'resolution_failed', 'missing_actions'] as const;
const endings = ['stop', 'length', 'tool_calls', 'tool_use', 'end_turn', 'max_tokens', 'content_filter', 'stop_sequence'] as const;
type FieldShape = { field: string; type: string; length?: number; children?: FieldShape[] };
export type ToolPreparationDiagnostic = {
  attemptId: string;
  retryDepth: number;
  lengthRecoveryDepth: number;
  status: typeof statuses[number];
  finishReason: string;
  transportIncomplete: boolean;
  truncated: boolean;
  issueCount: number;
  missingCardCode: boolean;
  visibleLength: number;
  calls: { tool: string; source: 'native' | 'text'; argumentLength: number; jsonValid: boolean; unknownFieldCount: number; fields: FieldShape[] }[];
};
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const count = (v: unknown) => typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.round(v)) : 0;
export function diagnosticToolName(value: unknown): string {
  return typeof value === 'string' && diagnosticTools.includes(value) ? value : 'unknown';
}
export function describeToolArguments(value: unknown, depth = 0): { fields: FieldShape[]; unknownFieldCount: number } {
  if (!record(value)) return { fields: [], unknownFieldCount: 0 };
  let unknownFieldCount = Object.keys(value).filter(k => !(TOOL_DIAGNOSTIC_FIELDS as readonly string[]).includes(k)).length;
  const fields: FieldShape[] = [];
  for (const field of TOOL_DIAGNOSTIC_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(value, field)) continue;
    const item = value[field];
    const type = item === null ? 'null' : Array.isArray(item) ? 'array' : typeof item;
    const nested = depth < 2 && record(item) ? describeToolArguments(item, depth + 1) : undefined;
    unknownFieldCount += nested?.unknownFieldCount ?? 0;
    fields.push({ field, type, ...(typeof item === 'string' || Array.isArray(item) ? { length: item.length } : {}), ...(nested ? { children: nested.fields } : {}) });
  }
  return { fields, unknownFieldCount };
}
function normalizeFields(value: unknown, depth = 0): FieldShape[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, TOOL_DIAGNOSTIC_FIELDS.length).flatMap(item => {
    if (!record(item) || !(TOOL_DIAGNOSTIC_FIELDS as readonly unknown[]).includes(item.field)) return [];
    const type = ['string', 'number', 'boolean', 'object', 'array', 'null', 'undefined'].includes(String(item.type)) ? String(item.type) : 'unknown';
    return [{ field: String(item.field), type, ...(typeof item.length === 'number' ? { length: count(item.length) } : {}), ...(depth < 2 && Array.isArray(item.children) ? { children: normalizeFields(item.children, depth + 1) } : {}) }];
  });
}
// Server trust boundary: never copy arbitrary names, strings, values or parser errors.
export function normalizeToolPreparationDiagnostic(value: unknown): ToolPreparationDiagnostic | undefined {
  if (!record(value) || !(statuses as readonly unknown[]).includes(value.status)) return undefined;
  if (typeof value.attemptId !== 'string' || !/^tool-diag-[0-9a-f-]{36}$/i.test(value.attemptId)) return undefined;
  return {
    attemptId: value.attemptId, retryDepth: count(value.retryDepth), lengthRecoveryDepth: count(value.lengthRecoveryDepth),
    status: value.status as ToolPreparationDiagnostic['status'],
    finishReason: (endings as readonly unknown[]).includes(value.finishReason) ? String(value.finishReason) : 'unknown',
    transportIncomplete: value.transportIncomplete === true, truncated: value.truncated === true,
    issueCount: count(value.issueCount), missingCardCode: value.missingCardCode === true, visibleLength: count(value.visibleLength),
    calls: Array.isArray(value.calls) ? value.calls.slice(0, 64).flatMap(call => record(call) ? [{
      tool: diagnosticToolName(call.tool), source: call.source === 'native' ? 'native' as const : 'text' as const,
      argumentLength: count(call.argumentLength), jsonValid: call.jsonValid === true,
      unknownFieldCount: count(call.unknownFieldCount), fields: normalizeFields(call.fields)
    }] : []) : []
  };
}
