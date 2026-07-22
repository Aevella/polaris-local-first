import {
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
import { readWebPageContent, runWebSearch } from '../../engines/webSearchTool';
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
import {
  createNativeCalendarEvent,
  deleteNativeCalendarEvent,
  listNativeCalendars,
  readNativeCalendarEvents,
  updateNativeCalendarEvent
} from '../../native/personalData';
import type { ChatAttachment, ImageAssetCard } from '../../types/domain';
import { revealCollectionShelf } from '../shell/frontstageNavigation';
import { getProductDoc, readProductDocByTopic } from '../shell/productDocs';
import { inspectCurrentThemeRender } from '../theme/themeRenderInspection';
import { buildCollectionToolContextPorts } from './chatToolCollectionContext';
import { buildDesktopToolExecutionContext } from './chatDesktopToolExecutionContext';
import { buildEnvironmentToolExecutionContext } from './chatEnvironmentToolExecutionContext';
import { buildMcpToolExecutionContext } from './chatMcpToolExecutionContext';
import { buildProactiveToolExecutionContext } from './chatProactiveToolExecutionContext';
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
  const getLatestRuntimeSearchConfig = () => runtime.readLatestState?.().search ?? runtime.search;
  const getConversationMessages = () => chat.getConversationMessages(conversationId);
  const writeOwnerCollaboratorId = ownerCollaboratorId ?? undefined;
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
    ...buildEnvironmentToolExecutionContext({
      chat,
      collection,
      persona,
      runtime,
      space,
      memoryActions,
      conversationId,
      ownerCollaboratorId,
      activeProjectId
    }),
    ...buildProactiveToolExecutionContext({ runtime, ownerCollaboratorId, conversationId }),
    inspectAttachments: (scope, query) => inspectConversationAttachments(getConversationMessages(), scope, query),
    webSearch: (query, maxResults) => runWebSearch(query, maxResults, getLatestRuntimeSearchConfig()),
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
    ...buildDesktopToolExecutionContext({ collection, activeProjectId }),
    ...buildMcpToolExecutionContext({ runtime }),
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
