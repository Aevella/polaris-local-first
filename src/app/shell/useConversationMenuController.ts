import { resolvePersonaProviderBinding } from '../../engines/personaProviderBinding';
import { selectVisibleProviders, selectRuntimeApi } from '../../stores/runtimeStore';
import { discoverProviderModels, type ProviderModelOption } from '../../engines/providerModelDiscovery';
import { useRuntimeStore } from '../../stores/runtimeStore';
import { resolvePersonaMcpServers } from '../persona/personaMcpSettings';
import { normalizeConversationWindowPreferences } from '../../engines/conversationWindowSettings';
import { useEffect, useState, useCallback, useRef } from 'react';
import { useChatStore } from '../../stores/chatStore';
import { usePersonaStore } from '../../stores/personaStore';
import { useSpaceStore } from '../../stores/spaceStore';
import { createConversationWindowSettings } from '../../engines/conversationContextSettings';
import type { ConversationReasoningStrength, ConversationRequestContext, ConversationWindowPreferences } from '../../types/domain';

export function useConversationMenuController(onCreateConversation?: () => void, conversationId?: string) {
  const [open, setOpen] = useState(false);
  const [defaultsSaved, setDefaultsSaved] = useState(false);
  const [modelList, setModelList] = useState<{ key: string; loading: boolean; models: ProviderModelOption[]; loaded?: boolean; error?: string }>({ key: '', loading: false, models: [] });
  const modelRequest = useRef(0);
  useEffect(() => () => { modelRequest.current += 1; }, []);
  const materializedId = useRef<string | null>(null);
  const activeId = useChatStore((state) => conversationId ?? state.activeConversationId);
  const conversation = useChatStore((state) => state.conversations.find((item) => item.id === activeId) ?? null);
  const frontstageId = useSpaceStore((state) => state.frontstageCollaboratorId);
  const persona = usePersonaStore((state) => state.personas.find(item => item.id === (conversation ? conversation.collaboratorId : frontstageId ?? state.activeCollaboratorId)) ?? null);
  const providerProfiles = useRuntimeStore(state => state.providers);
  const activeProviderId = useRuntimeStore(state => state.activeProviderId);
  const providers = selectVisibleProviders({ providers: providerProfiles });
  const globalApi = selectRuntimeApi({ providers: providerProfiles, activeProviderId });
  const servers = useRuntimeStore(state => state.mcpServers);
  const mcpServers = resolvePersonaMcpServers({ persona, mcpServers: servers }).filter(server => server.isActive);
  const settings = conversation
    ? { windowPreferences: normalizeConversationWindowPreferences(conversation.windowPreferences), requestContext: conversation.requestContext ?? { mode: 'inherit' as const }, reasoningStrength: conversation.reasoningStrength ?? 'automatic' as const }
    : createConversationWindowSettings(persona?.conversationDefaults);
  const providerBinding = resolvePersonaProviderBinding({ persona, providers, globalApi, windowBinding: settings.windowPreferences?.modelBinding });
  const selectedProvider = settings.windowPreferences?.modelBinding ? providers.find(provider => provider.id === settings.windowPreferences?.modelBinding?.providerId) ?? null : null;
  const modelListKey = JSON.stringify([activeId, selectedProvider?.id, selectedProvider?.baseUrl, selectedProvider?.protocol, selectedProvider?.path]);
  useEffect(() => {
    if (!conversationId && activeId !== materializedId.current) setOpen(false);
    materializedId.current = null;
    setDefaultsSaved(false);
  }, [activeId, conversationId]);
  const onOpen = useCallback(() => { setDefaultsSaved(false); setOpen(true); }, []);
  // First edit creates the actual durable empty window, preserving its unsent text.
  const ensureConversation = () => {
    if (conversation) return conversation.id;
    if (conversationId || !persona) return null;
    const chat = useChatStore.getState();
    const id = chat.createConversation(persona.id, {
      draft: chat.inputDraft
    });
    materializedId.current = id;
    return id;
  };
  return {
    open, conversation, settings, defaultsSaved, mcpServers, providers, providerBinding,
    modelList: modelList.key === modelListKey ? modelList : { loading: false, models: [] },
    onFetchModels: async () => {
      if (!selectedProvider) return;
      const request = ++modelRequest.current;
      setModelList({ key: modelListKey, loading: true, models: [] });
      try {
        const result = await discoverProviderModels({ api: selectedProvider });
        if (request !== modelRequest.current) return;
        setModelList(result.ok ? { key: modelListKey, loading: false, loaded: true, models: result.models } : { key: modelListKey, loading: false, models: [], error: result.error });
      } catch (error) {
        if (request === modelRequest.current) setModelList({ key: modelListKey, loading: false, models: [], error: error instanceof Error ? error.message : String(error) });
      }
    },
    editable: true && Boolean(conversation || (!conversationId && persona)),
    canSaveDefaults: true && Boolean(persona) && conversation?.kind !== 'group',
    canCreate: Boolean(onCreateConversation), onOpen,
    onClose: () => setOpen(false),
    onCreate: () => { setOpen(false); onCreateConversation?.(); },
    onRename: (title: string) => { if (conversation && title.trim()) useChatStore.getState().renameConversation(conversation.id, title.trim()); },
    onTogglePin: () => { if (conversation) useChatStore.getState().toggleConversationPinned(conversation.id); },
    onSetContext: (context: ConversationRequestContext) => {
      const id = ensureConversation();
      if (id) useChatStore.getState().setConversationRequestContext(id, context);
      setDefaultsSaved(false);
    },
    onSetPreferences: (patch: Partial<ConversationWindowPreferences>) => {
      const id = ensureConversation();
      if (id) useChatStore.getState().setConversationWindowPreferences(id, patch);
      setDefaultsSaved(false);
    },
    onSetReasoning: (strength: ConversationReasoningStrength) => {
      const id = ensureConversation();
      if (id) useChatStore.getState().setConversationReasoningStrength(id, strength);
      setDefaultsSaved(false);
    },
    onSaveDefaults: () => {
      if (!persona || conversation?.kind === 'group') return;
      usePersonaStore.getState().updateCollaborator(persona.id, { conversationDefaults: createConversationWindowSettings(settings) });
      setDefaultsSaved(true);
    }
  };
}
