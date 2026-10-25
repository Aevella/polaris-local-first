import { useCallback, useEffect, useMemo, useState } from 'react';
import { useI18n } from '../../i18n';
import { useChatStore } from '../../stores/chatStore';
import {
  readCollaboratorRecoveryEvidence,
  type CollaboratorRecoveryEvidence
} from '../../stores/collaboratorRecoveryEvidence';
import { usePersonaStore } from '../../stores/personaStore';
import type { Conversation, Persona } from '../../types/domain';
import { hasArchivedConversationContent } from './conversationArchiveVisibility';
import { buildMissingCollaboratorIncidents } from './collaboratorRecoveryPlan';

type CollaboratorRecoveryUi = {
  confirm: (message: string) => boolean;
  alert: (message: string) => void;
};

type CollaboratorRecoveryNavigation = {
  setFrontstageCollaboratorId: (collaboratorId: string | null) => void;
  setEditingCollaboratorId: (collaboratorId: string | null) => void;
  setCollectionShelf: (shelf: 'info') => void;
};

type UseCollaboratorRecoveryControllerArgs = {
  personas: Persona[];
  conversations: Conversation[];
  loadedMessageConversationIds: string[];
  ui: CollaboratorRecoveryUi;
  navigation: CollaboratorRecoveryNavigation;
};

export function useCollaboratorRecoveryController({
  personas,
  conversations,
  loadedMessageConversationIds,
  ui,
  navigation
}: UseCollaboratorRecoveryControllerArgs) {
  const { t } = useI18n();
  const [evidenceByCollaboratorId, setEvidenceByCollaboratorId] = useState<
    Record<string, CollaboratorRecoveryEvidence>
  >({});
  const [busyCollaboratorId, setBusyCollaboratorId] = useState<string | null>(null);
  const loadedIds = useMemo(() => new Set(loadedMessageConversationIds), [loadedMessageConversationIds]);
  const recoverableConversationCandidates = useMemo(
    () => conversations.filter((conversation) => (
      hasArchivedConversationContent(conversation, { loadedMessageConversationIds: loadedIds })
    )),
    [conversations, loadedIds]
  );
  const incidents = useMemo(
    () => buildMissingCollaboratorIncidents({
      personas,
      conversations: recoverableConversationCandidates,
      evidenceByCollaboratorId
    }),
    [evidenceByCollaboratorId, personas, recoverableConversationCandidates]
  );
  const missingCollaboratorIds = useMemo(
    () => incidents.map((incident) => incident.collaboratorId),
    [incidents]
  );
  const missingCollaboratorSignature = missingCollaboratorIds.join('\u0000');

  const refreshEvidence = useCallback(async (collaboratorIds: readonly string[]) => {
    const nextEvidence = await readCollaboratorRecoveryEvidence(collaboratorIds);
    setEvidenceByCollaboratorId(nextEvidence);
  }, []);

  useEffect(() => {
    let canceled = false;
    const collaboratorIds = missingCollaboratorSignature ? missingCollaboratorSignature.split('\u0000') : [];
    if (collaboratorIds.length === 0) {
      setEvidenceByCollaboratorId({});
      return;
    }
    void readCollaboratorRecoveryEvidence(collaboratorIds).then((nextEvidence) => {
      if (!canceled) setEvidenceByCollaboratorId(nextEvidence);
    });
    return () => {
      canceled = true;
    };
  }, [missingCollaboratorSignature]);

  const openCollaboratorRoom = useCallback((collaboratorId: string) => {
    usePersonaStore.getState().setActiveCollaborator(collaboratorId);
    navigation.setFrontstageCollaboratorId(collaboratorId);
    navigation.setEditingCollaboratorId(collaboratorId);
    navigation.setCollectionShelf('info');
  }, [navigation]);

  const restoreCollaborator = useCallback(async (collaboratorId: string) => {
    const evidence = evidenceByCollaboratorId[collaboratorId];
    if (!evidence || evidence.mode !== 'reload') return;
    if (!ui.confirm(t('collaborator.recovery.restoreConfirm', { name: evidence.name }))) return;
    setBusyCollaboratorId(collaboratorId);
    try {
      await usePersonaStore.getState().reloadMissingCollaborator(collaboratorId);
      if (!usePersonaStore.getState().personas.some((persona) => persona.id === collaboratorId)) {
        throw new Error(t('collaborator.recovery.restoreMissingAfterReadback'));
      }
      openCollaboratorRoom(collaboratorId);
      ui.alert(t('collaborator.recovery.restored', { name: evidence.name }));
    } catch (error) {
      ui.alert(error instanceof Error ? error.message : t('collaborator.recovery.restoreFailed'));
      await refreshEvidence([collaboratorId]);
    } finally {
      setBusyCollaboratorId(null);
    }
  }, [evidenceByCollaboratorId, openCollaboratorRoom, refreshEvidence, t, ui]);

  const rebuildCollaborator = useCallback(async (collaboratorId: string, name: string) => {
    const evidence = evidenceByCollaboratorId[collaboratorId];
    const collaboratorName = name.trim();
    if (evidence?.mode !== 'rebuild' || !collaboratorName) return;
    if (!ui.confirm(t('collaborator.recovery.rebuildConfirm', { name: collaboratorName }))) return;
    setBusyCollaboratorId(collaboratorId);
    try {
      const rebuilt = await usePersonaStore.getState().rebuildMissingCollaborator(collaboratorId, collaboratorName);
      if (!rebuilt) throw new Error(t('collaborator.recovery.rebuildUnavailable'));
      if (!usePersonaStore.getState().personas.some((persona) => persona.id === collaboratorId)) {
        throw new Error(t('collaborator.recovery.restoreMissingAfterReadback'));
      }
      openCollaboratorRoom(collaboratorId);
      ui.alert(t('collaborator.recovery.rebuilt', { name: collaboratorName }));
    } catch (error) {
      ui.alert(error instanceof Error ? error.message : t('collaborator.recovery.rebuildFailed'));
      await refreshEvidence([collaboratorId]);
    } finally {
      setBusyCollaboratorId(null);
    }
  }, [evidenceByCollaboratorId, openCollaboratorRoom, refreshEvidence, t, ui]);

  const reassignConversations = useCallback(async (sourceCollaboratorId: string, targetCollaboratorId: string) => {
    const target = personas.find((persona) => persona.id === targetCollaboratorId);
    if (!target) return;
    const incident = incidents.find((entry) => entry.collaboratorId === sourceCollaboratorId);
    if (!incident) return;
    if (!ui.confirm(t('collaborator.recovery.reassignConfirm', {
      count: incident.conversationCount,
      name: target.name
    }))) return;
    setBusyCollaboratorId(sourceCollaboratorId);
    try {
      const changedIds = useChatStore.getState().reassignCollaboratorConversations(
        sourceCollaboratorId,
        targetCollaboratorId
      );
      if (changedIds.length === 0) throw new Error(t('collaborator.recovery.reassignUnavailable'));
      await useChatStore.getState().persistToDb();
      openCollaboratorRoom(targetCollaboratorId);
      ui.alert(t('collaborator.recovery.reassigned', { count: changedIds.length, name: target.name }));
    } catch (error) {
      ui.alert(error instanceof Error ? error.message : t('collaborator.recovery.reassignFailed'));
    } finally {
      setBusyCollaboratorId(null);
    }
  }, [incidents, openCollaboratorRoom, personas, t, ui]);

  return {
    incidents,
    busyCollaboratorId,
    restoreCollaborator,
    rebuildCollaborator,
    reassignConversations
  };
}

export type CollaboratorRecoveryController = ReturnType<typeof useCollaboratorRecoveryController>;
