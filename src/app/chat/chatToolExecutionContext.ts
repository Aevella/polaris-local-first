import {
  filterCodeCardsForCollaboratorScope,
  filterImageCardsForCollaboratorScope,
  filterProjectFilesForCollaboratorScope
} from '../../engines/collectionOwnership';
import {
  bundleConversationArchiveEntries,
  bundleConversationAttachments,
  createQrCodeAttachment,
  type SendImageAttachmentResult,
  inspectConversationArchiveEntries,
  inspectConversationAttachments,
  readConversationArchiveEntryText,
  readConversationAttachmentText
} from '../../engines/attachmentToolExecutor';
import { prewarmRunCodeSandbox, runCodeInSandbox } from '../../engines/codeSandbox';
import { ensureRoomState, updateRoomState } from '../../engines/roomStatePersistence';
import { invokeMcpTool, resolveMcpToolCatalog, type McpToolAttachmentContent } from '../../engines/mcpRuntime';
import { readWebPageContent, runWebSearch } from '../../engines/webSearchTool';
import { executeEnvironmentDirectoryAction } from '../../engines/environmentDirectory';
import { normalizeCodeCardFilePath } from '../../engines/roomProjects';
import { resolveAttachmentTargetEntry, toAttachmentEntries } from '../../engines/attachmentToolEntries';
import {
  createImageAttachmentVariant,
  extractImageAttachmentPalette,
  inspectImageAttachment
} from '../../engines/imageAssetTools';
import { generateImageAttachment } from '../../engines/generatedImageTool';
import type { ToolContext } from '../../engines/toolExecutorTypes';
import {
  createAttachmentFromAsset,
  createStoredAttachment,
  createStoredAttachmentFromDataUrl,
  getAssetBlob,
  getAssetMeta
} from '../../infrastructure/assetStore';
import { getDesktopLocalHostBridge } from '../../desktop/localHost';
import {
  createNativeCalendarEvent,
  deleteNativeCalendarEvent,
  getNativePersonalDataToolAvailability,
  listNativeCalendars,
  readNativeCalendarEvents,
  updateNativeCalendarEvent
} from '../../native/personalData';
import type { ChatAttachment, ImageAssetCard, PolarisTriggerRule } from '../../types/domain';
import {
  buildDesktopWorkspaceFileSyncMap,
  buildDesktopWorkspaceManifestContent,
  createDesktopWorkspaceFileSyncEntry,
  DESKTOP_WORKSPACE_MANIFEST_PATH,
  inferDesktopWorkspaceFileLanguage,
  planDesktopWorkspaceDiskImport,
  planDesktopWorkspaceDiskWrite
} from '../desktop/desktopWorkspaceBinding';
import { inferManualProjectFileRole } from '../collection/projectWorkspaceCreation';
import { revealCollectionShelf } from '../shell/frontstageNavigation';
import { getProductDoc, readProductDocByTopic } from '../shell/productDocs';
import { inspectCurrentThemeRender } from '../theme/themeRenderInspection';
import { buildCollectionToolContextPorts } from './chatToolCollectionContext';
import type {
  ChatSpaceFrontstagePort,
  ChatSpaceThemeSessionPort,
  ChatToolStoreBindings,
  MemoryActions,
  ToolActionChatState,
  ToolActionCollectionState
} from './chatToolActionTypes';

type DirectToolExecutionContextArgs = {
  chat: Pick<
    ToolActionChatState,
    | 'conversations'
    | 'findConversation'
    | 'getConversationMessages'
    | 'setConversationActiveProject'
  > & Pick<ToolActionChatState, 'readLatestState'>;
  collection: ToolActionCollectionState;
  persona: Pick<ChatToolStoreBindings['persona'], 'personas'>;
  runtime: ChatToolStoreBindings['runtime'];
  space:
    & Pick<
      ChatSpaceFrontstagePort,
      | 'activeCardId'
      | 'activeWorld'
      | 'collectionShelf'
      | 'setCollectionShelf'
      | 'setWorld'
      | 'setActiveCard'
      | 'spotlightCard'
    >
    & Pick<ChatSpaceThemeSessionPort, 'applyThemePatch' | 'applyThemePreset' | 'getCurrentThemeFrame'>;
  memoryActions: MemoryActions;
  conversationId: string;
  ownerCollaboratorId: string | null | undefined;
  activeProjectId: string | null;
};

function normalizeImageMaterialTarget(value: string) {
  return value.trim().toLowerCase().replace(/[《》"'“”‘’]/g, '');
}

function readPolarisKnowledgeDoc(topic?: string) {
  const result = readProductDocByTopic(getProductDoc('ai-guide'), topic);
  return {
    ok: true as const,
    ...result
  };
}

function formatTriggerScheduleLabel(action: Parameters<ToolContext['createProactiveMessageRule']>[0]) {
  return action.schedule.kind === 'daily'
    ? `每天 ${action.schedule.time}`
    : `每隔 ${action.schedule.everyMinutes} 分钟`;
}

function formatRuleScheduleLabel(rule: PolarisTriggerRule) {
  return rule.schedule.kind === 'daily'
    ? `每天 ${rule.schedule.time}`
    : `每隔 ${rule.schedule.everyMinutes} 分钟`;
}

function formatRuleTargetLabel(rule: PolarisTriggerRule) {
  return rule.target.conversationMode === 'fixed' ? '固定对话' : '最近对话';
}

async function imageCardToAttachment(card: ImageAssetCard): Promise<ChatAttachment> {
  const meta = await getAssetMeta(card.assetId);
  return {
    id: card.id,
    assetId: card.assetId,
    kind: 'image',
    name: meta?.name ?? card.title,
    mimeType: meta?.mimeType ?? 'image/*',
    size: meta?.size ?? 0
  };
}

async function cloneImageAttachmentForSend(source: ChatAttachment, title?: string) {
  const [meta, blob] = await Promise.all([
    getAssetMeta(source.assetId),
    getAssetBlob(source.assetId)
  ]);
  if (!meta && !blob) {
    return {
      ok: false as const,
      error: `图片素材 ${source.assetId} 缺少本地文件内容，不能发送。`
    };
  }

  const name = title?.trim() || meta?.name || source.name || 'image.png';
  const attachment = await createAttachmentFromAsset({
    assetId: source.assetId,
    kind: 'image',
    name,
    mimeType: meta?.mimeType || source.mimeType || blob?.type || 'image/*',
    size: meta?.size ?? source.size ?? blob?.size ?? 0,
    textContent: meta?.textContent
  });

  return {
    ok: true as const,
    attachment,
    detailText: [
      `图片：${name}`,
      `assetId=${source.assetId}`,
      '来源：已有本地图片素材'
    ].join('\n')
  };
}

function parseImageSourceUrl(value: string | undefined) {
  const target = value?.trim();
  if (!target) return null;
  if (/^data:image\//i.test(target)) {
    return { kind: 'data-url' as const, value: target };
  }
  try {
    const url = new URL(target);
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      return { kind: 'remote-url' as const, value: url.toString(), url };
    }
  } catch {
    return null;
  }
  return null;
}

function imageNameFromUrl(url: URL, title?: string) {
  const explicitTitle = title?.trim().replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, '-');
  if (explicitTitle) return explicitTitle;

  const pathnameName = decodeURIComponent(url.pathname.split('/').filter(Boolean).pop() ?? '').trim();
  const cleanName = pathnameName.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, '-');
  return cleanName || 'image';
}

async function createMcpAttachment(content: McpToolAttachmentContent, toolName: string, index: number) {
  const fallbackName = `${toolName.trim().replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, '-') || 'mcp-result'}-${index + 1}`;
  return createStoredAttachmentFromDataUrl({
    kind: content.kind,
    name: content.name || fallbackName,
    mimeType: content.mimeType,
    dataUrl: content.dataUrl,
    textContent: content.textContent
  });
}

async function importImageSourceForSend(target: string | undefined, title?: string): Promise<SendImageAttachmentResult | null> {
  const source = parseImageSourceUrl(target);
  if (!source) return null;

  if (source.kind === 'data-url') {
    return {
      ok: true,
      attachment: await createStoredAttachmentFromDataUrl({
        kind: 'image',
        name: title?.trim() || 'image.png',
        mimeType: source.value.slice(5, source.value.indexOf(';')) || 'image/png',
        dataUrl: source.value
      }),
      detailText: '已从 data URL 导入图片。'
    };
  }

  try {
    const response = await fetch(source.value);
    if (!response.ok) {
      return { ok: false, error: `读取图片 URL 失败：${response.status}` };
    }
    const blob = await response.blob();
    const mimeType = response.headers.get('content-type')?.split(';')[0]?.trim() || blob.type || 'image/*';
    if (!mimeType.toLowerCase().startsWith('image/')) {
      return { ok: false, error: `这个 URL 返回的不是图片：${mimeType}` };
    }

    const name = imageNameFromUrl(source.url, title);
    return {
      ok: true,
      attachment: await createStoredAttachment({
        kind: 'image',
        name,
        mimeType,
        blob
      }),
      detailText: [
        `图片：${name}`,
        `来源：${source.value}`
      ].join('\n')
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? `读取图片 URL 失败：${error.message}` : '读取图片 URL 失败。'
    };
  }
}

function formatDesktopSyncIssueBlock(kind: 'conflict' | 'overwrite', paths: string[]) {
  if (!paths.length) return '';
  const title = kind === 'conflict' ? '两边都改过' : '将覆盖同路径文件';
  const preview = paths.slice(0, 8).map((path) => `- ${path}`).join('\n');
  return paths.length > 8
    ? `${title}：\n${preview}\n- 还有 ${paths.length - 8} 个文件`
    : `${title}：\n${preview}`;
}

function buildDesktopSyncBlockedError(directionLabel: string, issues: Array<{ path: string; kind: 'conflict' | 'overwrite' }>) {
  const conflicts = issues.filter((issue) => issue.kind === 'conflict').map((issue) => issue.path);
  const overwrites = issues.filter((issue) => issue.kind === 'overwrite').map((issue) => issue.path);
  return [
    `${directionLabel}会覆盖真实工作区内容，已先停下。`,
    formatDesktopSyncIssueBlock('conflict', conflicts),
    formatDesktopSyncIssueBlock('overwrite', overwrites),
    '需要继续时，先向用户说明这些文件会被覆盖；用户明确同意后再用 allowOverwrite=true 重试。'
  ].filter(Boolean).join('\n\n');
}

function resolveDesktopSyncProject(args: {
  collection: ToolActionCollectionState;
  activeProjectId: string | null;
  projectId?: string;
}) {
  const resolvedProjectId = args.projectId?.trim() || args.activeProjectId;
  if (!resolvedProjectId) return { ok: false as const, error: '当前没有活动工作区，不能同步桌面工作区。' };
  const project = args.collection.readLatestState().roomProjects.find((entry) => entry.id === resolvedProjectId) ?? null;
  if (!project) return { ok: false as const, error: `没有找到工作区：${resolvedProjectId}` };
  if (!project.desktopBinding) return { ok: false as const, error: `工作区“${project.title}”没有绑定 Mac 本机文件夹。` };
  return { ok: true as const, project };
}

function assertDesktopSyncRoot(projectRootId: string, requestedRootId?: string) {
  const rootId = requestedRootId?.trim();
  if (rootId && rootId !== projectRootId) {
    return { ok: false as const, error: `rootId 与当前工作区绑定不一致：${rootId} !== ${projectRootId}` };
  }
  return { ok: true as const };
}

export function buildDirectToolExecutionContext({
  chat,
  collection,
  persona,
  runtime,
  space,
  memoryActions,
  conversationId,
  ownerCollaboratorId,
  activeProjectId
}: DirectToolExecutionContextArgs): ToolContext {
  const getLatestCollectionState = () => collection.readLatestState();
  const getConversationMessages = () => chat.getConversationMessages(conversationId);
  const writeOwnerCollaboratorId = ownerCollaboratorId ?? undefined;
  const listOwnerTriggerRules = () => {
    const collaboratorId = ownerCollaboratorId?.trim();
    return collaboratorId
      ? runtime.getTriggerRules().filter((rule) => rule.target.collaboratorId === collaboratorId)
      : [];
  };
  const findOwnerTriggerRule = (ruleId: string) => {
    const normalizedRuleId = ruleId.trim();
    return listOwnerTriggerRules().find((rule) => rule.id === normalizedRuleId) ?? null;
  };
  const latestCollectionState = getLatestCollectionState();
  const accessibleImageCards = filterImageCardsForCollaboratorScope(
    latestCollectionState.imageCards,
    chat.conversations,
    ownerCollaboratorId
  );
  const resolveAttachmentForSave = (
    target: string | undefined,
    options: { kind?: 'image' | 'file'; hasText?: boolean; noun: string }
  ) => {
    const latestResult = resolveAttachmentTargetEntry(
      toAttachmentEntries(getConversationMessages(), 'latest'),
      target,
      options
    );
    if (latestResult.ok || !target?.trim()) return latestResult;
    return resolveAttachmentTargetEntry(
      toAttachmentEntries(getConversationMessages(), 'all'),
      target,
      options
    );
  };
  const resolveImageMaterialTarget = async (target: string | undefined) => {
    const attachmentResult = resolveAttachmentForSave(target, { kind: 'image', noun: '图片素材' });
    if (attachmentResult.ok) return { ok: true as const, attachment: attachmentResult.entry.attachment };

    const imageCards = accessibleImageCards;
    if (!target?.trim()) {
      if (imageCards.length === 1) {
        return { ok: true as const, attachment: await imageCardToAttachment(imageCards[0]) };
      }
      if (imageCards.length > 1 && attachmentResult.error.includes('当前没有')) {
        return {
          ok: false as const,
          error: `图片库里有多个素材，请指定 target。当前有：${imageCards.map((card) => card.title).join('、')}`
        };
      }
      return attachmentResult;
    }

    const normalized = normalizeImageMaterialTarget(target);
    const matches = imageCards.filter((card) => {
      const title = normalizeImageMaterialTarget(card.title);
      const id = normalizeImageMaterialTarget(card.id);
      const assetId = normalizeImageMaterialTarget(card.assetId);
      return id === normalized
        || assetId === normalized
        || title === normalized
        || title.includes(normalized);
    });
    if (matches.length === 1) {
      return { ok: true as const, attachment: await imageCardToAttachment(matches[0]) };
    }
    if (matches.length > 1) {
      return {
        ok: false as const,
        error: `“${target}”匹配到多个图片库素材：${matches.map((card) => card.title).join('、')}`
      };
    }
    return attachmentResult;
  };

  return {
    applyThemePatch: space.applyThemePatch,
    readCurrentThemeFrame: space.getCurrentThemeFrame,
    inspectThemeRender: inspectCurrentThemeRender,
    allowUnsafeThemeCss: true,
    applyThemePreset: space.applyThemePreset,
    setWorld: space.setWorld,
    setCollectionShelf: space.setCollectionShelf,
    ...buildCollectionToolContextPorts({
      chat,
      collection,
      space,
      conversationId,
      ownerCollaboratorId,
      activeProjectId,
      writeOwnerCollaboratorId
    }),
    listCollaboratorMemoryDocs: () => memoryActions.listCollaboratorMemoryDocs?.(conversationId) ?? [],
    appendCollaboratorMemories: (items) => memoryActions.appendCollaboratorMemories(items, conversationId),
    writeCollaboratorMemoryDoc: (doc) => memoryActions.writeCollaboratorMemoryDoc(doc, conversationId),
    readCollaboratorMemoryDoc: (docId) => memoryActions.readCollaboratorMemoryDoc(docId, conversationId),
    searchCollaboratorMemory: (query, mode, maxResults) =>
      memoryActions.searchCollaboratorMemory
        ? memoryActions.searchCollaboratorMemory(query, mode, maxResults, conversationId)
        : { ok: false, error: '当前没有可搜索记忆的协作者。' },
    openMemorySource: (sourceConversationId, sourceMessageIds, maxChars) =>
      memoryActions.openMemorySource
        ? memoryActions.openMemorySource(sourceConversationId, sourceMessageIds, maxChars, conversationId)
        : { ok: false, error: '当前没有可读取的记忆原文。' },
    readPolarisKnowledge: readPolarisKnowledgeDoc,
    readEnvironmentDirectory: async (action) => {
      const collectionState = collection.readLatestState();
      const runtimeState = {
        providers: runtime.providers,
        activeProviderId: runtime.api.id,
        mcpServers: runtime.mcpServers,
        webSearch: runtime.search,
        imageGeneration: runtime.imageGeneration
      };
      const conversation = chat.findConversation(conversationId) ?? null;
      const fullConversation = chat.conversations.find((entry) => entry.id === conversationId) ?? null;
      const messages = getConversationMessages();
      const attachmentEntries = toAttachmentEntries(messages, 'all');
      const desktopBridge = getDesktopLocalHostBridge();
      const desktopState = desktopBridge ? await desktopBridge.getState() : null;
      const personalDataAvailability = getNativePersonalDataToolAvailability();
      const memoryDocs = memoryActions.listCollaboratorMemoryDocs?.(conversationId) ?? [];
      const cards = filterCodeCardsForCollaboratorScope(
        collectionState.cards,
        chat.conversations,
        ownerCollaboratorId
      );
      const imageCards = filterImageCardsForCollaboratorScope(
        collectionState.imageCards,
        chat.conversations,
        ownerCollaboratorId
      );
      const projectFiles = filterProjectFilesForCollaboratorScope(
        collectionState.projectFiles,
        ownerCollaboratorId,
        conversation?.activeProjectId ?? activeProjectId
      );
      const archiveAttachmentCount = attachmentEntries.filter((entry) => {
        const mimeType = entry.attachment.mimeType?.toLowerCase() ?? '';
        const name = entry.name.toLowerCase();
        return mimeType.includes('zip') || name.endsWith('.zip');
      }).length;
      const imageAttachmentCount = attachmentEntries.filter((entry) =>
        entry.attachment.kind === 'image'
      ).length;

      return executeEnvironmentDirectoryAction({
        activeWorld: space.activeWorld,
        collectionShelf: space.collectionShelf,
        activeConversation: fullConversation ?? conversation,
        activeCollaboratorName: persona.personas.find((entry) => entry.id === ownerCollaboratorId)?.name ?? null,
        activeCardId: space.activeCardId,
        cards,
        imageCards,
        roomProjects: collectionState.roomProjects,
        projectFiles,
        workspaceReferenceDocs: collectionState.workspaceReferenceDocs ?? [],
        memoryDocs,
        providers: runtimeState.providers,
        activeProviderId: runtimeState.activeProviderId,
        mcpServers: runtimeState.mcpServers,
        webSearch: runtimeState.webSearch,
        desktopLocalHost: desktopState,
        attachmentCount: attachmentEntries.length,
        archiveAttachmentCount,
        imageAttachmentCount,
        calendarAvailable: personalDataAvailability.calendarAvailable,
        calendarWriteAvailable: personalDataAvailability.calendarWriteAvailable,
        imageGenerationAvailable: runtimeState.imageGeneration.enabled,
        memorySearchAvailable: Boolean(memoryActions.searchCollaboratorMemory)
      }, action);
    },
    createProactiveMessageRule: (action) => {
      const collaboratorId = ownerCollaboratorId?.trim();
      if (!collaboratorId) {
        return { ok: false, error: '当前对话没有绑定协作者，不能创建主动消息规则。' };
      }
      const prompt = action.prompt.trim();
      if (!prompt) {
        return { ok: false, error: '主动消息规则缺少提示词。' };
      }
      const conversationMode = action.conversationMode === 'follow-latest' ? 'follow-latest' : 'fixed';
      const ruleId = runtime.createTriggerRule({
        name: action.name?.trim() || undefined,
        schedule: action.schedule,
        target: {
          collaboratorId,
          conversationMode,
          conversationId: conversationMode === 'fixed' ? conversationId : null
        },
        action: {
          prompt
        }
      });
      const scheduleLabel = formatTriggerScheduleLabel(action);
      const targetLabel = conversationMode === 'fixed' ? '当前对话' : '这个协作者的最近对话';
      return {
        ok: true,
        summary: `已创建主动消息规则 · ${action.name?.trim() || scheduleLabel}`,
        detailText: [
          `ruleId=${ruleId}`,
          `schedule=${scheduleLabel}`,
          `target=${targetLabel}`,
          `prompt=${prompt}`
        ].join('\n'),
        triggerRuleId: ruleId
      };
    },
    listProactiveMessageRules: () => {
      const collaboratorId = ownerCollaboratorId?.trim();
      if (!collaboratorId) {
        return { ok: false, error: '当前对话没有绑定协作者，不能查看主动消息规则。' };
      }
      const rules = listOwnerTriggerRules();
      const detailText = rules.length
        ? rules.map((rule, index) => [
            `${index + 1}. ${rule.name}`,
            `ruleId=${rule.id}`,
            `enabled=${rule.enabled ? 'true' : 'false'}`,
            `schedule=${formatRuleScheduleLabel(rule)}`,
            `target=${formatRuleTargetLabel(rule)}`,
            `prompt=${rule.action.prompt}`
          ].join('\n')).join('\n\n')
        : '当前协作者还没有主动消息规则。';
      return {
        ok: true,
        summary: `已查看主动消息规则 · ${rules.length} 条`,
        detailText,
        triggerRules: rules
      };
    },
    updateProactiveMessageRule: (action) => {
      const rule = findOwnerTriggerRule(action.ruleId);
      if (!rule) {
        return { ok: false, error: `没有找到当前协作者的主动消息规则：${action.ruleId}` };
      }
      const conversationMode = action.conversationMode;
      runtime.updateTriggerRule(rule.id, {
        ...(action.name ? { name: action.name } : {}),
        ...(action.prompt ? { action: { prompt: action.prompt } } : {}),
        ...(action.schedule ? { schedule: action.schedule } : {}),
        ...(conversationMode ? {
          target: {
            ...rule.target,
            conversationMode,
            conversationId: conversationMode === 'fixed' ? conversationId : null
          }
        } : {})
      });
      const updatedRule: PolarisTriggerRule = {
        ...rule,
        ...(action.name ? { name: action.name } : {}),
        ...(action.prompt ? { action: { prompt: action.prompt } } : {}),
        ...(action.schedule ? { schedule: action.schedule } : {}),
        ...(conversationMode ? {
          target: {
            ...rule.target,
            conversationMode,
            conversationId: conversationMode === 'fixed' ? conversationId : null
          }
        } : {})
      };
      return {
        ok: true,
        summary: `已修改主动消息规则 · ${updatedRule.name}`,
        detailText: [
          `ruleId=${updatedRule.id}`,
          `schedule=${formatRuleScheduleLabel(updatedRule)}`,
          `target=${formatRuleTargetLabel(updatedRule)}`,
          `prompt=${updatedRule.action.prompt}`
        ].join('\n'),
        triggerRuleId: updatedRule.id
      };
    },
    deleteProactiveMessageRule: (action) => {
      const rule = findOwnerTriggerRule(action.ruleId);
      if (!rule) {
        return { ok: false, error: `没有找到当前协作者的主动消息规则：${action.ruleId}` };
      }
      runtime.deleteTriggerRule(rule.id);
      return {
        ok: true,
        summary: `已取消主动消息规则 · ${rule.name}`,
        detailText: [
          `ruleId=${rule.id}`,
          `schedule=${formatRuleScheduleLabel(rule)}`,
          `target=${formatRuleTargetLabel(rule)}`
        ].join('\n'),
        triggerRuleId: rule.id
      };
    },
    inspectAttachments: (scope, query) => inspectConversationAttachments(getConversationMessages(), scope, query),
    webSearch: (query, maxResults) => runWebSearch(query, maxResults, runtime.search),
    readWebPage: (url, maxChars) => readWebPageContent(url, maxChars),
    listCalendars: () => listNativeCalendars(),
    readCalendarEvents: (query) => readNativeCalendarEvents(query),
    createCalendarEvent: (draft) => createNativeCalendarEvent(draft),
    updateCalendarEvent: (patch) => updateNativeCalendarEvent(patch),
    deleteCalendarEvent: (event) => deleteNativeCalendarEvent(event),
    inspectArchiveEntries: (target, query) => inspectConversationArchiveEntries(getConversationMessages(), target, query),
    readAttachmentText: (target, maxChars) => readConversationAttachmentText(getConversationMessages(), target, maxChars),
    readArchiveEntryText: (target, entry, maxChars) =>
      readConversationArchiveEntryText(getConversationMessages(), target, entry, maxChars),
    bundleArchiveEntries: (target, entries, prefixes, excludeEntries, excludePrefixes, archiveName) =>
      bundleConversationArchiveEntries(
        getConversationMessages(),
        target,
        entries,
        prefixes,
        excludeEntries,
        excludePrefixes,
        archiveName
      ),
    bundleAttachments: (targets, archiveName) =>
      bundleConversationAttachments(getConversationMessages(), targets, archiveName),
    createQrCode: (text, fileName) => createQrCodeAttachment(text, fileName),
    generateImage: (prompt, title) =>
      generateImageAttachment({
        prompt,
        title,
        settings: runtime.imageGeneration,
        providers: runtime.providers,
        globalApi: runtime.api
      }),
    sendImageAttachment: async (target, title) => {
      const imported = await importImageSourceForSend(target, title);
      if (imported) return imported;
      const resolved = await resolveImageMaterialTarget(target);
      if (!resolved.ok) return resolved;
      return cloneImageAttachmentForSend(resolved.attachment, title);
    },
    inspectImageAsset: async (target) => {
      const resolved = await resolveImageMaterialTarget(target);
      if (!resolved.ok) return resolved;
      return inspectImageAttachment(resolved.attachment);
    },
    extractImagePalette: async (target) => {
      const resolved = await resolveImageMaterialTarget(target);
      if (!resolved.ok) return resolved;
      return extractImageAttachmentPalette(resolved.attachment);
    },
    createImageVariant: async (target, options) => {
      const resolved = await resolveImageMaterialTarget(target);
      if (!resolved.ok) return resolved;
      return createImageAttachmentVariant(resolved.attachment, options);
    },
    saveAttachmentToCollection: (target, title, tags, openInCollection) => {
      const resolved = resolveAttachmentForSave(target, { kind: 'image', noun: '图片附件' });
      if (!resolved.ok) return resolved;

      const saveResult = collection.saveImageCardFromChat({
        assetId: resolved.entry.attachment.assetId,
        title,
        tags,
        ownerCollaboratorId: writeOwnerCollaboratorId,
        imageName: resolved.entry.name,
        conversationId,
        messageId: resolved.entry.messageId,
        attachmentId: resolved.entry.id
      });

      if (!saveResult) return { ok: false, error: '保存图片收藏失败。' };
      if (openInCollection) {
        revealCollectionShelf(space, 'image');
      }
      return {
        ok: true,
        cardId: saveResult.cardId,
        created: saveResult.created,
        title: saveResult.title
      };
    },
    saveAttachmentAsCodeCard: (target, title, language, tags, openInCollection) => {
      const resolved = resolveAttachmentForSave(target, { hasText: true, noun: '文本附件' });
      if (!resolved.ok) return resolved;
      const code = resolved.entry.attachment.textContent?.trim();
      if (!code) {
        return { ok: false, error: '这个附件没有可保存的文本内容。' };
      }

      const saveResult = collection.saveCardFromChat({
        title: title || resolved.entry.name,
        language,
        code,
        tags,
        ownerCollaboratorId: writeOwnerCollaboratorId,
        conversationId,
        messageId: resolved.entry.messageId,
        blockIndex: resolved.entry.attachmentIndex,
        blockTitle: resolved.entry.name
      });

      if (!saveResult) return { ok: false, error: '保存房间失败。' };
      space.setActiveCard(saveResult.cardId);
      space.spotlightCard(saveResult.cardId);
      if (openInCollection) {
        revealCollectionShelf(space, 'code');
      }
      return {
        ok: true,
        cardId: saveResult.cardId,
        created: saveResult.created,
        title: saveResult.title
      };
    },
    runCode: async (code) => {
      await prewarmRunCodeSandbox();
      return runCodeInSandbox(code);
    },
    activeProjectId,
    syncDesktopWorkspaceFromDisk: async ({ projectId, rootId, allowOverwrite }) => {
      const bridge = getDesktopLocalHostBridge();
      if (!bridge) return { ok: false, error: '当前不是官网 Mac 桌面宿主，不能同步本机工作区。' };
      const resolvedProject = resolveDesktopSyncProject({ collection, activeProjectId, projectId });
      if (!resolvedProject.ok) return resolvedProject;
      const project = resolvedProject.project;
      const rootCheck = assertDesktopSyncRoot(project.desktopBinding!.rootId, rootId);
      if (!rootCheck.ok) return rootCheck;

      const diskSnapshot = await bridge.readWorkspaceFiles({ rootId: project.desktopBinding!.rootId });
      const projectFilesBeforeSync = collection.readLatestState().projectFiles.filter((file) => file.projectId === project.id);
      const plan = planDesktopWorkspaceDiskImport({
        diskFiles: diskSnapshot.files,
        projectFiles: projectFilesBeforeSync,
        fileSync: project.desktopBinding!.fileSync
      });
      if (plan.issues.length > 0 && !allowOverwrite) {
        return { ok: false, error: buildDesktopSyncBlockedError('从电脑读入', plan.issues) };
      }

      const syncedAt = Date.now();
      let entryFileId = project.entryFileId;
      for (const file of diskSnapshot.files) {
        const filePath = normalizeCodeCardFilePath(file.relativePath);
        if (!filePath) continue;
        const language = inferDesktopWorkspaceFileLanguage(filePath, file.content);
        const fileRole = inferManualProjectFileRole(filePath, language);
        const currentFile = collection.readLatestState().projectFiles.find((candidate) =>
          candidate.projectId === project.id
          && normalizeCodeCardFilePath(candidate.filePath) === filePath
        );
        const fileId = currentFile
          ? currentFile.id
          : collection.createProjectFile({
              projectId: project.id,
              filePath,
              fileRole,
              language,
              content: file.content,
              ownerCollaboratorId: project.ownerCollaboratorId,
              source: 'manual'
            });
        if (!fileId) continue;
        if (currentFile && (
          currentFile.content !== file.content
          || currentFile.language !== language
          || currentFile.fileRole !== fileRole
        )) {
          collection.updateProjectFile(currentFile.id, {
            content: file.content,
            language,
            fileRole,
            source: 'manual'
          });
        }
        if (filePath === project.desktopBinding!.entryFilePath) {
          entryFileId = fileId;
        }
      }

      const projectFileByPath = new Map(
        collection.readLatestState().projectFiles
          .filter((file) => file.projectId === project.id)
          .flatMap((file) => {
            const path = normalizeCodeCardFilePath(file.filePath);
            return path ? [[path, file] as const] : [];
          })
      );
      const fileSyncEntries = diskSnapshot.files.flatMap((file) => {
        const path = normalizeCodeCardFilePath(file.relativePath);
        const projectFile = path ? projectFileByPath.get(path) : null;
        const entry = projectFile ? createDesktopWorkspaceFileSyncEntry({
          relativePath: file.relativePath,
          diskContent: file.content,
          polarisContent: projectFile.content,
          diskUpdatedAt: file.updatedAt,
          polarisUpdatedAt: projectFile.updatedAt,
          syncedAt
        }) : null;
        return entry ? [entry] : [];
      });
      collection.updateProject(project.id, {
        entryFileId,
        desktopBinding: {
          ...project.desktopBinding!,
          syncedAt,
          fileSync: {
            ...(project.desktopBinding!.fileSync ?? {}),
            ...buildDesktopWorkspaceFileSyncMap(fileSyncEntries)
          }
        }
      });
      return {
        ok: true,
        summary: `已从电脑读入工作区 · ${project.title}`,
        detailText: [
          `rootId=${project.desktopBinding!.rootId}`,
          `changedFiles=${plan.changedFiles.length}`,
          `overwriteWarnings=${plan.issues.length}`,
          plan.changedFiles.length ? plan.changedFiles.map((path) => `- ${path}`).join('\n') : '没有文件变化。'
        ].join('\n')
      };
    },
    syncDesktopWorkspaceToDisk: async ({ projectId, rootId, allowOverwrite }) => {
      const bridge = getDesktopLocalHostBridge();
      if (!bridge) return { ok: false, error: '当前不是官网 Mac 桌面宿主，不能同步本机工作区。' };
      const resolvedProject = resolveDesktopSyncProject({ collection, activeProjectId, projectId });
      if (!resolvedProject.ok) return resolvedProject;
      const project = resolvedProject.project;
      const rootCheck = assertDesktopSyncRoot(project.desktopBinding!.rootId, rootId);
      if (!rootCheck.ok) return rootCheck;

      const diskSnapshot = await bridge.readWorkspaceFiles({ rootId: project.desktopBinding!.rootId });
      const projectFiles = collection.readLatestState().projectFiles.filter((file) => file.projectId === project.id);
      const plan = planDesktopWorkspaceDiskWrite({
        diskFiles: diskSnapshot.files,
        projectFiles,
        fileSync: project.desktopBinding!.fileSync
      });
      if (plan.issues.length > 0 && !allowOverwrite) {
        return { ok: false, error: buildDesktopSyncBlockedError('送到电脑', plan.issues) };
      }

      const files = projectFiles.flatMap((file) => {
        const relativePath = normalizeCodeCardFilePath(file.filePath);
        return relativePath && relativePath !== DESKTOP_WORKSPACE_MANIFEST_PATH && !relativePath.startsWith('.polaris/')
          ? [{ relativePath, content: file.content }]
          : [];
      });
      const syncedAt = Date.now();
      const result = await bridge.writeWorkspaceFiles({
        rootId: project.desktopBinding!.rootId,
        files: [
          ...files,
          {
            relativePath: DESKTOP_WORKSPACE_MANIFEST_PATH,
            content: buildDesktopWorkspaceManifestContent({
              projectId: project.id,
              title: project.title,
              entryFilePath: project.desktopBinding!.entryFilePath,
              updatedAt: syncedAt
            })
          }
        ]
      });
      const projectFileByPath = new Map(
        projectFiles.flatMap((file) => {
          const path = normalizeCodeCardFilePath(file.filePath);
          return path ? [[path, file] as const] : [];
        })
      );
      const fileSyncEntries = result.writtenFiles.flatMap((file) => {
        if (file.relativePath === DESKTOP_WORKSPACE_MANIFEST_PATH || file.relativePath.startsWith('.polaris/')) return [];
        const projectFile = projectFileByPath.get(file.relativePath);
        const entry = projectFile ? createDesktopWorkspaceFileSyncEntry({
          relativePath: file.relativePath,
          diskContent: projectFile.content,
          polarisContent: projectFile.content,
          diskUpdatedAt: syncedAt,
          polarisUpdatedAt: projectFile.updatedAt,
          syncedAt
        }) : null;
        return entry ? [entry] : [];
      });
      collection.updateProject(project.id, {
        desktopBinding: {
          ...project.desktopBinding!,
          syncedAt,
          fileSync: {
            ...(project.desktopBinding!.fileSync ?? {}),
            ...buildDesktopWorkspaceFileSyncMap(fileSyncEntries)
          }
        }
      });
      return {
        ok: true,
        summary: `已送到电脑工作区 · ${project.title}`,
        detailText: [
          `rootId=${project.desktopBinding!.rootId}`,
          `writtenFiles=${Math.max(0, result.writtenFiles.length - 1)}`,
          `overwriteWarnings=${plan.issues.length}`,
          plan.changedFiles.length ? plan.changedFiles.map((path) => `- ${path}`).join('\n') : '没有文件变化。'
        ].join('\n')
      };
    },
    desktopLocalHost: getDesktopLocalHostBridge() ?? undefined,
    invokeMcpTool: async (serverId, toolName, argumentsObject) => {
      const catalog = await resolveMcpToolCatalog({
        servers: runtime.mcpServers,
        timeoutSeconds: runtime.mcpToolTimeoutSeconds
      });
      const tool = catalog.tools.find((entry) => (
        entry.serverId === serverId
        && entry.toolName === toolName
      )) ?? null;
      if (!tool) {
        return { ok: false, error: '没有找到要调用的 MCP 工具。' } as const;
      }

      const server = runtime.mcpServers.find((entry: { id: string }) => entry.id === serverId) ?? null;
      const result = await invokeMcpTool({
        tool,
        argumentsObject,
        timeoutSeconds: runtime.mcpToolTimeoutSeconds,
        headers: server?.headers ?? []
      });
      const attachments = result.ok && result.attachmentContent?.length
        ? await Promise.all(result.attachmentContent.map((content, index) => createMcpAttachment(content, toolName, index)))
        : [];

      return result.ok
        ? {
            ok: true,
            detailText: result.detailText,
            ...(attachments.length ? { attachments } : {}),
            isError: result.isError,
            ...(result.structuredContent !== undefined ? { structuredContent: result.structuredContent } : {})
          }
        : result;
    },
    saveArchiveEntryAsCodeCard: async (target, entry, title, language, tags, openInCollection) => {
      const archiveEntry = await readConversationArchiveEntryText(getConversationMessages(), target, entry);
      if (!archiveEntry.ok) return archiveEntry;

      const saveResult = collection.saveCardFromChat({
        title: title || archiveEntry.entry.path.split('/').pop() || archiveEntry.entry.path,
        language: language || archiveEntry.inferredLanguage,
        code: archiveEntry.text,
        tags,
        ownerCollaboratorId: writeOwnerCollaboratorId,
        conversationId,
        messageId: `${archiveEntry.attachment.id}:${archiveEntry.entry.path}`,
        blockIndex: 0,
        blockTitle: archiveEntry.entry.path
      });

      if (!saveResult) return { ok: false, error: '保存压缩包文件失败。' };
      space.setActiveCard(saveResult.cardId);
      space.spotlightCard(saveResult.cardId);
      if (openInCollection) {
        revealCollectionShelf(space, 'code');
      }
      return {
        ok: true,
        cardId: saveResult.cardId,
        created: saveResult.created,
        title: saveResult.title
      };
    },
    readCodeCardState: async (cardId) => await ensureRoomState(cardId),
    writeCodeCardState: (cardId, state) => {
      updateRoomState(cardId, state);
    }
  };
}
