import type { ChatMessage, ConversationWindowPreferences, McpServerConfig } from '../types/domain';

export function normalizeConversationWindowPreferences(value: unknown): ConversationWindowPreferences {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const scope = raw.mcpScope && typeof raw.mcpScope === 'object' ? raw.mcpScope as Record<string, unknown> : {};
  const binding = raw.modelBinding && typeof raw.modelBinding === 'object' ? raw.modelBinding as Record<string, unknown> : {};
  return {
    ...(typeof binding.providerId === 'string' && binding.providerId.trim() ? { modelBinding: { providerId: binding.providerId.trim(), model: typeof binding.model === 'string' ? binding.model.trim() : '' } } : {}),
    historicalImagePolicy: raw.historicalImagePolicy === 'currentTurnOnly' || raw.historicalImagePolicy === 'always' ? raw.historicalImagePolicy : 'smart',
    composerReturnKeyBehavior: raw.composerReturnKeyBehavior === 'newline' || raw.composerReturnKeyBehavior === 'send' ? raw.composerReturnKeyBehavior : 'automatic',
    mcpScope: scope.mode === 'selected' ? { mode: 'selected', serverIds: Array.isArray(scope.serverIds)
      ? [...new Set(scope.serverIds.filter((id): id is string => typeof id === 'string' && Boolean(id.trim())).map(id => id.trim()))] : [] } : { mode: 'inherit' }
  };
}

/** A window may narrow, but never expand, the collaborator's available MCP set. */
export function resolveConversationMcpServers(servers: McpServerConfig[], scope?: ConversationWindowPreferences['mcpScope']): McpServerConfig[] {
  if (!scope || scope.mode === 'inherit') return servers;
  const selected = new Set(scope.serverIds);
  return servers.filter(server => selected.has(server.id));
}

export function shouldSendOnComposerReturn(args: { behavior: ConversationWindowPreferences['composerReturnKeyBehavior']; touch: boolean; shift: boolean; composing: boolean }): boolean {
  return !args.shift && !args.composing && args.behavior !== 'newline' && (args.behavior === 'send' || !args.touch);
}

/** Smart preserves Polaris's existing two image-bearing user-message policy. */
export function resolveConversationImageMessageIds(messages: readonly Pick<ChatMessage, 'id' | 'role' | 'attachments'>[], policy: ConversationWindowPreferences['historicalImagePolicy'] = 'smart'): Set<string> {
  const ids = new Set<string>();
  let remaining = policy === 'always' ? Infinity : policy === 'currentTurnOnly' ? 1 : 2;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== 'user') continue;
    if (policy === 'currentTurnOnly') {
      if (message.attachments?.some(item => item.kind === 'image' && !item.clearedAt)) ids.add(message.id);
      break;
    }
    if (!message.attachments?.some(item => item.kind === 'image' && !item.clearedAt)) continue;
    if (remaining-- > 0) ids.add(message.id);
    if (remaining <= 0) break;
  }
  return ids;
}
