import { getDefaultProviderPath } from '../engines/providerProtocol';
import type { AssetExportEntry } from '../infrastructure/assetStore';
import type { PersistedKvEntry } from '../infrastructure/persistence';
import { createPersonaTemplate } from '../config/persona/personaBuilder';
import type {
  ChatAttachment,
  ChatMessage,
  Conversation,
  McpServerConfig,
  Persona,
  ProviderProfile
} from '../types/domain';
import { normalizeRuntimePayload } from './runtimeStorePersistence';
import { normalizeMcpServer } from './runtimeStoreMcp';
import type { RegexTriggerRule } from '../engines/regexTriggerProcessor';
import { serializeChatStateEntries } from './chatCurrentPersistence';
import type { PersistedCollectionState } from './collectionStorePersistence';
import type { PersistedSpaceState } from './spaceStorePersistence';
import {
  SPACE_THEME_STATE_KEY,
  migratePersistedSpaceState,
  serializePersistedSpaceLocalState,
  serializePersistedSpaceThemeState
} from './spaceStorePersistence';
import { SPACE_STORE_KEY, SPACE_STORE_VERSION, type StructuredExportSnapshot } from './storeExportPackage';
import type { ImportLocalStorageEntry } from './storeImportPackage';
import type { StoreImportProgressReporter } from './storeImportProgress';

type ZipBinaryType = 'arraybuffer';
type KelivoZipFile = {
  async(type: 'string'): Promise<string>;
  async(type: ZipBinaryType): Promise<ArrayBuffer>;
};

type KelivoZip = {
  file: (path: string) => KelivoZipFile | null;
  forEach: (callback: (relativePath: string, file: { dir: boolean; name: string }) => void) => void;
};

type KelivoSettings = Record<string, unknown>;
type KelivoProviderConfig = Record<string, unknown>;
type KelivoAssistant = Record<string, unknown>;
type KelivoConversation = Record<string, unknown>;
type KelivoMessage = Record<string, unknown>;
type KelivoMcpServer = Record<string, unknown>;
type KelivoInstructionInjection = Record<string, unknown>;
type KelivoWorldBook = Record<string, unknown>;
type KelivoWorldBookEntry = Record<string, unknown>;

export type KelivoImportConversion = {
  kvEntries: PersistedKvEntry[];
  localStorageEntries: ImportLocalStorageEntry[];
  assetEntries: AssetExportEntry[];
  stats: {
    conversations: number;
    messages: number;
    personas: number;
    providers: number;
    mcpServers: number;
    skippedMcpServers: number;
    assets: number;
  };
};

export type KelivoStructuredExportConversion = {
  snapshot: StructuredExportSnapshot;
  stats: KelivoImportConversion['stats'];
};

type AssetReference = {
  id: string;
  path: string;
  name: string;
  kind: 'image' | 'file';
  mimeType: string;
  size: number;
  createdAt: number;
};

type AssetRegistry = {
  byPath: Map<string, AssetReference>;
  entries: AssetExportEntry[];
};

type KelivoChatState = {
  conversations: Conversation[];
  activeConversationId: string | null;
};

const KELIVO_SETTINGS_PATH = 'settings.json';
const KELIVO_CHATS_PATH = 'chats.json';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function parseJson<T>(content: string, label: string): T {
  try {
    return JSON.parse(content) as T;
  } catch {
    throw new Error(`${label} 格式不正确`);
  }
}

function decodeKelivoPreference(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed) return value;
  if (
    !trimmed.startsWith('{')
    && !trimmed.startsWith('[')
    && trimmed !== 'true'
    && trimmed !== 'false'
    && trimmed !== 'null'
    && !/^-?\d+(?:\.\d+)?$/.test(trimmed)
  ) {
    return value;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function readSetting(settings: KelivoSettings, key: string): unknown {
  return decodeKelivoPreference(settings[key]);
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function readBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
  }
  return fallback;
}

function readStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => readStringList(item));
  }
  const text = readString(value);
  if (!text) return [];
  return text
    .split(/[\n,，]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseTimestamp(value: unknown, fallback: number): number {
  const numeric = readNumber(value);
  if (numeric !== null) {
    return numeric > 10_000_000_000 ? numeric : numeric * 1000;
  }
  const text = readString(value);
  if (text) {
    const parsed = Date.parse(text);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function safeJson(value: unknown): string {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value === 'string') return value;
  return JSON.stringify(value, null, 2);
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function sanitizeIdFragment(value: string) {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return normalized.slice(0, 48) || 'item';
}

function basename(path: string) {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

function inferMimeType(path: string) {
  const extension = basename(path).split('.').pop()?.toLowerCase() ?? '';
  switch (extension) {
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'webp':
      return 'image/webp';
    case 'gif':
      return 'image/gif';
    case 'svg':
      return 'image/svg+xml';
    case 'pdf':
      return 'application/pdf';
    case 'txt':
    case 'md':
      return 'text/plain';
    case 'json':
      return 'application/json';
    default:
      return 'application/octet-stream';
  }
}

function isImageMimeType(mimeType: string) {
  return mimeType.startsWith('image/');
}

function normalizeZipPath(path: string) {
  return path.replace(/^\/+/, '').replace(/\\/g, '/');
}

function buildAssetId(path: string) {
  return `kelivo-asset-${sanitizeIdFragment(basename(path))}-${stableHash(path)}`;
}

function resolveZipAssetPath(registry: AssetRegistry, value: unknown): string | null {
  const text = readString(value);
  if (!text) return null;
  const normalized = normalizeZipPath(text);
  if (registry.byPath.has(normalized)) return normalized;
  const fileName = basename(normalized);
  if (!fileName) return null;
  for (const path of registry.byPath.keys()) {
    if (path === fileName || path.endsWith(`/${fileName}`)) {
      return path;
    }
  }
  return null;
}

function attachmentForAsset(asset: AssetReference, messageId: string, index: number): ChatAttachment {
  return {
    id: `kelivo-attachment-${sanitizeIdFragment(messageId)}-${index + 1}`,
    assetId: asset.id,
    kind: asset.kind,
    name: asset.name,
    mimeType: asset.mimeType,
    size: asset.size
  };
}

function collectMessageAttachments(
  registry: AssetRegistry,
  message: KelivoMessage,
  messageId: string
): ChatAttachment[] {
  const content = readString(message.content);
  if (!content) return [];
  const matched: AssetReference[] = [];
  for (const asset of registry.byPath.values()) {
    if (!asset.path.startsWith('upload/')) continue;
    if (content.includes(asset.path) || content.includes(asset.name)) {
      matched.push(asset);
    }
  }
  return matched.map((asset, index) => attachmentForAsset(asset, messageId, index));
}

async function buildAssetRegistry(zip: KelivoZip, onProgress?: StoreImportProgressReporter): Promise<AssetRegistry> {
  const assetPaths: string[] = [];
  zip.forEach((relativePath, file) => {
    if (file.dir) return;
    const normalized = normalizeZipPath(relativePath);
    if (
      normalized.startsWith('upload/')
      || normalized.startsWith('images/')
      || normalized.startsWith('avatars/')
    ) {
      assetPaths.push(normalized);
    }
  });

  const byPath = new Map<string, AssetReference>();
  const entries: AssetExportEntry[] = [];
  let completed = 0;
  for (const path of assetPaths) {
    const file = zip.file(path);
    if (!file) continue;
    const mimeType = inferMimeType(path);
    const blob = new Blob([await file.async('arraybuffer')], { type: mimeType });
    const asset: AssetReference = {
      id: buildAssetId(path),
      path,
      name: basename(path),
      kind: isImageMimeType(mimeType) ? 'image' : 'file',
      mimeType,
      size: blob.size,
      createdAt: Date.now()
    };
    byPath.set(path, asset);
    entries.push({
      meta: {
        id: asset.id,
        kind: asset.kind,
        name: asset.name,
        mimeType: asset.mimeType,
        size: asset.size,
        createdAt: asset.createdAt
      },
      blob,
      previewBlob: asset.kind === 'image' ? blob : null
    });
    completed += 1;
    onProgress?.({ message: '读取 Kelivo 附件', current: completed, total: assetPaths.length });
  }

  return { byPath, entries };
}

function normalizeProviderBaseAndPath(provider: KelivoProviderConfig, protocol: ProviderProfile['protocol']) {
  const chatPath = readString(provider.chatPath);
  let baseUrl = readString(provider.baseUrl);
  let path = chatPath || getDefaultProviderPath(protocol);

  if (!chatPath && protocol === 'anthropic-messages' && /\/messages\/?$/.test(baseUrl)) {
    baseUrl = baseUrl.replace(/\/messages\/?$/, '');
    path = '/messages';
  }
  if (!chatPath && protocol === 'openai-responses' && /\/responses\/?$/.test(baseUrl)) {
    baseUrl = baseUrl.replace(/\/responses\/?$/, '');
    path = '/responses';
  }
  if (!path.startsWith('/')) {
    path = `/${path}`;
  }

  return { baseUrl, path };
}

function inferProviderProtocol(provider: KelivoProviderConfig): ProviderProfile['protocol'] {
  if (readBoolean(provider.useResponseApi)) return 'openai-responses';
  const type = readString(provider.providerType).toLowerCase();
  const name = readString(provider.name).toLowerCase();
  const id = readString(provider.id).toLowerCase();
  const path = readString(provider.chatPath).toLowerCase();
  const baseUrl = readString(provider.baseUrl).toLowerCase();
  const haystack = `${type} ${name} ${id} ${path} ${baseUrl}`;
  if (haystack.includes('gemini') || haystack.includes('google') || readBoolean(provider.vertexAI)) {
    return 'gemini-generate-content';
  }
  if (haystack.includes('anthropic') || haystack.includes('claude') || path.replace(/^\/+/, '') === 'messages') {
    return 'anthropic-messages';
  }
  return 'openai-completions';
}

function selectProviderModel(provider: KelivoProviderConfig) {
  const models = Array.isArray(provider.models) ? provider.models : [];
  const firstModel = models.find((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);
  return firstModel?.trim() ?? '';
}

function selectProviderApiKey(provider: KelivoProviderConfig) {
  const primary = readString(provider.apiKey);
  if (primary) return primary;
  const apiKeys = Array.isArray(provider.apiKeys) ? provider.apiKeys : [];
  for (const entry of apiKeys) {
    if (!isRecord(entry)) continue;
    if (entry.enabled === false) continue;
    const key = readString(entry.key ?? entry.value ?? entry.apiKey);
    if (key) return key;
  }
  return '';
}

function buildProviders(settings: KelivoSettings) {
  const rawProviders = readSetting(settings, 'provider_configs_v1');
  const providerEntries = isRecord(rawProviders)
    ? Object.entries(rawProviders).filter((entry): entry is [string, KelivoProviderConfig] => isRecord(entry[1]))
    : [];
  const order = readSetting(settings, 'providers_order_v1');
  const orderIds = Array.isArray(order)
    ? order.filter((item): item is string => typeof item === 'string')
    : [];
  const orderIndex = new Map(orderIds.map((id, index) => [id, index]));

  const providers = providerEntries
    .sort(([leftKey, left], [rightKey, right]) => {
      const leftOrder = orderIndex.get(readString(left.id) || leftKey) ?? Number.MAX_SAFE_INTEGER;
      const rightOrder = orderIndex.get(readString(right.id) || rightKey) ?? Number.MAX_SAFE_INTEGER;
      return leftOrder - rightOrder;
    })
    .map(([fallbackId, provider], index): ProviderProfile => {
      const id = readString(provider.id) || fallbackId || `kelivo-provider-${index + 1}`;
      const protocol = inferProviderProtocol(provider);
      const { baseUrl, path } = normalizeProviderBaseAndPath(provider, protocol);
      return {
        id,
        name: readString(provider.name) || id,
        protocol,
        baseUrl,
        path,
        apiKey: selectProviderApiKey(provider),
        model: selectProviderModel(provider),
        capabilities: {
          images: false,
          streaming: true,
          thinking: true
        }
      };
    });

  const selectedModel = readString(readSetting(settings, 'selected_model_v1'));
  const [selectedProviderId, selectedModelId] = selectedModel.includes('::')
    ? selectedModel.split('::', 2)
    : ['', ''];
  const patchedProviders = selectedProviderId && selectedModelId
    ? providers.map((provider) =>
        provider.id === selectedProviderId || provider.name === selectedProviderId
          ? { ...provider, model: selectedModelId }
          : provider
      )
    : providers;

  const activeProviderId =
    patchedProviders.find((provider) => provider.id === selectedProviderId || provider.name === selectedProviderId)?.id
    ?? patchedProviders[0]?.id
    ?? null;

  return { providers: patchedProviders, activeProviderId };
}

function buildMcpServers(settings: KelivoSettings) {
  const rawServers = readSetting(settings, 'mcp_servers_v1');
  const servers = Array.isArray(rawServers) ? rawServers.filter(isRecord) as KelivoMcpServer[] : [];
  const converted: McpServerConfig[] = [];
  let skipped = 0;

  for (const server of servers) {
    const transport = readString(server.transport).toLowerCase();
    if (transport !== 'http' && transport !== 'streamable-http' && transport !== 'sse') {
      skipped += 1;
      continue;
    }
    const url = readString(server.url);
    if (!url) {
      skipped += 1;
      continue;
    }
    converted.push(normalizeMcpServer({
      id: readString(server.id) || undefined,
      name: readString(server.name) || undefined,
      transport: transport === 'sse' ? 'sse' : 'streamable-http',
      url,
      headers: isRecord(server.headers)
        ? Object.entries(server.headers).map(([key, value], index) => ({
            id: `kelivo-header-${index + 1}`,
            key,
            value: typeof value === 'string' ? value : String(value ?? '')
          }))
        : [],
      isActive: readBoolean(server.enabled, true)
    }));
  }

  return { mcpServers: converted, skippedMcpServers: skipped };
}

function buildPersonaSnippets(
  assistant: KelivoAssistant,
  activeInjections: string[],
  injectionsById: Map<string, KelivoInstructionInjection>
) {
  const snippets: string[] = [];
  const presetMessages = Array.isArray(assistant.presetMessages) ? assistant.presetMessages : [];
  if (presetMessages.length > 0) {
    snippets.push(`Kelivo preset messages:\n${safeJson(presetMessages)}`);
  }
  for (const injectionId of activeInjections) {
    const injection = injectionsById.get(injectionId);
    if (!injection) continue;
    const title = readString(injection.title) || readString(injection.name) || 'Kelivo instruction';
    const prompt = readString(injection.prompt ?? injection.content ?? injection.instruction ?? injection.text);
    if (prompt) snippets.push(`${title}\n${prompt}`);
  }
  return snippets;
}

function escapeRegexLiteral(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function readActiveWorldBookIdsForAssistant(
  activeWorldBookMap: unknown,
  assistantId: string
) {
  if (!isRecord(activeWorldBookMap)) return [];
  const own = Array.isArray(activeWorldBookMap[assistantId])
    ? activeWorldBookMap[assistantId]
    : undefined;
  const fallback = Array.isArray(activeWorldBookMap.__global__)
    ? activeWorldBookMap.__global__
    : undefined;
  return (own ?? fallback ?? [])
    .map((entry) => readString(entry))
    .filter(Boolean);
}

function convertKelivoWorldBookEntryToTrigger(entry: KelivoWorldBookEntry): RegexTriggerRule | null {
  if (!readBoolean(entry.enabled, true)) return null;
  const prompt = readString(entry.content);
  if (!prompt) return null;

  const keywords = Array.from(new Set(readStringList(entry.keywords)));
  const alwaysOn = readBoolean(entry.constantActive);
  if (!keywords.length && !alwaysOn) return null;

  const useRegex = readBoolean(entry.useRegex);
  const caseSensitive = readBoolean(entry.caseSensitive);
  const scanDepth = readNumber(entry.scanDepth);
  const priority = readNumber(entry.priority);

  return {
    pattern: useRegex ? keywords.join('|') : keywords.map(escapeRegexLiteral).join('|'),
    prompt,
    flags: caseSensitive ? '' : 'i',
    ...(scanDepth !== null && scanDepth > 0 ? { scanDepth: Math.floor(scanDepth) } : {}),
    ...(alwaysOn ? { alwaysOn: true } : {}),
    ...(priority !== null ? { priority: Math.trunc(priority) } : {})
  };
}

function buildPersonaWorldBookTriggers(
  assistantId: string,
  worldBooks: KelivoWorldBook[],
  activeWorldBookMap: unknown
) {
  const activeIds = readActiveWorldBookIdsForAssistant(activeWorldBookMap, assistantId);
  if (!activeIds.length) return '';

  const activeIdSet = new Set(activeIds);
  const triggers: RegexTriggerRule[] = [];
  for (const book of worldBooks) {
    const bookId = readString(book.id);
    if (!bookId || !activeIdSet.has(bookId) || !readBoolean(book.enabled, true)) continue;
    const rawEntries = Array.isArray(book.entries) ? book.entries.filter(isRecord) as KelivoWorldBookEntry[] : [];
    for (const entry of rawEntries) {
      const trigger = convertKelivoWorldBookEntryToTrigger(entry);
      if (trigger) triggers.push(trigger);
    }
  }

  return triggers.length ? JSON.stringify(triggers, null, 2) : '';
}

function buildPersonas(
  settings: KelivoSettings,
  registry: AssetRegistry,
  providers: ProviderProfile[]
) {
  const rawAssistants = readSetting(settings, 'assistants_v1');
  const assistants = Array.isArray(rawAssistants) ? rawAssistants.filter(isRecord) as KelivoAssistant[] : [];
  const rawMemories = readSetting(settings, 'assistant_memories_v1');
  const memories = Array.isArray(rawMemories) ? rawMemories.filter(isRecord) : [];
  const memoriesByAssistant = new Map<string, string[]>();
  for (const memory of memories) {
    const assistantId = readString(memory.assistantId);
    const content = readString(memory.content);
    if (!assistantId || !content) continue;
    memoriesByAssistant.set(assistantId, [...(memoriesByAssistant.get(assistantId) ?? []), content]);
  }

  const rawInjections = readSetting(settings, 'instruction_injections_v1');
  const injections = Array.isArray(rawInjections) ? rawInjections.filter(isRecord) as KelivoInstructionInjection[] : [];
  const injectionsById = new Map(injections.map((injection) => [readString(injection.id), injection]).filter((entry): entry is [string, KelivoInstructionInjection] => Boolean(entry[0])));
  const activeInjectionMap = readSetting(settings, 'instruction_injections_active_ids_by_assistant_v1');
  const rawWorldBooks = readSetting(settings, 'world_books_v1');
  const worldBooks = Array.isArray(rawWorldBooks) ? rawWorldBooks.filter(isRecord) as KelivoWorldBook[] : [];
  const activeWorldBookMap = readSetting(settings, 'world_books_active_ids_by_assistant_v1');
  const userName = readString(readSetting(settings, 'user_name'));
  const userAvatarPath = resolveZipAssetPath(registry, readSetting(settings, 'avatar_value'));
  const userAvatarAssetId = userAvatarPath ? registry.byPath.get(userAvatarPath)?.id ?? null : null;
  const providerIds = new Set(providers.map((provider) => provider.id));

  const backgroundAssetByPersona = new Map<string, string>();
  const personas = assistants.map((assistant, index): Persona => {
    const id = readString(assistant.id) || `kelivo-persona-${index + 1}`;
    const avatarPath = resolveZipAssetPath(registry, assistant.avatar);
    const backgroundPath = resolveZipAssetPath(registry, assistant.background);
    const assistantAvatarAssetId = avatarPath ? registry.byPath.get(avatarPath)?.id ?? null : null;
    const backgroundAssetId = backgroundPath ? registry.byPath.get(backgroundPath)?.id ?? null : null;
    if (backgroundAssetId) {
      backgroundAssetByPersona.set(id, backgroundAssetId);
    }
    const providerId = readString(assistant.chatModelProvider);
    const activeInjections = isRecord(activeInjectionMap) && Array.isArray(activeInjectionMap[id])
      ? (activeInjectionMap[id] as unknown[]).filter((entry): entry is string => typeof entry === 'string')
      : [];

    return createPersonaTemplate({
      id,
      name: readString(assistant.name) || `Kelivo 协作者 ${index + 1}`,
      description: '从 Kelivo 备份迁移',
      assistantAvatarAssetId: readBoolean(assistant.useAssistantAvatar, true) ? assistantAvatarAssetId : null,
      userAvatarAssetId,
      userName,
      purpose: readString(assistant.systemPrompt).slice(0, 160),
      compiledPrompt: readString(assistant.systemPrompt),
      builderManaged: false,
      generatedPromptMode: 'off',
      messageTemplate: readString(assistant.messageTemplate) || '{{ message }}',
      baseId: 'custom',
      relationship: 'partner',
      expression: 'natural',
      memory: {
        inheritGlobal: true,
        crossConversationRecallEnabled: readBoolean(assistant.enableRecentChatsReference, true),
        personalMemories: memoriesByAssistant.get(id) ?? []
      },
      advanced: {
        providerId: providerIds.has(providerId) ? providerId : '',
        modelOverride: readString(assistant.chatModelId),
        temperature: readString(assistant.temperature),
        topP: readString(assistant.topP),
        maxTokens: readString(assistant.maxTokens),
        thinkingBudget: readString(assistant.thinkingBudget),
        contextMessageLimit: readBoolean(assistant.limitContextMessages)
          ? readString(assistant.contextMessageSize)
          : '',
        showThinking: true,
        streaming: readBoolean(assistant.streamOutput, true),
        customHeaders: safeJson(assistant.customHeaders),
        customBody: safeJson(assistant.customBody),
        regexRules: safeJson(assistant.regexRules),
        regexTriggers: buildPersonaWorldBookTriggers(id, worldBooks, activeWorldBookMap),
        snippets: buildPersonaSnippets(assistant, activeInjections, injectionsById)
      },
      version: 1
    });
  });

  return {
    personas,
    activeCollaboratorId: readString(readSetting(settings, 'current_assistant_id_v1')) || (personas[0]?.id ?? null),
    backgroundAssetByPersona,
    userName
  };
}

function createRecoveredKelivoPersona(id: string, index: number, userName: string): Persona {
  return createPersonaTemplate({
    id,
    name: `Kelivo 导入协作者 ${index + 1}`,
    description: '从 Kelivo 备份恢复',
    purpose: 'Kelivo 备份里的对话仍然指向这个 assistant id，但 assistants 列表里没有对应角色。Polaris 为它补建了可编辑协作者，避免导入后的对话悬空。',
    userName,
    baseId: 'custom',
    relationship: 'partner',
    expression: 'natural',
    builderManaged: false,
    compiledPrompt: '',
    generatedPromptMode: 'off',
    version: 1
  });
}

function reconcileKelivoPersonaOwners(args: {
  personas: Persona[];
  activeCollaboratorId: string | null;
  chatState: KelivoChatState;
  userName: string;
}) {
  const knownPersonaIds = new Set(args.personas.map((persona) => persona.id));
  const requiredPersonaIds: string[] = [];
  const addRequiredPersonaId = (value: string | null | undefined) => {
    const id = value?.trim();
    if (!id || knownPersonaIds.has(id) || requiredPersonaIds.includes(id)) return;
    requiredPersonaIds.push(id);
  };

  addRequiredPersonaId(args.activeCollaboratorId);
  for (const conversation of args.chatState.conversations) {
    addRequiredPersonaId(conversation.collaboratorId);
  }

  const recoveredPersonas = requiredPersonaIds.map((id, index) =>
    createRecoveredKelivoPersona(id, index, args.userName)
  );
  const personas = [...args.personas, ...recoveredPersonas];
  const personaIds = new Set(personas.map((persona) => persona.id));
  const activeCollaboratorId = args.activeCollaboratorId && personaIds.has(args.activeCollaboratorId)
    ? args.activeCollaboratorId
    : personas[0]?.id ?? null;

  return {
    personas,
    activeCollaboratorId
  };
}

function parseKelivoChats(rawChats: unknown) {
  if (!isRecord(rawChats)) {
    return { conversations: [], messages: [] };
  }
  return {
    conversations: Array.isArray(rawChats.conversations)
      ? rawChats.conversations.filter(isRecord) as KelivoConversation[]
      : [],
    messages: Array.isArray(rawChats.messages)
      ? rawChats.messages.filter(isRecord) as KelivoMessage[]
      : []
  };
}

function buildChatMessage(
  message: KelivoMessage,
  registry: AssetRegistry
): ChatMessage | null {
  const id = readString(message.id);
  const role = readString(message.role);
  if (!id || (role !== 'user' && role !== 'assistant' && role !== 'system')) return null;
  const timestamp = parseTimestamp(message.timestamp, Date.now());
  const totalTokens = readNumber(message.totalTokens);
  const promptTokens = readNumber(message.promptTokens);
  const completionTokens = readNumber(message.completionTokens);
  const cachedTokens = readNumber(message.cachedTokens);
  const attachments = collectMessageAttachments(registry, message, id);
  const thinkingText = readString(message.reasoningText) || readString(message.reasoningSegmentsJson);

  return {
    id,
    role,
    content: readString(message.content),
    timestamp,
    origin: role === 'user' ? 'user-input' : role === 'assistant' ? 'assistant-reply' : 'system-note',
    requestRole: role,
    requestContent: readString(message.content),
    attachments: attachments.length ? attachments : undefined,
    providerId: readString(message.providerId) || undefined,
    model: readString(message.modelId) || undefined,
    tokenCount: totalTokens ?? undefined,
    tokenUsage: totalTokens !== null || promptTokens !== null || completionTokens !== null || cachedTokens !== null
      ? {
          totalTokens: totalTokens ?? undefined,
          inputTokens: promptTokens ?? undefined,
          outputTokens: completionTokens ?? undefined,
          cachedInputTokens: cachedTokens ?? undefined
        }
      : undefined,
    thinkingText: thinkingText || undefined
  };
}

function buildChatState(rawChats: unknown, registry: AssetRegistry): KelivoChatState {
  const { conversations: kelivoConversations, messages: kelivoMessages } = parseKelivoChats(rawChats);
  const messagesByConversation = new Map<string, ChatMessage[]>();
  for (const rawMessage of kelivoMessages) {
    const conversationId = readString(rawMessage.conversationId);
    const message = buildChatMessage(rawMessage, registry);
    if (!conversationId || !message) continue;
    messagesByConversation.set(conversationId, [...(messagesByConversation.get(conversationId) ?? []), message]);
  }

  const conversations: Conversation[] = kelivoConversations.map((conversation, index) => {
    const id = readString(conversation.id) || `kelivo-conversation-${index + 1}`;
    const updatedAt = parseTimestamp(conversation.updatedAt ?? conversation.createdAt, Date.now());
    const messageIds = Array.isArray(conversation.messageIds)
      ? conversation.messageIds.filter((entry): entry is string => typeof entry === 'string')
      : [];
    const order = new Map(messageIds.map((messageId, orderIndex) => [messageId, orderIndex]));
    const messages = [...(messagesByConversation.get(id) ?? [])].sort((left, right) => {
      const leftOrder = order.get(left.id) ?? Number.MAX_SAFE_INTEGER;
      const rightOrder = order.get(right.id) ?? Number.MAX_SAFE_INTEGER;
      if (leftOrder !== rightOrder) return leftOrder - rightOrder;
      return left.timestamp - right.timestamp;
    });
    return {
      id,
      title: readString(conversation.title) || 'Kelivo 对话',
      collaboratorId: readString(conversation.assistantId) || null,
      messages,
      toolLedger: [],
      workspaceLedger: [],
      task: null,
      pinnedAt: readBoolean(conversation.isPinned) ? updatedAt : null,
      updatedAt
    };
  });

  return {
    conversations,
    activeConversationId: conversations[0]?.id ?? null
  };
}

function buildCollectionState(): PersistedCollectionState {
  return {
    cards: [],
    projectFiles: [],
    workspaceReferenceDocs: [],
    roomProjects: [],
    imageCards: [],
    deletedBundledCardIds: []
  };
}

function buildSpaceState(
  activeCollaboratorId: string | null,
  backgroundAssetByPersona: Map<string, string>,
  settings: KelivoSettings
): PersistedSpaceState {
  return {
    activeWorld: 'chat',
    collectionShelf: 'dialogue',
    frontstageCollaboratorId: activeCollaboratorId,
    collectionProjectId: null,
    editingCollaboratorId: null,
    screenshotDebugOverlayEnabled: false,
    displayPreferences: {
      hapticsEnabled: readBoolean(readSetting(settings, 'display_haptics_global_enabled_v1'), true),
      fontScale: 1
    },
    activeCardId: null,
    collaboratorThemes: Object.fromEntries(
      Array.from(backgroundAssetByPersona.entries()).map(([personaId, backgroundAssetId]) => [
        personaId,
        {
          customization: {
            backgroundAssetId,
            showChatAvatars: true
          }
        }
      ])
    )
  };
}

async function readKelivoSettings(zip: KelivoZip) {
  const settingsFile = zip.file(KELIVO_SETTINGS_PATH);
  if (!settingsFile) {
    throw new Error('Kelivo 备份缺少 settings.json');
  }
  const settings = parseJson<KelivoSettings>(await settingsFile.async('string'), KELIVO_SETTINGS_PATH);
  if (!isRecord(settings)) {
    throw new Error('Kelivo settings.json 格式不正确');
  }
  return settings;
}

async function readKelivoChats(zip: KelivoZip) {
  const chatsFile = zip.file(KELIVO_CHATS_PATH);
  if (!chatsFile) return null;
  return parseJson<unknown>(await chatsFile.async('string'), KELIVO_CHATS_PATH);
}

async function loadKelivoZip(file: Blob): Promise<KelivoZip> {
  const { default: JSZip } = await import('jszip');
  return await JSZip.loadAsync(await file.arrayBuffer()) as KelivoZip;
}

function isKelivoZipShape(zip: KelivoZip) {
  return Boolean(zip.file(KELIVO_SETTINGS_PATH)) && !zip.file('manifest.json');
}

export async function isKelivoBackupZip(file: Blob): Promise<boolean> {
  try {
    const zip = await loadKelivoZip(file);
    return isKelivoZipShape(zip);
  } catch {
    return false;
  }
}

export async function convertKelivoBackupZip(
  file: Blob,
  options: { onProgress?: StoreImportProgressReporter } = {}
): Promise<KelivoImportConversion> {
  const converted = await convertKelivoBackupToStructuredExportSnapshot(file, options);
  return convertKelivoStructuredExportToImportConversion(converted);
}

function convertKelivoStructuredExportToImportConversion(
  converted: KelivoStructuredExportConversion
): KelivoImportConversion {
  const spaceState = migratePersistedSpaceState(converted.snapshot.spaceState ?? {});
  const chatState = converted.snapshot.chatState ?? { conversations: [], activeConversationId: null };
  const collectionState = converted.snapshot.collectionState ?? buildCollectionState();
  const personaState = converted.snapshot.personaState ?? {
    personas: [],
    activeCollaboratorId: null,
    seededDefaultPersonaIds: []
  };
  const runtimeState = normalizeRuntimePayload(converted.snapshot.runtimeState);

  const kvEntries: PersistedKvEntry[] = [
    ...serializeChatStateEntries(chatState),
    { key: 'collection-state-v2', value: collectionState },
    { key: 'persona-state-v2', value: personaState },
    { key: 'runtime-providers-v2', value: runtimeState },
    {
      key: SPACE_THEME_STATE_KEY,
      value: serializePersistedSpaceThemeState(spaceState)
    }
  ];

  return {
    kvEntries,
    localStorageEntries: [{
      key: SPACE_STORE_KEY,
      value: JSON.stringify({
        state: serializePersistedSpaceLocalState(spaceState),
        version: SPACE_STORE_VERSION
      })
    }],
    assetEntries: converted.snapshot.assetEntries ?? [],
    stats: converted.stats
  };
}

export async function convertKelivoBackupToStructuredExportSnapshot(
  file: Blob,
  options: { onProgress?: StoreImportProgressReporter } = {}
): Promise<KelivoStructuredExportConversion> {
  const zip = await loadKelivoZip(file);
  return await convertKelivoZipToStructuredExportSnapshot(zip, options);
}

async function convertKelivoZipToStructuredExportSnapshot(
  zip: KelivoZip,
  options: { onProgress?: StoreImportProgressReporter } = {}
): Promise<KelivoStructuredExportConversion> {
  options.onProgress?.({ message: '读取 Kelivo 备份' });
  const settings = await readKelivoSettings(zip);
  const rawChats = await readKelivoChats(zip);

  options.onProgress?.({ message: '转换 Kelivo 附件' });
  const registry = await buildAssetRegistry(zip, options.onProgress);
  const { providers, activeProviderId } = buildProviders(settings);
  const { mcpServers, skippedMcpServers } = buildMcpServers(settings);
  const { personas, activeCollaboratorId, backgroundAssetByPersona, userName } = buildPersonas(settings, registry, providers);
  const chatState = buildChatState(rawChats, registry);
  const reconciledPersonaOwners = reconcileKelivoPersonaOwners({
    personas,
    activeCollaboratorId,
    chatState,
    userName
  });
  const collectionState = buildCollectionState();
  const spaceState = buildSpaceState(reconciledPersonaOwners.activeCollaboratorId, backgroundAssetByPersona, settings);
  const migratedSpaceState = migratePersistedSpaceState(spaceState);
  const mcpToolTimeoutSeconds = Math.max(1, Math.floor((readNumber(readSetting(settings, 'mcp_request_timeout_ms_v1')) ?? 30_000) / 1000));
  const runtimeState = normalizeRuntimePayload({
    providers,
    activeProviderId,
    mcpServers,
    mcpToolTimeoutSeconds
  });
  const personaState = {
    personas: reconciledPersonaOwners.personas,
    activeCollaboratorId: reconciledPersonaOwners.activeCollaboratorId,
    seededDefaultPersonaIds: []
  };

  return {
    snapshot: {
      spaceState: migratedSpaceState,
      chatState,
      collectionState,
      personaState,
      personaMemoryDocContent: { version: 1, docs: {} },
      runtimeState,
      assetEntries: registry.entries
    },
    stats: {
      conversations: chatState.conversations.length,
      messages: chatState.conversations.reduce((sum, conversation) => sum + conversation.messages.length, 0),
      personas: reconciledPersonaOwners.personas.length,
      providers: providers.length,
      mcpServers: runtimeState.mcpServers.length,
      skippedMcpServers,
      assets: registry.entries.length
    }
  };
}

export async function importKelivoBackupPackage(
  file: Blob,
  options: { onProgress?: StoreImportProgressReporter } = {}
): Promise<void> {
  const converted = await convertKelivoBackupZip(file, options);
  const { importPersistedDataDirectly } = await import('./storeImportPackage');
  await importPersistedDataDirectly({
    kvEntries: converted.kvEntries,
    localStorageEntries: converted.localStorageEntries,
    assetEntries: converted.assetEntries,
    onProgress: options.onProgress
  });
}

export async function importKelivoBackupPackageIfMatched(
  file: Blob,
  options: { onProgress?: StoreImportProgressReporter } = {}
): Promise<boolean> {
  let zip: KelivoZip;
  try {
    zip = await loadKelivoZip(file);
  } catch {
    return false;
  }
  if (!isKelivoZipShape(zip)) {
    return false;
  }

  options.onProgress?.({ message: '识别为 Kelivo 备份' });
  const converted = convertKelivoStructuredExportToImportConversion(
    await convertKelivoZipToStructuredExportSnapshot(zip, options)
  );
  const { importPersistedDataDirectly } = await import('./storeImportPackage');
  await importPersistedDataDirectly({
    kvEntries: converted.kvEntries,
    localStorageEntries: converted.localStorageEntries,
    assetEntries: converted.assetEntries,
    onProgress: options.onProgress
  });
  return true;
}
