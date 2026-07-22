import type { MutableRefObject } from 'react';
import type { ChatMessage, ChatMessageVoiceCache } from '../../types/domain';
import { createUid } from '../../engines/id';
import type { ChatActionStoreBindings, ChatDerivedStatePort, ChatUiActionState } from './chatPorts';
import {
  orphanCollaboratorConversationSessions,
  openConversationForCollaborator,
  resolveDefaultCollaboratorId
} from './chatConversationSession';
import { disconnectCompanionConnection } from '../companion/companionConnectionActions';
import { isCompanionCollaboratorId } from '../../engines/companion';
import { submitCompanionMessage } from './chatCompanionSubmit';
import { buildSubmitFingerprint, submitMessage } from './chatSubmitFlow';
import {
  finishChatSendPerformanceTrace
} from './chatSendPerformanceTrace';
import { selectChatConversations } from './liveConversationCatalog';
import { reportPersistenceError } from '../../infrastructure/persistenceDiagnostics';

type CreateChatActionHandlersArgs = {
  startupReady: boolean;
  ui: ChatUiActionState;
  store: ChatActionStoreBindings;
  derived: ChatDerivedStatePort;
  runReply: (params: {
    conversationId: string;
    collaboratorId: string;
    messages: ChatMessage[];
  }) => Promise<unknown>;
  submitToolCommand: (rawInput: string) => Promise<boolean>;
  activeSubmitFingerprintRef: MutableRefObject<string | null>;
};

export function createChatActionHandlers({
  startupReady,
  ui,
  store,
  derived,
  runReply,
  submitToolCommand,
  activeSubmitFingerprintRef
}: CreateChatActionHandlersArgs) {
  const readLatestSubmitState = () => {
    const chatState = store.chat.readLatestState();
    const personaState = store.persona.readLatestState();
    const spaceState = store.space.readLatestState();
    const conversations = selectChatConversations(chatState.conversations);

    return {
      inputDraft: chatState.inputDraft,
      pendingAttachments: spaceState.pendingAttachments,
      pendingCardReference: spaceState.pendingCardReference,
      conversations,
      activeConversationId: chatState.activeConversationId,
      frontstageCollaboratorId: spaceState.frontstageCollaboratorId,
      activeCollaboratorId: personaState.activeCollaboratorId,
      personas: personaState.personas
    };
  };

  const handleSubmit = async () => {
    if (!startupReady) {
      return;
    }

    const latestSubmitState = readLatestSubmitState();
    const latestActiveConversation = latestSubmitState.activeConversationId
      ? latestSubmitState.conversations.find((conversation) => conversation.id === latestSubmitState.activeConversationId) ?? null
      : null;
    const submitFingerprint = buildSubmitFingerprint(
      latestSubmitState.inputDraft,
      latestSubmitState.pendingAttachments,
      latestSubmitState.pendingCardReference
    );
    if (activeSubmitFingerprintRef.current === submitFingerprint) {
      if (latestSubmitState.activeConversationId) {
        finishChatSendPerformanceTrace(latestSubmitState.activeConversationId, 'aborted', {
          extra: ['duplicate submit']
        });
      }
      return;
    }
    activeSubmitFingerprintRef.current = submitFingerprint;

    try {
      const activeCompanionConnection =
        latestActiveConversation?.collaboratorId && isCompanionCollaboratorId(latestActiveConversation.collaboratorId)
          ? store.runtime.companionConnections.find(
              (connection) => connection.collaboratorId === latestActiveConversation.collaboratorId
            ) ?? null
          : null;
      if (activeCompanionConnection) {
        await submitCompanionMessage({
          inputDraft: latestSubmitState.inputDraft,
          pendingAttachments: latestSubmitState.pendingAttachments,
          pendingCardReference: latestSubmitState.pendingCardReference,
          activeConversation: latestActiveConversation
        }, {
          ensureConversationWritable: store.chat.ensureConversationWritable,
          addMessage: store.chat.addMessage,
          setInputDraft: store.chat.setInputDraft,
          clearPendingAttachments: store.space.clearPendingAttachments,
          clearPendingCardReference: store.space.clearPendingCardReference,
          setCommandStatus: ui.setCommandStatus,
          persistToDb: store.chat.persistToDb,
          onUserMessageSubmitted: ui.triggerSubmitFlight
        }, activeCompanionConnection);
        return;
      }
      await submitMessage({
        inputDraft: latestSubmitState.inputDraft,
        pendingAttachments: latestSubmitState.pendingAttachments,
        pendingCardReference: latestSubmitState.pendingCardReference,
        sending: ui.sending,
        hasUnsupportedPendingImages: derived.hasUnsupportedPendingImages,
        conversations: latestSubmitState.conversations,
        activeConversationId: latestSubmitState.activeConversationId,
        frontstageCollaboratorId: latestSubmitState.frontstageCollaboratorId,
        activeCollaboratorId: latestSubmitState.activeCollaboratorId,
        personas: latestSubmitState.personas
      }, {
        createConversation: store.chat.createConversation,
        ensureConversationWritable: store.chat.ensureConversationWritable,
        addMessage: store.chat.addMessage,
        setInputDraft: store.chat.setInputDraft,
        clearPendingAttachments: store.space.clearPendingAttachments,
        clearPendingCardReference: store.space.clearPendingCardReference,
        setCommandStatus: ui.setCommandStatus,
        submitToolCommand,
        onUserMessageSubmitted: ui.triggerSubmitFlight,
        requestReply: ({ conversationId, collaboratorId, messages }) => runReply({ conversationId, collaboratorId, messages })
      });
    } finally {
      if (activeSubmitFingerprintRef.current === submitFingerprint) {
        activeSubmitFingerprintRef.current = null;
      }
    }
  };

  const commitMessageEdit = async (message: ChatMessage) => {
    const activeConversation = derived.activeConversation;
    if (!activeConversation || ui.sending || !ui.editing) return;

    const nextContent = ui.editing.draft.trim();
    const nextAttachments = ui.editing.attachments;
    if (!nextContent && nextAttachments.length === 0) {
      ui.setCommandStatus('消息内容不能为空。', true);
      return;
    }

    if (activeConversation.collaboratorId === null) {
      ui.setCommandStatus('这条对话已经失去归属，只能查看历史，不能在原线程里继续改写。', true);
      return;
    }
    if (isCompanionCollaboratorId(activeConversation.collaboratorId)) {
      ui.setCommandStatus('电脑端 companion 这轮还不支持在手机上原地改写上一句。', true);
      return;
    }

    const nextUserMessage: ChatMessage = {
      ...message,
      content: nextContent,
      attachments: nextAttachments.length ? nextAttachments : undefined,
      timestamp: Date.now()
    };
    const writableConversation = await store.chat.ensureConversationWritable(activeConversation.id);
    if (!writableConversation) {
      ui.setCommandStatus('读取当前对话历史失败，先别改写，避免用空历史继续。', true);
      return;
    }
    const messageIndex = writableConversation.messages.findIndex((candidate) => candidate.id === message.id);
    if (messageIndex === -1) return;
    const nextMessages = [...writableConversation.messages.slice(0, messageIndex), nextUserMessage];
    store.chat.replaceConversationMessages(writableConversation, nextMessages);
    ui.cancelEditingMessage();
    await runReply({
      conversationId: activeConversation.id,
      collaboratorId: derived.activeCollaboratorSourceId ?? activeConversation.collaboratorId,
      messages: nextMessages
    });
  };

  const retryLatestAssistant = async (message: ChatMessage) => {
    const activeConversation = derived.activeConversation;
    if (!activeConversation || ui.sending) return;

    if (activeConversation.collaboratorId === null) {
      ui.setCommandStatus('这条对话已经失去归属，只能查看历史，不能在原线程里重新生成。', true);
      return;
    }
    if (isCompanionCollaboratorId(activeConversation.collaboratorId)) {
      ui.setCommandStatus('电脑端 companion 这轮还不支持在手机上直接重跑上一答。', true);
      return;
    }

    const writableConversation = await store.chat.ensureConversationWritable(activeConversation.id);
    if (!writableConversation) {
      ui.setCommandStatus('读取当前对话历史失败，先别重跑，避免用空历史继续。', true);
      return;
    }
    const messageIndex = writableConversation.messages.findIndex((candidate) => candidate.id === message.id);
    if (messageIndex <= 0) return;
    const nextMessages = writableConversation.messages.slice(0, messageIndex);
    store.chat.replaceConversationMessages(writableConversation, nextMessages);
    await runReply({
      conversationId: activeConversation.id,
      collaboratorId: derived.activeCollaboratorSourceId ?? activeConversation.collaboratorId,
      messages: nextMessages
    });
  };

  const updateAssistantMessage = async (message: ChatMessage, content: string) => {
    const activeConversation = derived.activeConversation;
    const nextContent = content.trim();
    if (!activeConversation || ui.sending || message.role !== 'assistant' || message.toolInvocation) return;
    if (!nextContent) {
      ui.setCommandStatus('回答内容不能为空。', true);
      return;
    }
    if (!activeConversation.messages.some((candidate) => candidate.id === message.id)) return;

    const writableConversation = await store.chat.ensureConversationWritable(activeConversation.id);
    if (!writableConversation) {
      ui.setCommandStatus('读取当前对话历史失败，先别修改回答。', true);
      return;
    }
    store.chat.updateMessage(writableConversation, message.id, {
      content: nextContent,
      timestamp: Date.now(),
      voiceCache: undefined
    });
    ui.setCommandStatus('已修改这条回答。');
  };

  const cacheAssistantSpeech = (message: ChatMessage, voiceCache: ChatMessageVoiceCache) => {
    const latestState = store.chat.readLatestState();
    const targetConversation = latestState.conversations.find((conversation) =>
      conversation.messages.some((candidate) => candidate.id === message.id)
    );
    if (!targetConversation) return;
    void store.chat.ensureConversationWritable(targetConversation.id)
      .then((writableConversation) => {
        if (!writableConversation) return;
        store.chat.updateMessage(writableConversation, message.id, { voiceCache });
        void store.chat.persistToDb?.().catch((error) => {
          reportPersistenceError({ label: '[chat:voice-cache]', store: 'chat', operation: 'flush-voice-cache' }, error);
        });
      })
      .catch((error) => {
        reportPersistenceError({ label: '[chat:voice-cache]', store: 'chat', operation: 'prepare-voice-cache' }, error);
      });
  };

  const forkConversationFromMessage = async (message: ChatMessage) => {
    const activeConversation = derived.activeConversation;
    if (!activeConversation || ui.sending || message.toolInvocation) return;
    if (activeConversation.collaboratorId === null) {
      ui.setCommandStatus('这条对话已经失去归属，只能查看历史，不能从这里分支。', true);
      return;
    }

    const sourceConversation = await store.chat.ensureConversationWritable(activeConversation.id);
    if (!sourceConversation) {
      ui.setCommandStatus('读取当前对话历史失败，先别分支。', true);
      return;
    }
    const messageIndex = sourceConversation.messages.findIndex((candidate) => candidate.id === message.id);
    if (messageIndex < 0) return;

    const conversationId = store.chat.createConversation(sourceConversation.conversation.collaboratorId, {
      activeProjectId: sourceConversation.conversation.activeProjectId ?? null
    });
    const writableConversation = await store.chat.ensureConversationWritable(conversationId);
    if (!writableConversation) {
      ui.setCommandStatus('新分支还没准备好，先别写入。', true);
      return;
    }
    const clonedMessages = sourceConversation.messages.slice(0, messageIndex + 1).map((entry, index) => ({
      ...entry,
      id: createUid(entry.role),
      timestamp: Date.now() + index
    }));
    store.chat.replaceConversationMessages(writableConversation, clonedMessages);
    store.space.clearPendingAttachments();
    store.space.clearPendingCardReference();
    store.chat.setActiveConversation(conversationId);
    ui.setCommandStatus(`已从这里创建分支：${activeConversation.title}`);
  };

  const selectPersona = (collaboratorId: string) => {
    if (isCompanionCollaboratorId(collaboratorId)) {
      const connection = store.runtime.companionConnections.find((entry) => entry.collaboratorId === collaboratorId) ?? null;
      if (!connection) {
        ui.setCommandStatus('这个电脑端协作者已经失联了。', true);
        return;
      }
      store.space.setFrontstageCollaboratorId(collaboratorId);
      store.space.clearPendingAttachments();
      store.space.clearPendingCardReference();
      store.chat.setActiveConversation(connection.conversationId);
      ui.setCommandStatus(`已切到 ${connection.label}。`);
      return;
    }
    store.space.setFrontstageCollaboratorId(collaboratorId);
    store.persona.setActiveCollaborator(collaboratorId);
    store.space.setEditingCollaboratorId(collaboratorId);
    const chatState = store.chat.readLatestState();
    const nextConversation = openConversationForCollaborator({
      conversations: selectChatConversations(chatState.conversations),
      personas: store.persona.personas,
      activeCollaboratorId: store.persona.activeCollaboratorId
    }, {
      createConversation: store.chat.createConversation,
      setActiveConversation: store.chat.setActiveConversation,
      clearPendingAttachments: store.space.clearPendingAttachments,
      clearPendingCardReference: store.space.clearPendingCardReference
    }, collaboratorId);
    const personaName = store.persona.personas.find((persona) => persona.id === collaboratorId)?.name ?? collaboratorId;
    ui.setCommandStatus(
      nextConversation.created
        ? `已为 ${personaName} 新开对话。`
        : `已切到 ${personaName} 的最近对话。`
    );
  };

  const deleteCollaborator = (collaboratorId: string) => {
    if (isCompanionCollaboratorId(collaboratorId)) {
      const connection = store.runtime.companionConnections.find((entry) => entry.collaboratorId === collaboratorId) ?? null;
      if (!connection || !ui.confirm(`确认断开 ${connection.label}？这不会删掉电脑端，只会把手机这边的 companion 入口收掉。`)) return;
      void disconnectCompanionConnection(connection.id);
      store.chat.deleteConversation(connection.conversationId);
      if (store.space.frontstageCollaboratorId === collaboratorId) {
        store.space.setFrontstageCollaboratorId(store.persona.activeCollaboratorId);
      }
      ui.setCommandStatus(`已断开 ${connection.label}。`);
      return;
    }
    const activeConversation = derived.activeConversation;
    const persona = store.persona.personas.find((candidate) => candidate.id === collaboratorId);
    if (!persona || !ui.confirm(`确认删除 ${persona.name}？TA 的历史对话会保留在“全部”里，但不再归属于任何协作者。`)) return;

    const nextPersonas = store.persona.personas.filter((candidate) => candidate.id !== collaboratorId);
    const wasActivePersona = store.persona.activeCollaboratorId === collaboratorId;
    const wasCurrentCollaborator = store.space.frontstageCollaboratorId === collaboratorId;
    const chatState = store.chat.readLatestState();
    const cleanup = orphanCollaboratorConversationSessions({
      collaboratorId,
      conversations: selectChatConversations(chatState.conversations),
      personas: nextPersonas,
      activeCollaboratorId: store.persona.activeCollaboratorId,
      activeConversationId: activeConversation?.id ?? null
    }, {
      createConversation: store.chat.createConversation,
      setActiveConversation: store.chat.setActiveConversation,
      clearPendingAttachments: store.space.clearPendingAttachments,
      clearPendingCardReference: store.space.clearPendingCardReference,
      orphanConversation: store.chat.orphanConversation,
      rollbackPreviewForConversationDeletion: store.space.rollbackPreviewForConversationDeletion
    });
    const didDelete = store.persona.deleteCollaborator(collaboratorId);
    if (!didDelete) return;

    if (wasCurrentCollaborator || cleanup.nextConversationId) {
      store.space.setFrontstageCollaboratorId(cleanup.nextCollaboratorId);
    }
    const nextPersonaName = cleanup.nextCollaboratorId
      ? nextPersonas.find((candidate) => candidate.id === cleanup.nextCollaboratorId)?.name ?? '默认人格'
      : '暂无协作者';
    const orphanedConversationHint = cleanup.orphanedConversationIds.length > 0
      ? `，并留下了 ${cleanup.orphanedConversationIds.length} 条未归属历史`
      : '';
    ui.setCommandStatus(
      wasActivePersona
        ? `已删除人格：${persona.name}${orphanedConversationHint}，当前已切回 ${nextPersonaName}。`
        : `已删除人格：${persona.name}${orphanedConversationHint}`
    );
  };

  const createConversation = () => {
    if (!startupReady) {
      return;
    }

    const latestChatState = store.chat.readLatestState();
    const latestPersonaState = store.persona.readLatestState();
    const latestSpaceState = store.space.readLatestState();
    const collaboratorId = resolveDefaultCollaboratorId(
      latestPersonaState.personas,
      latestSpaceState.frontstageCollaboratorId ?? latestPersonaState.activeCollaboratorId
    );
    if (!collaboratorId) {
      ui.setCommandStatus('当前没有可用协作者，先新建一个协作者再开始对话。', true);
      return;
    }
    const conversationId = store.chat.createConversation(collaboratorId);
    store.space.clearPendingAttachments();
    store.space.clearPendingCardReference();
    store.chat.setActiveConversation(conversationId);
  };

  return {
    handleSubmit,
    commitMessageEdit,
    retryLatestAssistant,
    updateAssistantMessage,
    cacheAssistantSpeech,
    forkConversationFromMessage,
    selectPersona,
    deleteCollaborator,
    createConversation
  };
}
