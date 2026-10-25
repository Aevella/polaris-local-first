import { isGroupConversation, isRetiredGroupConversation } from '../../engines/conversationOwnership';
import type { Conversation, Persona } from '../../types/domain';
import type { CollaboratorRecoveryEvidence } from '../../stores/collaboratorRecoveryEvidence';

export type MissingCollaboratorIncident = {
  collaboratorId: string;
  conversationIds: string[];
  conversationCount: number;
  latestUpdatedAt: number;
  snapshotName: string | null;
  evidence: CollaboratorRecoveryEvidence;
};

type BuildMissingCollaboratorIncidentsArgs = {
  personas: readonly Pick<Persona, 'id'>[];
  conversations: readonly Conversation[];
  evidenceByCollaboratorId?: Readonly<Record<string, CollaboratorRecoveryEvidence>>;
};

const CHECKING_EVIDENCE: CollaboratorRecoveryEvidence = { mode: 'checking' };

export function buildMissingCollaboratorIncidents({
  personas,
  conversations,
  evidenceByCollaboratorId = {}
}: BuildMissingCollaboratorIncidentsArgs): MissingCollaboratorIncident[] {
  const knownCollaboratorIds = new Set(personas.map((persona) => persona.id));
  const grouped = new Map<string, { conversationIds: string[]; latestUpdatedAt: number }>();

  for (const conversation of conversations) {
    if (isGroupConversation(conversation) || isRetiredGroupConversation(conversation)) continue;
    const collaboratorId = conversation.collaboratorId?.trim();
    if (!collaboratorId || knownCollaboratorIds.has(collaboratorId)) continue;
    const current = grouped.get(collaboratorId) ?? { conversationIds: [], latestUpdatedAt: 0 };
    current.conversationIds.push(conversation.id);
    current.latestUpdatedAt = Math.max(current.latestUpdatedAt, conversation.updatedAt);
    grouped.set(collaboratorId, current);
  }

  return Array.from(grouped.entries())
    .map(([collaboratorId, group]) => {
      const evidence = evidenceByCollaboratorId[collaboratorId] ?? CHECKING_EVIDENCE;
      return {
        collaboratorId,
        conversationIds: group.conversationIds,
        conversationCount: group.conversationIds.length,
        latestUpdatedAt: group.latestUpdatedAt,
        snapshotName: evidence.mode === 'reload'
          ? evidence.name
          : null,
        evidence
      };
    })
    .sort((left, right) => (
      right.latestUpdatedAt - left.latestUpdatedAt
      || left.collaboratorId.localeCompare(right.collaboratorId, 'zh-Hans-CN')
    ));
}
