import { describe, expect, it, vi } from 'vitest';
import type { ChatMessage, Conversation, Persona } from '../../types/domain';
import { buildConversationArchiveExportPayload } from './conversationArchiveExport';

function message(input: Partial<ChatMessage> & Pick<ChatMessage, 'id' | 'content'>): ChatMessage {
  return {
    role: 'user',
    timestamp: 1_700_000_000_000,
    ...input
  };
}

function conversation(input: Partial<Conversation> & Pick<Conversation, 'id'>): Conversation {
  return {
    title: input.id,
    kind: 'direct',
    collaboratorId: 'persona-1',
    groupRoomId: null,
    activeProjectId: null,
    messages: [],
    toolLedger: undefined,
    workspaceLedger: undefined,
    task: null,
    draft: '',
    pinnedAt: null,
    updatedAt: 1_700_000_000_000,
    ...input
  };
}

function persona(id: string, name: string): Persona {
  return { id, name } as Persona;
}

const collaborators: Persona[] = [
  persona('persona-1', 'Pharos'),
  persona('persona-2', 'Aster')
];

describe('buildConversationArchiveExportPayload', () => {
  it('exports only the selected collaborator scope and reads unloaded message bodies', async () => {
    const readMessages = vi.fn(async (conversationId: string) => (
      conversationId === 'loaded-shell'
        ? [message({ id: 'loaded-message', content: 'persisted local body' })]
        : []
    ));

    const payload = await buildConversationArchiveExportPayload({
      conversations: [
        conversation({
          id: 'loaded-shell',
          title: 'Stored shell',
          collaboratorId: 'persona-1'
        }),
        conversation({
          id: 'foreground',
          title: 'Foreground chat',
          collaboratorId: 'persona-1',
          messages: [message({ id: 'visible', content: 'visible body' })]
        }),
        conversation({
          id: 'other-persona',
          title: 'Other chat',
          collaboratorId: 'persona-2',
          messages: [message({ id: 'other', content: 'other body' })]
        })
      ],
      collaborators,
      collaboratorScopeId: 'persona-1',
      knownCollaboratorIds: collaborators.map((collaborator) => collaborator.id),
      readMessages,
      exportedAt: 1_700_000_100_000
    });

    const markdown = await payload.blob.text();

    expect(readMessages).toHaveBeenCalledWith('loaded-shell');
    expect(payload.fileName).toBe('polaris-Pharos-chat-2023-11-14.md');
    expect(payload.conversationCount).toBe(2);
    expect(payload.messageCount).toBe(2);
    expect(markdown).toContain('Stored shell');
    expect(markdown).toContain('persisted local body');
    expect(markdown).toContain('Foreground chat');
    expect(markdown).toContain('visible body');
    expect(markdown).not.toContain('other body');
  });

  it('fails clearly when the selected scope has no message bodies', async () => {
    await expect(buildConversationArchiveExportPayload({
      conversations: [conversation({ id: 'empty', collaboratorId: 'persona-1' })],
      collaborators,
      collaboratorScopeId: 'persona-1',
      knownCollaboratorIds: collaborators.map((collaborator) => collaborator.id),
      readMessages: async () => [],
      exportedAt: 1_700_000_100_000
    })).rejects.toThrow('当前范围没有可导出的对话。');
  });
});
