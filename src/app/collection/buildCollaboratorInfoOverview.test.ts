import { describe, expect, it } from 'vitest';
import { RETIRED_POLARIS_ASSISTANT_PERSONA_ID, createPersonaTemplate } from '../../config/persona/personaBuilder';
import type { Conversation } from '../../types/domain';
import { buildCollaboratorInfoOverview } from './buildCollaboratorInfoOverview';

function conversation(seed: Partial<Conversation>): Conversation {
  return {
    id: seed.id ?? 'conversation',
    title: seed.title ?? '旧对话',
    collaboratorId: seed.collaboratorId ?? 'persona-a',
    activeProjectId: seed.activeProjectId ?? null,
    draft: seed.draft ?? '',
    pinnedAt: seed.pinnedAt ?? null,
    updatedAt: seed.updatedAt ?? 1,
    messages: seed.messages ?? []
  };
}

describe('buildCollaboratorInfoOverview', () => {
  it('keeps collaborator avatar settings in the overview payload', () => {
    const overview = buildCollaboratorInfoOverview({
      personas: [
        createPersonaTemplate({
          id: 'persona-a',
          name: 'Aelion',
          description: '温柔陪伴',
          assistantAvatarAssetId: 'asset-assistant',
          assistantAvatarShape: 'circle'
        })
      ],
      conversations: [],
      cards: [],
      imageCards: []
    });

    expect(overview[0]).toMatchObject({
      id: 'persona-a',
      assistantAvatarAssetId: 'asset-assistant',
      assistantAvatarShape: 'circle'
    });
  });

  it('shows the summary placeholder for default collaborator copy in overview cards', () => {
    const overview = buildCollaboratorInfoOverview({
      personas: [
        createPersonaTemplate({
          id: 'persona-subject',
          name: '主语',
          description: '我已经存在，会完整地站在每段语境里'
        })
      ],
      conversations: [],
      cards: [],
      imageCards: []
    });

    expect(overview[0].summary).toBe('还没有协作者印象');
  });

  it('shows the model label for a retained Xiao Assistant like any other collaborator', () => {
    const overview = buildCollaboratorInfoOverview({
      personas: [
        createPersonaTemplate({
          id: RETIRED_POLARIS_ASSISTANT_PERSONA_ID,
          name: '小助手',
          description: 'Polaris 使用向导',
          advanced: {
            modelOverride: 'user-model'
          }
        })
      ],
      conversations: [],
      cards: [],
      imageCards: []
    });

    expect(overview[0].modelLabel).toBe('user-model');
  });

  it('carries collaborator pin state into overview cards', () => {
    const overview = buildCollaboratorInfoOverview({
      personas: [
        createPersonaTemplate({
          id: 'persona-pinned',
          name: '置顶协作者',
          description: '已经置顶',
          pinnedAt: 10
        })
      ],
      conversations: [],
      cards: [],
      imageCards: []
    });

    expect(overview[0].pinnedAt).toBe(10);
  });

  it('counts only conversations that can appear in the dialogue shelf', () => {
    const overview = buildCollaboratorInfoOverview({
      personas: [
        createPersonaTemplate({
          id: 'persona-a',
          name: 'Aelion',
          description: '温柔陪伴'
        })
      ],
      loadedMessageConversationIds: new Set(['visible', 'empty-loaded', 'blank-message']),
      conversations: [
        conversation({
          id: 'visible',
          messages: [{ id: 'm-1', role: 'user', content: '留下来的正文', timestamp: 1 }]
        }),
        conversation({ id: 'empty-loaded', messages: [] }),
        conversation({
          id: 'blank-message',
          messages: [{ id: 'm-blank', role: 'user', content: '   ', timestamp: 2 }]
        })
      ],
      cards: [],
      imageCards: []
    });

    expect(overview[0].conversationCount).toBe(1);
  });
});
