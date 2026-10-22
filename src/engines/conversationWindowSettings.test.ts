import { describe, it, expect } from 'vitest';
import { normalizeConversationWindowPreferences, resolveConversationMcpServers, shouldSendOnComposerReturn, resolveConversationImageMessageIds } from './conversationWindowSettings';
import type { ChatMessage, McpServerConfig } from '../types/domain';

function image(id: string): ChatMessage {
  return { id, role: 'user', content: '', timestamp: 1, attachments: [{ id, assetId: id, kind: 'image', name: 'image', mimeType: 'image/png', size: 1 }] };
}

describe('normalizeConversationWindowPreferences', () => {
  it('keeps installed behavior for missing settings and normalizes imported selected servers', () => {
    expect(normalizeConversationWindowPreferences(undefined)).toEqual({ historicalImagePolicy: 'smart', composerReturnKeyBehavior: 'automatic', mcpScope: { mode: 'inherit' } });
    expect(normalizeConversationWindowPreferences({ historicalImagePolicy: 'bad', composerReturnKeyBehavior: 'bad', participatesInAutomaticSummary: false, mcpScope: { mode: 'selected', serverIds: [' a ', 'a', 1, '', 'b'] } }))
      .toEqual({ historicalImagePolicy: 'smart', composerReturnKeyBehavior: 'automatic', mcpScope: { mode: 'selected', serverIds: ['a', 'b'] } });
  });
});
describe('window model normalization', () => {
  it('reads older settings as inherited and normalizes the external model binding', () => {
    expect(normalizeConversationWindowPreferences({ modelBinding: { providerId: ' p ', model: ' model ' } }).modelBinding).toEqual({ providerId: 'p', model: 'model' });
    expect(normalizeConversationWindowPreferences({ modelBinding: { providerId: 2 } }).modelBinding).toBeUndefined();
    expect(normalizeConversationWindowPreferences({ modelBinding: { providerId: 'p' } }).modelBinding).toEqual({ providerId: 'p', model: '' });
  });
});
describe('resolveConversationMcpServers', () => {
  it('cannot expand the collaborator scope and allows selecting none', () => {
    const servers = [{ id: 'allowed' }, { id: 'other' }] as McpServerConfig[];
    expect(resolveConversationMcpServers(servers, { mode: 'inherit' })).toBe(servers);
    expect(resolveConversationMcpServers(servers, { mode: 'selected', serverIds: ['allowed', 'not-allowed'] })).toEqual([servers[0]]);
    expect(resolveConversationMcpServers(servers, { mode: 'selected', serverIds: [] })).toEqual([]);
  });
});
describe('shouldSendOnComposerReturn', () => {
  it('keeps device behavior by default, honors explicit choices and protects IME/Shift', () => {
    const base = { behavior: 'automatic' as const, touch: false, shift: false, composing: false };
    expect(shouldSendOnComposerReturn(base)).toBe(true);
    expect(shouldSendOnComposerReturn({ ...base, touch: true })).toBe(false);
    expect(shouldSendOnComposerReturn({ ...base, behavior: 'send', touch: true })).toBe(true);
    expect(shouldSendOnComposerReturn({ ...base, behavior: 'newline' })).toBe(false);
    expect(shouldSendOnComposerReturn({ ...base, behavior: 'send', shift: true })).toBe(false);
    expect(shouldSendOnComposerReturn({ ...base, behavior: 'send', composing: true })).toBe(false);
  });
});
describe('resolveConversationImageMessageIds', () => {
  it('selects only the admitted images while tool follow-ups retain the current user turn', () => {
    const messages = [image('oldest'), image('older'), image('latest'), { id: 'tool', role: 'system' as const, content: '', timestamp: 1 }];
    expect([...resolveConversationImageMessageIds(messages)]).toEqual(['latest', 'older']);
    expect([...resolveConversationImageMessageIds(messages, 'currentTurnOnly')]).toEqual(['latest']);
    expect([...resolveConversationImageMessageIds(messages, 'always')]).toEqual(['latest', 'older', 'oldest']);
    expect([...resolveConversationImageMessageIds([...messages, { id: 'text', role: 'user', content: 'text', timestamp: 2 }], 'currentTurnOnly')]).toEqual([]);
    expect(resolveConversationImageMessageIds([], 'always').size).toBe(0);
  });
});
