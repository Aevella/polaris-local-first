import { normalizeConversationWindowPreferences } from './conversationWindowSettings';
import type { ChatMessage, ConversationRequestContext, ConversationWindowDefaults, Persona } from '../types/domain';
import { normalizeConversationReasoningStrength } from './conversationReasoning';

/** External persisted-data boundary. Numeric values belong to older backups only. */
export function normalizeConversationRequestContext(value: unknown, legacyLimit?: unknown): ConversationRequestContext {
  if (value && typeof value === 'object') {
    const context = value as Record<string, unknown>;
    if (context.mode === 'inherit' || context.mode === 'all') return { mode: context.mode };
    if (context.mode === 'fromMessage') return { mode: 'fromMessage', anchorMessageId: typeof context.anchorMessageId === 'string' && context.anchorMessageId.trim() ? context.anchorMessageId : null };
    if (context.mode === 'recent' && typeof context.messageCount === 'number'
      && Number.isSafeInteger(context.messageCount) && context.messageCount > 0) {
      return { mode: 'recent', messageCount: context.messageCount };
    }
    return { mode: 'inherit' };
  }
  if (typeof legacyLimit === 'number' && Number.isSafeInteger(legacyLimit) && legacyLimit >= 0) {
    return legacyLimit === 0 ? { mode: 'all' } : { mode: 'recent', messageCount: legacyLimit };
  }
  return { mode: 'inherit' };
}

export function normalizeConversationWindowDefaults(value: unknown): ConversationWindowDefaults | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const defaults = value as Record<string, unknown>;
  return {
    windowPreferences: normalizeConversationWindowPreferences(defaults.windowPreferences),
    requestContext: normalizeConversationRequestContext(defaults.requestContext),
    reasoningStrength: normalizeConversationReasoningStrength(defaults.reasoningStrength)
  };
}

/** Copy defaults at creation; later defaults edits never rewrite existing windows. */
export function createConversationWindowSettings(defaults?: ConversationWindowDefaults): ConversationWindowDefaults {
  return {
    windowPreferences: normalizeConversationWindowPreferences(defaults?.windowPreferences),
    requestContext: defaults?.requestContext.mode === 'fromMessage' ? { mode: 'fromMessage', anchorMessageId: null } : defaults ? { ...defaults.requestContext } : { mode: 'inherit' },
    reasoningStrength: defaults?.reasoningStrength ?? 'automatic'
  };
}

/** Request-local override; the collaborator's advanced settings remain unchanged. */
export function applyConversationRequestContext(persona: Persona | null, context?: ConversationRequestContext): Persona | null {
  if (!persona || !context || context.mode === 'inherit') return persona;
  return { ...persona, advanced: { ...persona.advanced,
    contextMessageLimit: context.mode === 'recent' ? String(context.messageCount) : '' } };
}

/** A missing anchor uses full history until the user explicitly chooses a new one. */
export function selectConversationRequestMessages(messages: ChatMessage[], context?: ConversationRequestContext): ChatMessage[] {
  if (context?.mode !== 'fromMessage' || !context.anchorMessageId) return messages;
  const index = messages.findIndex(message => message.id === context.anchorMessageId && (message.role === 'user' || message.role === 'assistant') && !message.toolInvocation);
  return index >= 0 ? messages.slice(index) : messages;
}

/** Same deterministic staircase as Aru; align each boundary to a complete turn. */
export function selectSteppedRequestMessages<T extends Pick<ChatMessage, 'role' | 'toolInvocation'>>(messages: T[], limit: number): T[] {
  if (!Number.isFinite(limit) || limit <= 0 || messages.length <= limit) return messages;
  const target = Math.max(1, Math.floor(limit));
  const step = Math.max(1, Math.floor(target / 4));
  let start = Math.ceil((messages.length - target) / step) * step;
  start = Math.min(start, messages.length - 1);
  const latestUser = messages.map(message => message.role === 'user' && !message.toolInvocation).lastIndexOf(true);
  if (latestUser >= 0) start = Math.min(start, latestUser);
  // Replies and tool results belong to their triggering user/system turn.
  while (start > 0 && (messages[start].role === 'assistant' || messages[start].toolInvocation)) start -= 1;
  return messages.slice(start);
}

/** Normalize imported window settings without changing message/body ownership. */
export function normalizeConversationSettings<T extends object>(value: T) {
  const { contextMessageLimit, ...record } = value as T & { contextMessageLimit?: unknown };
  const settings = value as T & { requestContext?: unknown; reasoningStrength?: unknown; windowPreferences?: unknown };
  return {
    ...record,
    requestContext: normalizeConversationRequestContext(settings.requestContext, contextMessageLimit),
    reasoningStrength: normalizeConversationReasoningStrength(settings.reasoningStrength),
    windowPreferences: normalizeConversationWindowPreferences(settings.windowPreferences)
  };
}
