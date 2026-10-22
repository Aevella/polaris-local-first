import { resolveConversationCollaboratorId } from '../../engines/conversationOwnership';
import { normalizePersonaDefaultSummary, PERSONA_SUMMARY_PLACEHOLDER } from '../../config/persona/personaBaseCatalog';
import type { AvatarShape, CodeCard, Conversation, ImageAssetCard, Persona } from '../../types/domain';
import { hasArchivedConversationContent } from './conversationArchiveVisibility';

export type CollaboratorInfoOverviewItem = {
  id: string;
  name: string;
  summary: string;
  assistantAvatarAssetId: string | null;
  assistantAvatarShape: AvatarShape;
  modelLabel: string | null;
  memoryCount: number;
  collectionCount: number;
  imageCount: number;
  conversationCount: number;
  pinnedAt: number | null;
};

type BuildCollaboratorInfoOverviewArgs = {
  personas: Persona[];
  conversations: Conversation[];
  loadedMessageConversationIds?: ReadonlySet<string>;
  cards: CodeCard[];
  imageCards: ImageAssetCard[];
};

export function buildCollaboratorInfoOverview({
  personas,
  conversations,
  loadedMessageConversationIds,
  cards,
  imageCards
}: BuildCollaboratorInfoOverviewArgs): CollaboratorInfoOverviewItem[] {
  const collectionCounts: Record<string, number> = {};
  const imageCounts: Record<string, number> = {};
  const conversationCounts: Record<string, number> = {};

  cards.forEach((card) => {
    if (!card.ownerCollaboratorId || card.kind === 'room-rule') return;
    collectionCounts[card.ownerCollaboratorId] = (collectionCounts[card.ownerCollaboratorId] ?? 0) + 1;
  });

  imageCards.forEach((card) => {
    if (!card.ownerCollaboratorId) return;
    imageCounts[card.ownerCollaboratorId] = (imageCounts[card.ownerCollaboratorId] ?? 0) + 1;
  });

  conversations.forEach((conversation) => {
    if (!hasArchivedConversationContent(conversation, { loadedMessageConversationIds })) return;
    const collaboratorId = resolveConversationCollaboratorId(conversation);
    if (!collaboratorId) return;
    conversationCounts[collaboratorId] = (conversationCounts[collaboratorId] ?? 0) + 1;
  });

  return personas.map((persona) => {
    const summary = normalizePersonaDefaultSummary(persona.description)
      || persona.purpose.trim()
      || PERSONA_SUMMARY_PLACEHOLDER;
    const modelLabel = persona.advanced.modelOverride.trim() || null;

    return {
      id: persona.id,
      name: persona.name,
      summary,
      assistantAvatarAssetId: persona.assistantAvatarAssetId,
      assistantAvatarShape: persona.assistantAvatarShape,
      modelLabel,
      memoryCount: persona.memory.personalMemories.length,
      collectionCount: collectionCounts[persona.id] ?? 0,
      imageCount: imageCounts[persona.id] ?? 0,
      conversationCount: conversationCounts[persona.id] ?? 0,
      pinnedAt: persona.pinnedAt ?? null
    };
  });
}
