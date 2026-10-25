import { useEffect, useMemo, useRef, useState } from 'react';
import { MEMORY_RELEASE_GATES } from '../../../../config/memoryReleaseGates';
import { EditablePill } from '../EditablePill';
import { type PersonaTabProps } from '../personaUiShared';
import { PersonaToggle } from '../PersonaToggle';
import { createUid } from '../../../../engines/id';
import { orderMemoryReferenceDocsNewestFirst } from '../../../../engines/memoryReferenceDocs';
import {
  updateConversationSummaryMemoryForCollaborator,
  type ConversationSummaryMemoryProgress
} from '../../../../app/chat/conversationSummaryMemoryActions';
import {
  clearMemoryVectorIndexForCollaboratorAction,
  testMemoryVectorModelConnection,
  updateMemoryVectorIndexForCollaborator
} from '../../../../app/chat/memoryVectorIndexActions';
import {
  importMemoryReferenceDocFromFile,
  MEMORY_REFERENCE_DOC_ACCEPT
} from '../../../../engines/memoryReferenceDocImport';
import {
  readPersonaMemoryDocContent,
  stagePersonaMemoryDocContent,
  wouldEraseUnloadedPersonaMemoryDocContent
} from '../../../../stores/personaMemoryReferenceDocPersistence';
import { usePersonaStore } from '../../../../stores/personaStore';
import { useSwipeDelete } from '../../../collection/grid/useSwipeDelete';
import { useChatStore } from '../../../../stores/chatStore';
import { useRuntimeStore } from '../../../../stores/runtimeStore';
import { canUseNativeSystemFilePicker, pickNativeSystemFiles } from '../../../../native/systemPickedFiles';
import type { I18nKey } from '../../../../i18n/messages';
import type { I18nTranslator } from '../../../../i18n/translator';
import { useI18n } from '../../../../i18n/useI18n';
import type {
  Conversation,
  PersonaConversationSummary,
  PersonaConversationSummarySuppression,
  PersonaMemoryReferenceDoc,
  PersonaVectorIndexSettings,
  PersonaVectorIndexStatus
} from '../../../../types/domain';
import { resolveDocumentFilePickerAccept } from '../../../filePickerAccept';
import { Icon, type IconName } from '../../../Icon';

type MemoryPage = 'overview' | 'entries' | 'docs' | 'conversations' | 'index';

const MEMORY_PAGE_META: Record<MemoryPage, {
  labelKey: I18nKey;
  icon: IconName;
}> = {
  overview: { labelKey: 'memory.page.overview', icon: 'memoryShelf' },
  entries: { labelKey: 'memory.page.entries', icon: 'tag' },
  docs: { labelKey: 'memory.page.docs', icon: 'openBook' },
  conversations: { labelKey: 'memory.page.conversations', icon: 'inbox' },
  index: { labelKey: 'memory.page.index', icon: 'sparkle' }
};

function formatDocDate(updatedAt: number, i18n: I18nTranslator) {
  if (!Number.isFinite(updatedAt) || updatedAt <= 0) return i18n.t('memory.docs.notUpdated');
  return new Date(updatedAt).toLocaleDateString(i18n.language, {
    month: '2-digit',
    day: '2-digit'
  });
}

function formatSummaryDate(timestamp: number, i18n: I18nTranslator) {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return i18n.t('memory.summary.notRecorded');
  return new Date(timestamp).toLocaleDateString(i18n.language, {
    month: '2-digit',
    day: '2-digit'
  });
}

function formatConversationSummaryKind(kind: PersonaConversationSummary['kind'], t: I18nTranslator['t']) {
  return kind === 'relational_profile'
    ? t('memory.summary.kindRelational')
    : t('memory.summary.kindRecent');
}

function formatConversationSummaryGenerator(generator: PersonaConversationSummary['generator'], t: I18nTranslator['t']) {
  return generator === 'small_model'
    ? t('memory.summary.generatorSmallModel')
    : t('memory.summary.generatorManual');
}

type ConversationSummarySourceTimeLookup = {
  messageTimestamps: Map<string, number>;
  conversationTimestamps: Map<string, number>;
};

function buildConversationSummarySourceTimeLookup(conversations: Conversation[]): ConversationSummarySourceTimeLookup {
  const messageTimestamps = new Map<string, number>();
  const conversationTimestamps = new Map<string, number>();

  conversations.forEach((conversation) => {
    if (Number.isFinite(conversation.updatedAt) && conversation.updatedAt > 0) {
      conversationTimestamps.set(conversation.id, conversation.updatedAt);
    }
    conversation.messages.forEach((message) => {
      if (Number.isFinite(message.timestamp) && message.timestamp > 0) {
        messageTimestamps.set(message.id, message.timestamp);
      }
    });
  });

  return { messageTimestamps, conversationTimestamps };
}

function getConversationSummarySourceTimestamps(
  summary: PersonaConversationSummary,
  lookup: ConversationSummarySourceTimeLookup
) {
  const timestamps = summary.sourceMessageIds
    .map((messageId) => lookup.messageTimestamps.get(messageId))
    .filter((timestamp): timestamp is number => typeof timestamp === 'number');

  if (timestamps.length > 0) return timestamps;

  return summary.sourceConversationIds
    .map((conversationId) => lookup.conversationTimestamps.get(conversationId))
    .filter((timestamp): timestamp is number => typeof timestamp === 'number');
}

function getConversationSummaryLatestSourceTimestamp(
  summary: PersonaConversationSummary,
  lookup: ConversationSummarySourceTimeLookup
) {
  const timestamps = getConversationSummarySourceTimestamps(summary, lookup);
  return timestamps.length > 0 ? Math.max(...timestamps) : 0;
}

function sortConversationSummariesBySourceTime(
  lookup: ConversationSummarySourceTimeLookup
) {
  return (left: PersonaConversationSummary, right: PersonaConversationSummary) => {
    if (left.kind !== right.kind) {
      return left.kind === 'relational_profile' ? -1 : 1;
    }
    if (left.kind === 'relational_profile') {
      return left.sequence - right.sequence;
    }
    const leftSourceTime = getConversationSummaryLatestSourceTimestamp(left, lookup);
    const rightSourceTime = getConversationSummaryLatestSourceTimestamp(right, lookup);
    return (rightSourceTime || right.updatedAt) - (leftSourceTime || left.updatedAt);
  };
}

function formatConversationSummarySource(summary: PersonaConversationSummary, t: I18nTranslator['t']) {
  const conversationCount = new Set(summary.sourceConversationIds).size;
  const messageCount = new Set(summary.sourceMessageIds).size;
  if (conversationCount === 0 && messageCount === 0) return t('memory.summary.sourceNone');
  return t('memory.summary.sourceCounts', { conversations: conversationCount, messages: messageCount });
}

function formatConversationSummarySourceDate(
  summary: PersonaConversationSummary,
  lookup: ConversationSummarySourceTimeLookup,
  i18n: I18nTranslator
) {
  const timestamps = getConversationSummarySourceTimestamps(summary, lookup);
  if (timestamps.length === 0) return i18n.t('memory.summary.sourceUnknown');

  const earliest = Math.min(...timestamps);
  const latest = Math.max(...timestamps);
  const earliestText = formatSummaryDate(earliest, i18n);
  const latestText = formatSummaryDate(latest, i18n);

  return earliestText === latestText
    ? i18n.t('memory.summary.sourceSingleDate', { date: latestText })
    : i18n.t('memory.summary.sourceDateRange', { from: earliestText, to: latestText });
}

function formatConversationSummaryProgressStage(progress: ConversationSummaryMemoryProgress, t: I18nTranslator['t']) {
  switch (progress.stage) {
    case 'queued':
      return t('memory.summary.progressQueued');
    case 'reading_source':
      return t('memory.summary.progressReadingSource');
    case 'planning':
      return t('memory.summary.progressPlanning');
    case 'summarizing':
      return progress.totalBatches > 0 && progress.currentBatchSequence
        ? t('memory.summary.progressSummarizingBatch', {
            current: progress.currentBatchSequence,
            total: progress.totalBatches
          })
        : t('memory.summary.progressSummarizingModel');
    case 'summarized':
      return t('memory.summary.progressSummarized');
    case 'saving':
      return t('memory.summary.progressSaving');
    case 'completed':
      return t('memory.summary.progressCompleted');
    case 'disabled':
      return t('memory.summary.progressDisabled');
    case 'empty':
      return t('memory.summary.progressEmpty');
    default:
      return t('memory.summary.progressFallback');
  }
}

function getConversationSummaryProgressPercent(progress: ConversationSummaryMemoryProgress) {
  if (progress.stage === 'completed' || progress.stage === 'disabled' || progress.stage === 'empty') return 100;
  if (progress.stage === 'queued') return 6;
  if (progress.stage === 'reading_source') return 14;
  if (progress.stage === 'planning') return 22;
  if (progress.stage === 'saving') return 94;
  if (progress.stage === 'summarized') return 88;
  if (progress.stage === 'summarizing') {
    const total = Math.max(1, progress.totalBatches);
    const completed = Math.min(total, Math.max(0, progress.completedBatches));
    return Math.min(86, 24 + Math.round((completed / total) * 60));
  }
  return 0;
}

function canContinueConversationSummaryRunAfterError(progress: ConversationSummaryMemoryProgress | null) {
  if (!progress) return false;
  if (progress.stage === 'disabled' || progress.stage === 'empty') return false;
  return progress.generatedCount > 0;
}

function formatConversationSummaryProgressMeta(progress: ConversationSummaryMemoryProgress, t: I18nTranslator['t']) {
  if (progress.stage === 'queued') {
    return [];
  }
  if (
    progress.stage === 'reading_source'
    && progress.sourceConversationCount === 0
    && progress.sourceMessageCount === 0
  ) {
    return [t('memory.summary.progressReadingLocal')];
  }
  const items = [
    t('memory.summary.progressSourceConversations', { count: progress.sourceConversationCount }),
    t('memory.summary.progressSourceMessages', { count: progress.sourceMessageCount })
  ];
  if (progress.totalBatches > 0) {
    items.push(t('memory.summary.progressBatches', {
      completed: progress.completedBatches,
      total: progress.totalBatches
    }));
  }
  if (progress.generatedCount > 0 || progress.stage === 'completed' || progress.stage === 'saving') {
    items.push(t('memory.summary.progressGenerated', { count: progress.generatedCount }));
  }
  if (progress.model) {
    items.push(progress.model);
  }
  return items;
}

function sourceMessageKey(sourceMessageIds: string[]) {
  return sourceMessageIds.join('\u001f');
}

function buildConversationSummarySuppressions(
  summaries: PersonaConversationSummary[],
  reason: PersonaConversationSummarySuppression['reason'],
  now = Date.now()
) {
  return summaries
    .filter((summary) => summary.generator === 'small_model' && summary.sourceMessageIds.length > 0)
    .map((summary) => ({
      id: createUid('conversation-summary-suppression'),
      sourceConversationIds: summary.sourceConversationIds,
      sourceMessageIds: summary.sourceMessageIds,
      sourceCharCount: summary.sourceCharCount,
      reason,
      suppressedAt: now
    }));
}

function mergeConversationSummarySuppressions(
  current: PersonaConversationSummarySuppression[],
  additions: PersonaConversationSummarySuppression[]
) {
  if (additions.length === 0) return current;
  const additionKeys = new Set(additions.map((suppression) => sourceMessageKey(suppression.sourceMessageIds)));
  return [
    ...current.filter((suppression) => !additionKeys.has(sourceMessageKey(suppression.sourceMessageIds))),
    ...additions
  ];
}

const DEFAULT_VECTOR_INDEX_SETTINGS: PersonaVectorIndexSettings = {
  enabled: false,
  providerId: '',
  modelOverride: '',
  dimensions: null,
  status: 'idle',
  indexedChunkCount: 0,
  totalChunkCount: 0,
  lastIndexedAt: 0,
  lastError: ''
};

type ConversationSummaryEditDraft = {
  id: string;
  title: string;
  content: string;
};

function normalizeVectorIndexSettings(settings?: PersonaVectorIndexSettings | null): PersonaVectorIndexSettings {
  return {
    ...DEFAULT_VECTOR_INDEX_SETTINGS,
    ...settings,
    providerId: settings?.providerId?.trim() ?? '',
    modelOverride: settings?.modelOverride?.trim() ?? '',
    dimensions: typeof settings?.dimensions === 'number' && Number.isFinite(settings.dimensions)
      ? Math.max(0, Math.floor(settings.dimensions))
      : null,
    status: settings?.status ?? 'idle',
    indexedChunkCount: typeof settings?.indexedChunkCount === 'number' && Number.isFinite(settings.indexedChunkCount)
      ? Math.max(0, Math.floor(settings.indexedChunkCount))
      : 0,
    totalChunkCount: typeof settings?.totalChunkCount === 'number' && Number.isFinite(settings.totalChunkCount)
      ? Math.max(0, Math.floor(settings.totalChunkCount))
      : 0,
    lastIndexedAt: typeof settings?.lastIndexedAt === 'number' && Number.isFinite(settings.lastIndexedAt)
      ? Math.max(0, Math.floor(settings.lastIndexedAt))
      : 0,
    lastError: settings?.lastError?.trim() ?? ''
  };
}

function formatVectorIndexStatus(status: PersonaVectorIndexStatus | undefined, t: I18nTranslator['t']) {
  switch (status) {
    case 'indexing':
      return t('memory.vector.statusIndexing');
    case 'paused':
      return t('memory.vector.statusPaused');
    case 'needs_rebuild':
      return t('memory.vector.statusNeedsRebuild');
    case 'failed':
      return t('memory.vector.statusFailed');
    case 'idle':
    default:
      return t('memory.vector.statusIdle');
  }
}

function formatVectorIndexUpdatedAt(timestamp: number | undefined, i18n: I18nTranslator) {
  if (!timestamp) return i18n.t('memory.vector.notUpdated');
  return new Date(timestamp).toLocaleString(i18n.language, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function summarizeDoc(doc: PersonaMemoryReferenceDoc, t: I18nTranslator['t']) {
  const summary = doc.summary.trim();
  if (summary) return summary;
  const content = doc.contentLoaded ? doc.content.trim().replace(/\s+/g, ' ') : '';
  return content ? content.slice(0, 64) : t('memory.docs.defaultSummary');
}

type MemoryReferenceDocCardProps = {
  doc: PersonaMemoryReferenceDoc;
  editing: boolean;
  confirmingDelete: boolean;
  i18n: I18nTranslator;
  onOpen: () => void;
  onUpdate: (patch: Partial<Pick<PersonaMemoryReferenceDoc, 'title' | 'summary' | 'content'>>) => void;
  onCloseEditor: () => void;
  onToggleEditorDelete: () => void;
  onRemove: () => void;
};

function MemoryReferenceDocCard({
  doc,
  editing,
  confirmingDelete,
  i18n,
  onOpen,
  onUpdate,
  onCloseEditor,
  onToggleEditorDelete,
  onRemove
}: MemoryReferenceDocCardProps) {
  const { t } = i18n;
  const swipeDelete = useSwipeDelete(editing);
  const [deleteArmed, setDeleteArmed] = useState(false);

  useEffect(() => {
    if (!swipeDelete.open) setDeleteArmed(false);
  }, [swipeDelete.open]);

  const handleOpen = () => {
    if (swipeDelete.open) {
      swipeDelete.close();
      return;
    }
    swipeDelete.close();
    onOpen();
  };

  const handleSwipeDelete = () => {
    if (!deleteArmed) {
      setDeleteArmed(true);
      return;
    }
    swipeDelete.close();
    onRemove();
  };

  return (
    <div
      className={`memory-entry-card${editing ? ' memory-entry-card--open' : ''} ${swipeDelete.open ? 'swipe-open' : ''} ${swipeDelete.dragging ? 'swiping' : ''}`}
      style={swipeDelete.style}
      {...swipeDelete.swipeProps}
    >
      <button
        type="button"
        className={`memory-entry-swipe-delete ${deleteArmed ? 'is-armed' : ''}`}
        data-swipe-delete-action="true"
        onClick={handleSwipeDelete}
        aria-label={`${deleteArmed ? t('memory.docs.confirmDelete') : t('memory.docs.delete')} ${doc.title || doc.id}`}
      >
        {deleteArmed ? t('memory.docs.confirmDelete') : t('memory.docs.delete')}
      </button>
      <div className="memory-entry-swipe-surface">
        <button
          type="button"
          className="memory-entry-top"
          onClick={handleOpen}
        >
          <span className="memory-entry-dot" />
          <span className="memory-entry-main">
            <span className="memory-entry-title">{doc.title || t('memory.docs.untitled')}</span>
            <span className="memory-entry-summary">{doc.bodyStatus === 'missing' ? t('memory.docs.backupBodyMissing') : summarizeDoc(doc, t)}</span>
          </span>
          <span className="memory-entry-meta">{t('memory.docs.meta', {
            date: formatDocDate(doc.updatedAt, i18n),
            count: doc.charCount ?? doc.content.length
          })}</span>
        </button>
        {editing && (
          <div className="memory-entry-editor" data-swipe-delete-ignore="true">
            <input
              className="ps-input"
              value={doc.title}
              onChange={(e) => onUpdate({ title: e.target.value })}
              placeholder={t('memory.docs.titlePlaceholder')}
            />
            <input
              className="ps-input"
              value={doc.summary}
              onChange={(e) => onUpdate({ summary: e.target.value })}
              placeholder={t('memory.docs.summaryPlaceholder')}
            />
            <textarea
              className="ps-textarea memory-entry-content"
              value={doc.content}
              onChange={(e) => onUpdate({ content: e.target.value })}
              placeholder={t('memory.docs.contentPlaceholder')}
            />
            <div className="memory-entry-editor-actions">
              <button
                type="button"
                className="memory-entry-save"
                onClick={onCloseEditor}
              >
                {t('memory.docs.save')}
              </button>
              <div className="memory-entry-danger-actions">
                <button
                  type="button"
                  className="memory-entry-remove"
                  onClick={onToggleEditorDelete}
                >
                  {confirmingDelete ? t('memory.docs.cancelDelete') : t('memory.docs.delete')}
                </button>
                {confirmingDelete ? (
                  <button
                    type="button"
                    className="memory-entry-remove memory-entry-remove--confirm"
                    onClick={onRemove}
                  >
                    {t('memory.docs.confirmDelete')}
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function MemorySettingsTab({ activePersona, onUpdatePersona }: PersonaTabProps) {
  const i18n = useI18n();
  const { t } = i18n;
  const memories = activePersona?.memory.personalMemories ?? [];
  const referenceDocs = activePersona?.memory.referenceDocs ?? [];
  const conversationSummaries = activePersona?.memory.conversationSummaries ?? [];
  const conversations = useChatStore((state) => state.conversations);
  const crossConversationRecallEnabled = activePersona?.memory.crossConversationRecallEnabled !== false;
  const memoryVectorRetrieval = useRuntimeStore((state) => state.memoryVectorRetrieval);
  const setMemoryVectorRetrieval = useRuntimeStore((state) => state.setMemoryVectorRetrieval);
  const vectorIndex = normalizeVectorIndexSettings(activePersona?.memory.vectorIndex);
  const vectorRetrievalEnabled = memoryVectorRetrieval.enabled === true;
  const vectorModelConfigured = Boolean(
    memoryVectorRetrieval.baseUrl?.trim()
    && memoryVectorRetrieval.apiKey?.trim()
    && memoryVectorRetrieval.model?.trim()
  );
  const vectorIndexedChunkCount = vectorIndex.indexedChunkCount ?? 0;
  const vectorTotalChunkCount = vectorIndex.totalChunkCount ?? 0;
  const vectorIndexProgress = vectorTotalChunkCount > 0
    ? Math.min(100, Math.round((vectorIndexedChunkCount / vectorTotalChunkCount) * 100))
    : 0;
  const conversationSummarySourceTimeLookup = useMemo(
    () => buildConversationSummarySourceTimeLookup(conversations),
    [conversations]
  );
  const visibleConversationSummaries = useMemo(
    () => [...conversationSummaries].sort(sortConversationSummariesBySourceTime(conversationSummarySourceTimeLookup)),
    [conversationSummaries, conversationSummarySourceTimeLookup]
  );
  const visibleReferenceDocs = orderMemoryReferenceDocsNewestFirst(referenceDocs);
  const [draft, setDraft] = useState('');
  const [docTitleDraft, setDocTitleDraft] = useState('');
  const [editingDocId, setEditingDocId] = useState<string | null>(null);
  const [confirmingDeleteDocId, setConfirmingDeleteDocId] = useState<string | null>(null);
  const [importingDoc, setImportingDoc] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [summarizingConversations, setSummarizingConversations] = useState(false);
  const [summaryContinuationAvailable, setSummaryContinuationAvailable] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [summaryProgress, setSummaryProgress] = useState<ConversationSummaryMemoryProgress | null>(null);
  const [editingSummaryDraft, setEditingSummaryDraft] = useState<ConversationSummaryEditDraft | null>(null);
  const summaryAbortControllerRef = useRef<AbortController | null>(null);
  const summaryRunIdRef = useRef(0);
  const tRef = useRef(t);
  const [indexingVector, setIndexingVector] = useState(false);
  const [testingVectorConnection, setTestingVectorConnection] = useState(false);
  const [vectorConnectionResult, setVectorConnectionResult] = useState<string | null>(null);
  const [vectorError, setVectorError] = useState<string | null>(null);
  const [activeMemoryPage, setActiveMemoryPage] = useState<MemoryPage>('overview');
  const [vectorConfigOpen, setVectorConfigOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const referenceDocAccept = resolveDocumentFilePickerAccept(MEMORY_REFERENCE_DOC_ACCEPT);
  const canRebuildVectorIndex = Boolean(
    activePersona
    && crossConversationRecallEnabled
    && vectorRetrievalEnabled
    && vectorModelConfigured
    && !indexingVector
    && !testingVectorConnection
  );
  const canTestVectorConnection = vectorModelConfigured && !testingVectorConnection && !indexingVector;
  const memoryPages: MemoryPage[] = [
    'overview',
    'entries',
    'docs',
    ...(MEMORY_RELEASE_GATES.showCollaboratorConversationSummaryStatus
      ? ['conversations' as const]
      : []),
    ...(MEMORY_RELEASE_GATES.showVectorIndexSettings
      ? ['index' as const]
      : [])
  ];
  const isMemoryPageDisabled = (page: MemoryPage) => (
    (page === 'conversations' || page === 'index') && !crossConversationRecallEnabled
  );

  useEffect(() => {
    if (!memoryPages.includes(activeMemoryPage) || isMemoryPageDisabled(activeMemoryPage)) {
      setActiveMemoryPage('overview');
    }
  }, [activeMemoryPage, memoryPages, crossConversationRecallEnabled]);

  useEffect(() => {
    tRef.current = t;
  }, [t]);

  useEffect(() => () => {
    summaryRunIdRef.current += 1;
    summaryAbortControllerRef.current?.abort(new Error(tRef.current('memory.summary.cancelledError')));
    summaryAbortControllerRef.current = null;
  }, []);

  useEffect(() => {
    setSummaryContinuationAvailable(false);
    setEditingSummaryDraft(null);
  }, [activePersona?.id]);

  const addMemory = () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    onUpdatePersona({ memory: { personalMemories: [...memories, trimmed] } });
    setDraft('');
  };

  const removeMemory = (i: number) => {
    const target = memories[i]?.trim();
    if (!target) return;
    if (!window.confirm(t('memory.entries.deleteConfirm', { memory: target }))) return;
    onUpdatePersona({ memory: { personalMemories: memories.filter((_, idx) => idx !== i) } });
  };
  const editMemory = (i: number, text: string) => onUpdatePersona({ memory: { personalMemories: memories.map((m, idx) => (idx === i ? text : m)) } });
  const clearConversationSummaries = () => {
    if (conversationSummaries.length === 0) return;
    if (!window.confirm(t('memory.summary.deleteAllConfirm'))) return;
    const suppressedSources = buildConversationSummarySuppressions(conversationSummaries, 'user_cleared');
    onUpdatePersona({
      memory: {
        conversationSummaries: [],
        conversationSummarySuppressions: mergeConversationSummarySuppressions(
          activePersona?.memory.conversationSummarySuppressions ?? [],
          suppressedSources
        )
      }
    });
    setSummaryContinuationAvailable(false);
  };
  const removeConversationSummary = (summaryId: string) => {
    const target = conversationSummaries.find((summary) => summary.id === summaryId);
    if (!target) return;
    if (!window.confirm(t('memory.summary.deleteOneConfirm', {
      title: target.title || t('memory.summary.untitled')
    }))) return;
    const suppressedSources = buildConversationSummarySuppressions([target], 'user_deleted');
    onUpdatePersona({
      memory: {
        conversationSummaries: conversationSummaries.filter((summary) => summary.id !== summaryId),
        conversationSummarySuppressions: mergeConversationSummarySuppressions(
          activePersona?.memory.conversationSummarySuppressions ?? [],
          suppressedSources
        )
      }
    });
    if (editingSummaryDraft?.id === summaryId) {
      setEditingSummaryDraft(null);
    }
  };
  const startEditingConversationSummary = (summary: PersonaConversationSummary) => {
    setEditingSummaryDraft({
      id: summary.id,
      title: summary.title,
      content: summary.content
    });
  };
  const cancelEditingConversationSummary = () => {
    setEditingSummaryDraft(null);
  };
  const updateEditingConversationSummaryDraft = (patch: Partial<Pick<ConversationSummaryEditDraft, 'title' | 'content'>>) => {
    setEditingSummaryDraft((current) => current ? { ...current, ...patch } : current);
  };
  const saveEditingConversationSummary = () => {
    if (!editingSummaryDraft) return;
    const title = editingSummaryDraft.title.trim();
    const content = editingSummaryDraft.content.trim();
    if (!title || !content) return;
    onUpdatePersona({
      memory: {
        conversationSummaries: conversationSummaries.map((summary) => (
          summary.id === editingSummaryDraft.id
            ? {
                ...summary,
                title,
                content,
                generator: 'manual',
                updatedAt: Date.now()
              }
            : summary
        ))
      }
    });
    setEditingSummaryDraft(null);
  };

  const addReferenceDoc = () => {
    const title = docTitleDraft.trim();
    if (!title) return;
    const nextDoc: PersonaMemoryReferenceDoc = {
      id: createUid('memory-doc'),
      title,
      summary: '',
      content: '',
      charCount: 0,
      contentLoaded: false,
      source: 'user',
      updatedAt: Date.now()
    };
    onUpdatePersona({ memory: { referenceDocs: orderMemoryReferenceDocsNewestFirst([nextDoc, ...referenceDocs]) } });
    setDocTitleDraft('');
    setEditingDocId(null);
    setConfirmingDeleteDocId(null);
  };

  const importReferenceDocs = async (files: FileList | File[] | null) => {
    const selectedFiles = files ? Array.from(files) : [];
    if (!selectedFiles.length || importingDoc || !activePersona) return;

    setImportingDoc(true);
    setImportError(null);
    try {
      const importedResults = await Promise.allSettled(
        selectedFiles.map(async (file) => {
          const draftDoc = await importMemoryReferenceDocFromFile(file);
          const docId = createUid('memory-doc');
          stagePersonaMemoryDocContent(activePersona.id, docId, draftDoc.content);
          return {
            id: docId,
            title: draftDoc.title,
            summary: draftDoc.summary,
            content: draftDoc.content,
            charCount: draftDoc.content.length,
            contentLoaded: true,
            source: 'upload',
            updatedAt: Date.now()
          } satisfies PersonaMemoryReferenceDoc;
        })
      );
      const importedDocs = importedResults.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []);
      const failedMessages = importedResults.flatMap((result) => (
        result.status === 'rejected'
          ? [result.reason instanceof Error ? result.reason.message : t('memory.docs.importFailed')]
          : []
      ));
      if (failedMessages.length) {
        setImportError(failedMessages.join('；'));
      }
      if (!importedDocs.length) return;
      onUpdatePersona({
        memory: {
          referenceDocs: orderMemoryReferenceDocsNewestFirst([...importedDocs, ...referenceDocs])
        }
      });
      try {
        await usePersonaStore.getState().persistToDb();
      } catch {
        setImportError(t('memory.docs.persistFailed'));
      }
      setEditingDocId(null);
      setConfirmingDeleteDocId(null);
    } finally {
      setImportingDoc(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };
  const openReferenceDocPicker = async () => {
    if (importingDoc) return;
    if (canUseNativeSystemFilePicker()) {
      const files = await pickNativeSystemFiles({
        accept: MEMORY_REFERENCE_DOC_ACCEPT,
        multiple: true
      });
      await importReferenceDocs(files);
      return;
    }
    fileInputRef.current?.click();
  };

  const updateReferenceDoc = (docId: string, patch: Partial<Pick<PersonaMemoryReferenceDoc, 'title' | 'summary' | 'content'>>) => {
    const targetDoc = referenceDocs.find((doc) => doc.id === docId);
    if (targetDoc && patch.content !== undefined && wouldEraseUnloadedPersonaMemoryDocContent(targetDoc, patch.content)) {
      setImportError(t('memory.docs.bodyMissing'));
      return;
    }
    if (activePersona && patch.content !== undefined) {
      stagePersonaMemoryDocContent(activePersona.id, docId, patch.content);
    }
    onUpdatePersona({
      memory: {
        referenceDocs: orderMemoryReferenceDocsNewestFirst(
          referenceDocs.map((doc) => (
            doc.id === docId
              ? {
                  ...doc,
                  ...patch,
                  charCount: patch.content !== undefined ? patch.content.length : doc.charCount,
                  contentLoaded: patch.content !== undefined ? true : doc.contentLoaded,
                  bodyStatus: patch.content !== undefined ? undefined : doc.bodyStatus,
                  updatedAt: Date.now()
                }
              : doc
          ))
        )
      }
    });
  };

  const removeReferenceDoc = (docId: string) => {
    const target = referenceDocs.find((doc) => doc.id === docId);
    if (!target) return;
    const nextDocs = referenceDocs.filter((doc) => doc.id !== docId);
    onUpdatePersona({ memory: { referenceDocs: nextDocs } });
    setEditingDocId(null);
    setConfirmingDeleteDocId(null);
  };

  const openReferenceDoc = async (doc: PersonaMemoryReferenceDoc, editing: boolean) => {
    if (editing) {
      setEditingDocId(null);
      setConfirmingDeleteDocId(null);
      return;
    }
    setConfirmingDeleteDocId(null);
    if (!activePersona) return;
    if (doc.bodyStatus === 'missing' || doc.contentLoaded) {
      setEditingDocId(doc.id);
      return;
    }
    try {
      const content = await readPersonaMemoryDocContent(activePersona.id, doc);
      updateReferenceDoc(doc.id, { content });
      setEditingDocId(doc.id);
    } catch {
      setImportError(t('memory.docs.bodyMissing'));
      setEditingDocId(doc.id);
    }
  };

  const updateConversationSummaries = async () => {
    if (summarizingConversations) {
      summaryRunIdRef.current += 1;
      summaryAbortControllerRef.current?.abort(new Error(t('memory.summary.pausedError')));
      summaryAbortControllerRef.current = null;
      setSummarizingConversations(false);
      setSummaryContinuationAvailable(true);
      setSummaryProgress(null);
      setSummaryError(null);
      return;
    }
    if (!activePersona) return;
    const controller = new AbortController();
    const runId = summaryRunIdRef.current + 1;
    summaryRunIdRef.current = runId;
    summaryAbortControllerRef.current = controller;
    setSummarizingConversations(true);
    setSummaryContinuationAvailable(false);
    setSummaryError(null);
    setSummaryProgress({
      stage: 'queued',
      collaboratorId: activePersona.id,
      totalBatches: 0,
      completedBatches: 0,
      generatedCount: 0,
      sourceConversationCount: 0,
      sourceMessageCount: 0,
      sourceCharCount: 0
    });
    let latestRunProgress: ConversationSummaryMemoryProgress | null = null;
    try {
      const result = await updateConversationSummaryMemoryForCollaborator(activePersona.id, {
        signal: controller.signal,
        priority: 'foreground',
        replaceExisting: true,
        onProgress: (progress) => {
          latestRunProgress = progress;
          if (summaryRunIdRef.current === runId) {
            setSummaryProgress(progress);
          }
        }
      });
      if (summaryRunIdRef.current !== runId) return;
      if (result.status === 'disabled') {
        setSummaryError(t('memory.summary.disabledError'));
      } else if (result.status === 'empty') {
        setSummaryError(t('memory.summary.emptyError'));
      } else if (result.generatedCount === 0) {
        setSummaryError(t('memory.summary.noGeneratedError'));
      }
      setSummaryContinuationAvailable(false);
    } catch (error) {
      if (summaryRunIdRef.current === runId) {
        setSummaryError(error instanceof Error ? error.message : t('memory.summary.failedError'));
        setSummaryContinuationAvailable(canContinueConversationSummaryRunAfterError(latestRunProgress));
        setSummaryProgress(null);
      }
    } finally {
      if (summaryAbortControllerRef.current === controller) {
        summaryAbortControllerRef.current = null;
      }
      if (summaryRunIdRef.current === runId) {
        setSummarizingConversations(false);
      }
    }
  };

  const conversationSummaryActionIcon = summarizingConversations
    ? 'pause'
    : summaryContinuationAvailable
      ? 'play'
      : 'sparkle';
  const conversationSummaryActionLabel = summarizingConversations
    ? t('memory.summary.pause')
    : summaryContinuationAvailable
      ? t('memory.summary.continue')
      : t('memory.summary.update');

  const updateVectorIndexStatus = (patch: Partial<Pick<PersonaVectorIndexSettings, 'status' | 'lastError'>>) => {
    onUpdatePersona({
      memory: {
        vectorIndex: normalizeVectorIndexSettings({
          ...vectorIndex,
          ...patch
        })
      }
    });
  };

  const rebuildVectorIndex = async () => {
    if (!activePersona || !crossConversationRecallEnabled || !vectorRetrievalEnabled || indexingVector) return;
    setIndexingVector(true);
    setVectorError(null);
    setVectorConnectionResult(null);
    try {
      const result = await updateMemoryVectorIndexForCollaborator(activePersona.id);
      if (result.status === 'disabled') {
        setVectorError(t('memory.vector.disabledError'));
      } else if (result.status === 'empty') {
        setVectorError(t('memory.vector.noHistoryError'));
      } else if (result.preparedChunkCount === 0) {
        setVectorError(t('memory.vector.noPreparedChunksError'));
      }
    } catch (error) {
      setVectorError(error instanceof Error ? error.message : t('memory.vector.rebuildFailed'));
    } finally {
      setIndexingVector(false);
    }
  };

  const clearVectorIndexSettings = async () => {
    if (!activePersona) return;
    onUpdatePersona({
      memory: {
        vectorIndex: {
          ...DEFAULT_VECTOR_INDEX_SETTINGS
        }
      }
    });
    setVectorError(null);
    await clearMemoryVectorIndexForCollaboratorAction(activePersona.id);
  };

  const toggleCrossConversationRecall = () => {
    const nextEnabled = !(activePersona?.memory.crossConversationRecallEnabled ?? true);
    onUpdatePersona({
      memory: {
        crossConversationRecallEnabled: nextEnabled
      }
    });
  };

  const toggleVectorRetrieval = () => {
    setVectorError(null);
    setVectorConnectionResult(null);
    setMemoryVectorRetrieval({ enabled: !vectorRetrievalEnabled });
  };

  const updateVectorModelConfig = (patch: Parameters<typeof setMemoryVectorRetrieval>[0]) => {
    setVectorError(null);
    setVectorConnectionResult(null);
    setMemoryVectorRetrieval(patch);
    updateVectorIndexStatus({ status: 'needs_rebuild', lastError: '' });
  };

  const testVectorConnection = async () => {
    if (!canTestVectorConnection) return;
    setTestingVectorConnection(true);
    setVectorError(null);
    setVectorConnectionResult(null);
    try {
      const result = await testMemoryVectorModelConnection();
      setVectorConnectionResult(t('memory.vector.connectionSuccess', { dimensions: result.returnedDimensions }));
    } catch (error) {
      setVectorError(error instanceof Error ? error.message : t('memory.vector.connectionFailed'));
    } finally {
      setTestingVectorConnection(false);
    }
  };

  return (
    <div className="memory-settings-flow">
      <div className="room-theme-page-nav memory-page-nav" role="tablist" aria-label={t('memory.pageNavAria')}>
        {memoryPages.map((page) => (
          <button
            key={page}
            type="button"
            role="tab"
            aria-selected={activeMemoryPage === page}
            disabled={isMemoryPageDisabled(page)}
            className={activeMemoryPage === page ? 'active' : ''}
            onClick={() => setActiveMemoryPage(page)}
          >
            <Icon name={MEMORY_PAGE_META[page].icon} size={14} />
            <span>{t(MEMORY_PAGE_META[page].labelKey)}</span>
          </button>
        ))}
      </div>

      {activeMemoryPage === 'overview' ? (
        <>
      <div className="ps-toggle-stack">
        <PersonaToggle
          label={t('memory.overview.crossRecallLabel')}
          description={t('memory.overview.crossRecallDetail')}
          checked={crossConversationRecallEnabled}
          onToggle={toggleCrossConversationRecall}
        />
        <PersonaToggle
          label={t('memory.overview.vectorLabel')}
          description={t('memory.overview.vectorDetail')}
          checked={vectorRetrievalEnabled}
          onToggle={toggleVectorRetrieval}
        />
        <PersonaToggle
          label={t('memory.overview.inheritGlobalLabel')}
          description={t('memory.overview.inheritGlobalDetail')}
          checked={activePersona?.memory.inheritGlobal !== false}
          onToggle={() => onUpdatePersona({ memory: { inheritGlobal: !(activePersona?.memory.inheritGlobal ?? true) } })}
        />
        <PersonaToggle
          label={t('memory.overview.excludeGlobalLabel')}
          description={t('memory.overview.excludeGlobalDetail')}
          checked={activePersona?.memory.excludeFromGlobal === true}
          onToggle={() => onUpdatePersona({ memory: { excludeFromGlobal: !(activePersona?.memory.excludeFromGlobal ?? false) } })}
        />
      </div>

          <div className="memory-overview-grid">
            <div className="memory-overview-card">
              <span>{t('memory.overview.entriesTitle')}</span>
              <strong>{t('memory.overview.entriesCount', { count: memories.length })}</strong>
              <small>{t('memory.overview.entriesDetail')}</small>
            </div>
            <div className="memory-overview-card">
              <span>{t('memory.overview.docsTitle')}</span>
              <strong>{t('memory.overview.docsCount', { count: visibleReferenceDocs.length })}</strong>
              <small>{t('memory.overview.docsDetail')}</small>
            </div>
            <div className="memory-overview-card" data-muted={!crossConversationRecallEnabled}>
              <span>{t('memory.overview.summariesTitle')}</span>
              <strong>{t('memory.overview.summariesCount', { count: visibleConversationSummaries.length })}</strong>
              <small>{crossConversationRecallEnabled ? t('memory.overview.summariesActive') : t('memory.overview.summariesPaused')}</small>
            </div>
            <div className="memory-overview-card" data-muted={!crossConversationRecallEnabled || !vectorRetrievalEnabled}>
              <span>{t('memory.overview.vectorTitle')}</span>
              <strong>{formatVectorIndexStatus(vectorIndex.status, t)}</strong>
              <small>{t('memory.overview.vectorChunks', {
                indexed: vectorIndexedChunkCount,
                total: vectorTotalChunkCount,
                state: crossConversationRecallEnabled && vectorRetrievalEnabled
                  ? t('memory.overview.vectorReady')
                  : t('memory.overview.vectorPaused')
              })}</small>
            </div>
          </div>
        </>
      ) : null}

      {activeMemoryPage === 'index' && crossConversationRecallEnabled && MEMORY_RELEASE_GATES.showVectorIndexSettings ? (
        <div className="ps-field memory-settings-field">
          <div className="ps-field-head ps-field-head--meta-right">
            <span className="ps-field-label">{t('memory.vector.title')}</span>
            <span className="ps-field-hint">{formatVectorIndexStatus(vectorIndex.status, t)} · {t('memory.vector.chunkSummary', { indexed: vectorIndexedChunkCount, total: vectorTotalChunkCount })}</span>
          </div>
          <div className="memory-toggle memory-toggle--switch toolbox-toggle-row memory-vector-index-panel" data-checked={vectorRetrievalEnabled ? 'true' : 'false'}>
            <div className="toolbox-toggle-row-head">
              <div className="memory-toggle-copy toolbox-toggle-copy">
                <strong>
                  <span className="toolbox-toggle-icon" aria-hidden="true">
                    <Icon name="sparkle" size={13} />
                  </span>
                  {t('memory.vector.panelTitle')}
                </strong>
                <span>{vectorRetrievalEnabled ? t('memory.vector.panelOn') : t('memory.vector.panelOff')}</span>
              </div>
              <button
                type="button"
                className="memory-doc-import-btn memory-vector-config-btn"
                onClick={() => setVectorConfigOpen((isOpen) => !isOpen)}
              >
                <Icon name="settings" size={14} />
                <span>{vectorModelConfigured ? t('memory.vector.editModel') : t('memory.vector.configureModel')}</span>
              </button>
            </div>
            {vectorConfigOpen ? (
              <div className="toolbox-inline-config">
                <div className="settings-form memory-vector-config-form">
                  <label>Base URL</label>
                  <input
                    value={memoryVectorRetrieval.baseUrl ?? ''}
                    onChange={(event) => {
                      updateVectorModelConfig({ baseUrl: event.target.value });
                    }}
                    placeholder="https://api.openai.com/v1"
                  />
                  <label>API Key</label>
                  <input
                    type="password"
                    value={memoryVectorRetrieval.apiKey ?? ''}
                    onChange={(event) => {
                      updateVectorModelConfig({ apiKey: event.target.value });
                    }}
                    placeholder={t('memory.vector.apiKeyPlaceholder')}
                  />
                  <label>{t('memory.vector.modelLabel')}</label>
                  <input
                    value={memoryVectorRetrieval.model ?? ''}
                    onChange={(event) => {
                      updateVectorModelConfig({ model: event.target.value });
                    }}
                    placeholder="text-embedding-3-small"
                  />
                  <label>{t('memory.vector.pathLabel')}</label>
                  <input
                    value={memoryVectorRetrieval.path ?? '/embeddings'}
                    onChange={(event) => {
                      updateVectorModelConfig({ path: event.target.value });
                    }}
                    placeholder="/embeddings"
                  />
                  <label>{t('memory.vector.dimensionsLabel')}</label>
                  <input
                    inputMode="numeric"
                    value={memoryVectorRetrieval.dimensions ? String(memoryVectorRetrieval.dimensions) : ''}
                    onChange={(event) => {
                      const value = Number(event.target.value);
                      updateVectorModelConfig({
                        dimensions: Number.isFinite(value) && value > 0 ? value : null
                      });
                    }}
                    placeholder={t('memory.vector.dimensionsPlaceholder')}
                  />
                  <div className="memory-vector-config-test-row">
                    <button
                      type="button"
                      className="memory-doc-import-btn"
                      onClick={() => {
                        void testVectorConnection();
                      }}
                      disabled={!canTestVectorConnection}
                    >
                      <Icon name={testingVectorConnection ? 'refresh' : 'zap'} size={14} />
                      <span>{testingVectorConnection ? t('memory.vector.testing') : t('memory.vector.testConnection')}</span>
                    </button>
                    {vectorConnectionResult ? (
                      <span className="memory-vector-config-test-result">{vectorConnectionResult}</span>
                    ) : null}
                  </div>
                </div>
              </div>
            ) : null}
            <div className="toolbox-inline-config memory-vector-index-status">
              <div className="memory-vector-index-flow" aria-label={t('memory.vector.flowAria')}>
                <span data-active={vectorModelConfigured ? 'true' : 'false'}>{t('memory.vector.flowModel')}</span>
                <span data-active={vectorIndexedChunkCount > 0 ? 'true' : 'false'}>{t('memory.vector.flowIndex')}</span>
                <span data-active={vectorRetrievalEnabled && vectorIndexedChunkCount > 0 ? 'true' : 'false'}>{t('memory.vector.flowRecall')}</span>
              </div>
              <div className="memory-vector-index-progress" aria-label={t('memory.vector.progressAria', { progress: vectorIndexProgress })}>
                <div className="memory-vector-index-progress-copy">
                  <span>{t('memory.vector.chunkSummary', { indexed: vectorIndexedChunkCount, total: vectorTotalChunkCount })}</span>
                  <span>{formatVectorIndexUpdatedAt(vectorIndex.lastIndexedAt, i18n)}</span>
                </div>
                <div className="memory-vector-index-progress-track" aria-hidden="true">
                  <span className="memory-vector-index-progress-fill" style={{ width: `${vectorIndexProgress}%` }} />
              </div>
              <div className="memory-vector-index-meta">
                  <span>{formatVectorIndexStatus(vectorIndex.status, t)}</span>
                  {memoryVectorRetrieval.dimensions ? <span>{t('memory.vector.dimensionsValue', { dimensions: memoryVectorRetrieval.dimensions })}</span> : null}
                  {vectorIndex.lastError ? <span>{vectorIndex.lastError}</span> : null}
                </div>
              </div>
              <div className="memory-doc-import-row">
                <button
                  type="button"
                  className="memory-doc-import-btn"
                  onClick={() => {
                    void rebuildVectorIndex();
                  }}
                  disabled={!canRebuildVectorIndex}
                >
                  <Icon name={indexingVector || vectorIndex.status === 'indexing' ? 'refresh' : 'sparkle'} size={14} />
                  <span>{indexingVector || vectorIndex.status === 'indexing' ? t('memory.vector.indexing') : t('memory.vector.rebuild')}</span>
                </button>
                <button
                  type="button"
                  className="memory-doc-import-btn"
                  onClick={() => {
                    void clearVectorIndexSettings();
                  }}
                  disabled={indexingVector || (vectorIndexedChunkCount === 0 && vectorTotalChunkCount === 0 && !vectorIndex.lastIndexedAt && !vectorIndex.lastError)}
                >
                  <Icon name="trash" size={14} />
                  <span>{t('memory.vector.clear')}</span>
                </button>
                <span className="memory-doc-import-hint">
                  {vectorModelConfigured
                    ? t('memory.vector.readyHint')
                    : t('memory.vector.configureHint')}
                </span>
              </div>
              {vectorError ? (
                <div className="memory-doc-import-error">{vectorError}</div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {activeMemoryPage === 'conversations' && crossConversationRecallEnabled && MEMORY_RELEASE_GATES.showCollaboratorConversationSummaryStatus ? (
        <div className="ps-field memory-settings-field">
          <div className="ps-field-head ps-field-head--meta-right">
            <span className="ps-field-label">{t('memory.summary.title')}</span>
            <span className="ps-field-hint">{t('memory.summary.hint', { count: visibleConversationSummaries.length })}</span>
          </div>
          <div className="memory-doc-import-row">
            <button
              type="button"
              className="memory-doc-import-btn"
              onClick={() => {
                void updateConversationSummaries();
              }}
              disabled={!activePersona}
            >
              <Icon name={conversationSummaryActionIcon} size={14} />
              <span>{conversationSummaryActionLabel}</span>
            </button>
            <button
              type="button"
              className="memory-doc-import-btn"
              onClick={clearConversationSummaries}
              disabled={visibleConversationSummaries.length === 0}
            >
              <Icon name="trash" size={14} />
              <span>{t('memory.summary.clear')}</span>
            </button>
            <span className="memory-doc-import-hint">{t('memory.summary.help')}</span>
          </div>
          {summaryError ? (
            <div className="memory-doc-import-error">{summaryError}</div>
          ) : null}
          {summaryProgress ? (
            <div
              className="memory-vector-index-progress memory-summary-progress"
              aria-label={t('memory.summary.progressAria', { progress: getConversationSummaryProgressPercent(summaryProgress) })}
            >
              <div className="memory-vector-index-progress-copy">
                <span>{formatConversationSummaryProgressStage(summaryProgress, t)}</span>
                <strong>{getConversationSummaryProgressPercent(summaryProgress)}%</strong>
              </div>
              <div className="memory-vector-index-progress-track" aria-hidden="true">
                <span
                  className="memory-vector-index-progress-fill"
                  style={{ width: `${getConversationSummaryProgressPercent(summaryProgress)}%` }}
                />
              </div>
              <div className="memory-vector-index-meta">
                {formatConversationSummaryProgressMeta(summaryProgress, t).map((item) => (
                  <span key={item}>{item}</span>
                ))}
              </div>
            </div>
          ) : null}
          <div className="memory-summary-list">
            {visibleConversationSummaries.length === 0 ? (
              <div className="memory-empty-card">
                {t('memory.summary.emptyState')}
              </div>
            ) : null}
            {visibleConversationSummaries.map((summary) => {
              const editingSummary = editingSummaryDraft?.id === summary.id;
              return (
                <article className={`memory-summary-card${editingSummary ? ' memory-summary-card--editing' : ''}`} key={summary.id}>
                  <div className="memory-summary-head">
                    <div className="memory-summary-title-group">
                      <span className="memory-summary-kind">{formatConversationSummaryKind(summary.kind, t)}</span>
                      {editingSummary ? (
                        <input
                          className="memory-summary-title-input"
                          value={editingSummaryDraft.title}
                          onChange={(event) => updateEditingConversationSummaryDraft({ title: event.target.value })}
                          placeholder={t('memory.summary.titlePlaceholder')}
                        />
                      ) : (
                        <h4>{summary.title || t('memory.summary.untitled')}</h4>
                      )}
                    </div>
                    <button
                      type="button"
                      className="memory-summary-icon-action memory-summary-remove"
                      aria-label={t('memory.summary.removeAria', { title: summary.title || summary.id })}
                      onClick={() => removeConversationSummary(summary.id)}
                    >
                      <Icon name="trash" size={14} />
                    </button>
                  </div>
                  {editingSummary ? (
                    <textarea
                      className="memory-summary-content-input"
                      value={editingSummaryDraft.content}
                      onChange={(event) => updateEditingConversationSummaryDraft({ content: event.target.value })}
                      placeholder={t('memory.summary.contentPlaceholder')}
                    />
                  ) : (
                    <p className="memory-summary-content">{summary.content}</p>
                  )}
                  <div className="memory-summary-footer">
                    <div className="memory-summary-meta">
                      <span>{formatConversationSummaryGenerator(summary.generator, t)}</span>
                      <span>{formatConversationSummarySourceDate(summary, conversationSummarySourceTimeLookup, i18n)}</span>
                      <span>{formatConversationSummarySource(summary, t)}</span>
                      {summary.expiresAt ? <span>{t('memory.summary.expiresAt', { date: formatSummaryDate(summary.expiresAt, i18n) })}</span> : null}
                    </div>
                    <div className="memory-summary-actions">
                      {editingSummary ? (
                        <>
                          <button
                            type="button"
                            className="memory-summary-text-action"
                            onClick={cancelEditingConversationSummary}
                          >
                            {t('memory.summary.cancel')}
                          </button>
                          <button
                            type="button"
                            className="memory-summary-text-action memory-summary-text-action--primary"
                            onClick={saveEditingConversationSummary}
                            disabled={!editingSummaryDraft.title.trim() || !editingSummaryDraft.content.trim()}
                          >
                            {t('memory.summary.save')}
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          className="memory-summary-icon-action memory-summary-edit"
                          aria-label={t('memory.summary.editAria', { title: summary.title || summary.id })}
                          onClick={() => startEditingConversationSummary(summary)}
                        >
                          <Icon name="edit" size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      ) : null}

      {activeMemoryPage === 'entries' ? (
      <div className="ps-field memory-settings-field">
        <div className="ps-field-head ps-field-head--meta-right">
          <span className="ps-field-label">{t('memory.entries.title')}</span>
          <span className="ps-field-hint">{t('memory.entries.hint')}</span>
        </div>
        <div className="ps-mc-add">
          <input
            className="ps-mc-add-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={t('memory.entries.placeholder')}
            onKeyDown={(e) => { if (e.key === 'Enter') addMemory(); }}
          />
          {draft.trim() && (
            <button
              type="button"
              className="ps-mc-add-btn"
              onClick={addMemory}
              aria-label={t('memory.entries.addAria')}
            >+</button>
          )}
        </div>
        <div className="ps-mc-list">
          {memories.map((m, i) => (
            <EditablePill
              key={i}
              text={m}
              display="div"
              baseClassName="ps-mc"
              editingClassName="ps-mc--edit"
              inputClassName="ps-mc-input"
              textareaClassName="ps-mc-textarea"
              textClassName="ps-mc-text"
              removeButtonClassName="ps-mc-rm"
              removeLabel={t('memory.entries.removeAria', { memory: m })}
              leadingDotClassName="ps-mc-dot"
              multiline
              selectOnFocus={false}
              onRemove={() => removeMemory(i)}
              onEdit={(v) => editMemory(i, v)}
            />
          ))}
        </div>
      </div>
      ) : null}

      {activeMemoryPage === 'docs' ? (
      <div className="ps-field memory-settings-field">
        <div className="ps-field-head ps-field-head--meta-right">
          <span className="ps-field-label">{t('memory.docs.title')}</span>
          <span className="ps-field-hint">{t('memory.docs.hint', { count: visibleReferenceDocs.length })}</span>
        </div>
        <div className="memory-doc-import-row">
          <button
            type="button"
            className="memory-doc-import-btn"
            onClick={() => { void openReferenceDocPicker(); }}
            disabled={importingDoc}
          >
            <Icon name="fileText" size={14} />
            <span>{importingDoc ? t('memory.docs.uploading') : t('memory.docs.upload')}</span>
          </button>
          <span className="memory-doc-import-hint">{t('memory.docs.importHint')}</span>
          <input
            ref={fileInputRef}
            className="memory-doc-import-input"
            type="file"
            multiple
            accept={referenceDocAccept}
            onChange={(event) => {
              void importReferenceDocs(event.currentTarget.files);
            }}
          />
        </div>
        {importError ? (
          <div className="memory-doc-import-error">{importError}</div>
        ) : null}
        <div className="ps-mc-add">
          <input
            className="ps-mc-add-input"
            value={docTitleDraft}
            onChange={(e) => setDocTitleDraft(e.target.value)}
            placeholder={t('memory.docs.addTitlePlaceholder')}
            onKeyDown={(e) => { if (e.key === 'Enter') addReferenceDoc(); }}
          />
          {docTitleDraft.trim() && (
            <button
              type="button"
              className="ps-mc-add-btn"
              onClick={addReferenceDoc}
              aria-label={t('memory.docs.addAria')}
            >+</button>
          )}
        </div>
        <div className="memory-library-list">
          {visibleReferenceDocs.length === 0 && (
            <div className="memory-empty-card">
              {t('memory.docs.emptyState')}
            </div>
          )}
          {visibleReferenceDocs.map((doc) => {
            const editing = editingDocId === doc.id;
            return (
              <MemoryReferenceDocCard
                key={doc.id}
                doc={doc}
                editing={editing}
                confirmingDelete={confirmingDeleteDocId === doc.id}
                i18n={i18n}
                onOpen={() => {
                  void openReferenceDoc(doc, editing);
                }}
                onUpdate={(patch) => updateReferenceDoc(doc.id, patch)}
                onCloseEditor={() => {
                  setEditingDocId(null);
                  setConfirmingDeleteDocId(null);
                }}
                onToggleEditorDelete={() => {
                  setConfirmingDeleteDocId((current) => current === doc.id ? null : doc.id);
                }}
                onRemove={() => removeReferenceDoc(doc.id)}
              />
            );
          })}
        </div>
      </div>
      ) : null}
    </div>
  );
}
