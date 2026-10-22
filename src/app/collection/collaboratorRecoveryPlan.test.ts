import { describe, expect, it } from 'vitest';
import type { Conversation } from '../../types/domain';
import { buildMissingCollaboratorIncidents } from './collaboratorRecoveryPlan';

function conversation(seed: Partial<Conversation> & Pick<Conversation, 'id' | 'collaboratorId'>): Conversation {
  return {
    title: seed.id,
    messages: [],
    draft: '',
    pinnedAt: null,
    updatedAt: 1,
    ...seed
  };
}

describe('buildMissingCollaboratorIncidents', () => {
  it('groups direct histories by missing collaborator without projecting fake personas', () => {
    const incidents = buildMissingCollaboratorIncidents({
      personas: [{ id: 'known' }],
      conversations: [
        conversation({ id: 'old', collaboratorId: 'missing', updatedAt: 10 }),
        conversation({ id: 'new', collaboratorId: 'missing', updatedAt: 30 }),
        conversation({ id: 'known-chat', collaboratorId: 'known', updatedAt: 40 }),
        conversation({ id: 'unassigned', collaboratorId: null, updatedAt: 50 })
      ],
      evidenceByCollaboratorId: {
        missing: { mode: 'reload', name: '原来的名字' }
      }
    });

    expect(incidents).toEqual([{
      collaboratorId: 'missing',
      conversationIds: ['old', 'new'],
      conversationCount: 2,
      latestUpdatedAt: 30,
      snapshotName: '原来的名字',
      evidence: { mode: 'reload', name: '原来的名字' }
    }]);
  });

  it('keeps group and retired group histories out of collaborator recovery', () => {
    const incidents = buildMissingCollaboratorIncidents({
      personas: [],
      conversations: [
        conversation({
          id: 'group',
          collaboratorId: 'missing',
          kind: 'group',
          group: { title: '群聊', memberIds: [] } as never
        }),
        conversation({ id: 'retired-group', collaboratorId: 'missing', groupRoomId: 'legacy-group' })
      ]
    });

    expect(incidents).toEqual([]);
  });

  it('marks unresolved evidence as checking until storage inspection finishes', () => {
    const [incident] = buildMissingCollaboratorIncidents({
      personas: [],
      conversations: [conversation({ id: 'chat', collaboratorId: 'missing' })]
    });

    expect(incident?.evidence).toEqual({ mode: 'checking' });
    expect(incident?.snapshotName).toBeNull();
  });
});
