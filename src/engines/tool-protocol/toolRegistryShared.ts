import type { AssistantRequestTool } from '../request/requestContext';
import type { AssistantToolContext } from './assistantToolProtocolTypes';
import { buildThemeToolRules } from './toolRegistryThemeRules';

export type ToolPromptContext = AssistantToolContext;

export type PolarisRegistryToolGroup =
  | 'environment'
  | 'card'
  | 'cross-boundary'
  | 'project'
  | 'desktop'
  | 'mcp'
  | 'task'
  | 'theme-stable'
  | 'theme-creative'
  | 'attachment'
  | 'generation'
  | 'archive'
  | 'web'
  | 'personalData'
  | 'memory'
  | 'memoryRecall'
  | 'knowledge'
  | 'memoryWrite'
  | 'proactive';

export type PolarisToolResultReplayMode =
  | 'full-detail'
  | 'detail-excerpt';

type ToolSchema = AssistantRequestTool['function'];

export type PolarisToolDefinition<TName extends string = string> = {
  name: TName;
  group: PolarisRegistryToolGroup;
  resultReplayMode?: PolarisToolResultReplayMode;
  label?: string;
  brief: string;
  schema: ToolSchema;
  exposeAsNative?: boolean;
  rules?: string[];
  buildRules?: (context?: ToolPromptContext) => string[];
};

export const objectParameters = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: 'object',
  additionalProperties: false,
  properties,
  ...(required.length ? { required } : {})
});

export const stringProperty = (description: string, extra: Record<string, unknown> = {}) => ({
  type: 'string',
  description,
  ...extra
});

export const numberProperty = (description: string) => ({ type: 'number', description });
export const booleanProperty = (description: string) => ({ type: 'boolean', description });

export const stringArrayProperty = (description: string, extra: Record<string, unknown> = {}) => ({
  type: 'array',
  items: { type: 'string' },
  description,
  ...extra
});

export const buildThemeSharedRules = (context?: ToolPromptContext) =>
  buildThemeToolRules(context).map((line) => line.trimEnd());
