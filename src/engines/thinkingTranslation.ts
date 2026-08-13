import type { PersonaAdvancedSettings, ProviderProfile } from '../types/domain';
import type { AssistantReply, RequestAssistantReplyParams } from './chat-api/chatApiTypes';
import { requestAssistantReply } from './chatApi';
import type { AssistantRequestContext } from './request/requestContext';

export type ThinkingTranslationSection = {
  id: string;
  text: string;
};

export type ThinkingTranslationResult = Record<string, string>;

export type ThinkingTranslationRequestReply = (
  params: RequestAssistantReplyParams
) => Promise<AssistantReply>;

function extractJsonObjectText(text: string) {
  const trimmed = text.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) return trimmed;
  const fencedJson = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  if (fencedJson?.startsWith('{') && fencedJson.endsWith('}')) return fencedJson;
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  return firstBrace >= 0 && lastBrace > firstBrace
    ? trimmed.slice(firstBrace, lastBrace + 1)
    : trimmed;
}

export function buildThinkingTranslationRequestContext(
  sections: ThinkingTranslationSection[],
  targetLanguage: string
): AssistantRequestContext {
  return {
    memorySlots: { session: [], profile: [], pin: [] },
    attachmentSlots: { enabled: false, pending: [] },
    segments: [
      {
        kind: 'system',
        messages: [{
          role: 'system',
          content: [
            'You are a precise translation engine for a reasoning viewer.',
            `Translate every supplied section into ${targetLanguage}.`,
            'Preserve meaning, paragraph structure, code, URLs, identifiers, names, and uncertainty.',
            'Do not answer, summarize, explain, censor, or add new reasoning.',
            'Return JSON only: {"translations":[{"id":"source id","text":"translated text"}]}.'
          ].join('\n')
        }]
      },
      {
        kind: 'conversation',
        messages: [{
          role: 'user',
          content: JSON.stringify({ targetLanguage, sections })
        }]
      }
    ],
    tools: [],
    toolChoice: 'none'
  };
}

export function parseThinkingTranslationOutput(
  text: string,
  sections: ThinkingTranslationSection[]
): ThinkingTranslationResult {
  const expectedIds = new Set(sections.map((section) => section.id));
  if (expectedIds.size !== sections.length) {
    throw new Error('思考翻译的源段落标识重复。');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJsonObjectText(text));
  } catch {
    throw new Error('翻译结果格式不完整，请重试。');
  }
  const translations = (
    parsed
    && typeof parsed === 'object'
    && Array.isArray((parsed as { translations?: unknown }).translations)
  )
    ? (parsed as { translations: unknown[] }).translations
    : [];
  const result: ThinkingTranslationResult = {};

  translations.forEach((entry) => {
    if (!entry || typeof entry !== 'object') return;
    const id = typeof (entry as { id?: unknown }).id === 'string'
      ? (entry as { id: string }).id
      : '';
    const translatedText = typeof (entry as { text?: unknown }).text === 'string'
      ? (entry as { text: string }).text.trim()
      : '';
    if (expectedIds.has(id) && translatedText) result[id] = translatedText;
  });

  if (sections.some((section) => !result[section.id])) {
    throw new Error('翻译结果缺少部分思考内容，请重试。');
  }
  return result;
}

function buildTranslationAdvancedSettings(
  api: ProviderProfile,
  source: PersonaAdvancedSettings | undefined
): PersonaAdvancedSettings {
  return {
    providerId: api.id,
    modelOverride: api.model,
    temperature: '0.1',
    topP: '',
    maxTokens: '',
    thinkingBudget: '',
    contextMessageLimit: '',
    showThinking: false,
    streaming: false,
    customHeaders: source?.customHeaders ?? '',
    customBody: source?.customBody ?? '',
    regexRules: '',
    regexTriggers: '',
    snippets: []
  };
}

export async function requestThinkingTranslation(args: {
  api: ProviderProfile;
  advanced?: PersonaAdvancedSettings;
  sections: ThinkingTranslationSection[];
  targetLanguage: string;
  signal?: AbortSignal;
  requestReply?: ThinkingTranslationRequestReply;
}) {
  const sections = args.sections
    .map((section) => ({ id: section.id.trim(), text: section.text.trim() }))
    .filter((section) => section.id && section.text);
  if (sections.length === 0) return {};

  const reply = await (args.requestReply ?? requestAssistantReply)({
    api: args.api,
    context: buildThinkingTranslationRequestContext(sections, args.targetLanguage),
    advanced: buildTranslationAdvancedSettings(args.api, args.advanced),
    signal: args.signal
  });
  return parseThinkingTranslationOutput(reply.content, sections);
}
