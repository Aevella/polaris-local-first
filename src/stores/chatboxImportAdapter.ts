import JSZip from 'jszip';
import { createPersonaTemplate } from '../config/persona/personaBuilder';
import type { ChatMessage, Conversation } from '../types/domain';
import type { PersistedCollectionState } from './collectionStorePersistence';
import { normalizeRuntimePayload } from './runtimeStorePersistence';
import type { StructuredExportSnapshot } from './storeExportPackage';

type ChatboxRecord = Record<string, unknown>;

type ChatboxSessionSource = {
  record: ChatboxRecord;
  source: 'chat-sessions' | 'chat-sessions-list' | 'session-key';
};

type ChatboxMessageContentResult = {
  content: string;
  unsupportedParts: number;
};

export type ChatboxImportConversionStats = {
  sessions: number;
  conversations: number;
  messages: number;
  skippedSessions: number;
  skippedMessages: number;
  threadConversations: number;
  unsupportedParts: number;
};

export type ChatboxStructuredExportConversion = {
  snapshot: StructuredExportSnapshot;
  stats: ChatboxImportConversionStats;
};

const CHATBOX_PERSONA_ID = 'chatbox-imported-assistant';

function isRecord(value: unknown): value is ChatboxRecord {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function parseJson<T>(content: string, label: string): T {
  try {
    return JSON.parse(content) as T;
  } catch {
    throw new Error(`${label} 不是有效 JSON`);
  }
}

function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed || (!trimmed.startsWith('{') && !trimmed.startsWith('['))) return value;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
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

function buildStableId(prefix: string, raw: string) {
  const label = sanitizeIdFragment(raw);
  return `${prefix}-${label}-${stableHash(raw)}`;
}

function textExcerpt(value: string, maxLength = 80) {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1)}…`;
}

function safeJson(value: unknown) {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function normalizeTopLevelPayload(payload: unknown) {
  if (!isRecord(payload)) {
    throw new Error('Chatbox 导出数据必须是 JSON 对象');
  }
  const normalized: ChatboxRecord = {};
  for (const [key, value] of Object.entries(payload)) {
    normalized[key] = parseMaybeJson(value);
  }
  return normalized;
}

function isLikelyChatboxPayload(payload: unknown) {
  if (!isRecord(payload)) return false;
  if (Array.isArray(payload['chat-sessions']) || Array.isArray(payload['chat-sessions-list'])) return true;
  if (Array.isArray(payload.__exported_items) || typeof payload.__exported_at === 'string') return true;
  return Object.keys(payload).some((key) => key.startsWith('session:'));
}

function asRecordArray(value: unknown): ChatboxRecord[] {
  return Array.isArray(value) ? value.map(parseMaybeJson).filter(isRecord) : [];
}

function readSessionId(record: ChatboxRecord) {
  const id = readString(record.id);
  return id || null;
}

function collectChatboxSessions(payload: ChatboxRecord): ChatboxSessionSource[] {
  const byId = new Map<string, ChatboxSessionSource>();
  const anonymous: ChatboxSessionSource[] = [];

  const addSession = (record: ChatboxRecord, source: ChatboxSessionSource['source'], idHint?: string) => {
    const sessionId = readSessionId(record) ?? idHint ?? '';
    const sessionSource = { record, source };
    if (!sessionId) {
      anonymous.push(sessionSource);
      return;
    }

    const existing = byId.get(sessionId);
    if (!existing) {
      byId.set(sessionId, sessionSource);
      return;
    }

    const existingMessages = asRecordArray(existing.record.messages);
    const nextMessages = asRecordArray(record.messages);
    if (nextMessages.length > existingMessages.length) {
      byId.set(sessionId, sessionSource);
    }
  };

  for (const session of asRecordArray(payload['chat-sessions'])) {
    addSession(session, 'chat-sessions');
  }

  for (const meta of asRecordArray(payload['chat-sessions-list'])) {
    const sessionId = readSessionId(meta);
    const detail = sessionId ? parseMaybeJson(payload[`session:${sessionId}`]) : null;
    addSession(
      isRecord(detail) ? { ...meta, ...detail } : meta,
      'chat-sessions-list',
      sessionId ?? undefined
    );
  }

  for (const [key, value] of Object.entries(payload)) {
    if (!key.startsWith('session:')) continue;
    const record = parseMaybeJson(value);
    if (!isRecord(record)) continue;
    addSession(record, 'session-key', key.slice('session:'.length));
  }

  return [...byId.values(), ...anonymous];
}

function readChatboxMessageRole(value: unknown): ChatMessage['role'] {
  if (value === 'user' || value === 'assistant' || value === 'system') return value;
  return 'system';
}

function readChatboxContentParts(message: ChatboxRecord) {
  return asRecordArray(message.contentParts);
}

function appendLine(lines: string[], value: string) {
  const text = value.trim();
  if (text) lines.push(text);
}

function convertContentParts(parts: ChatboxRecord[]): ChatboxMessageContentResult {
  const lines: string[] = [];
  let unsupportedParts = 0;

  for (const part of parts) {
    const type = readString(part.type);
    if (type === 'text') {
      appendLine(lines, readString(part.text));
      continue;
    }

    if (type === 'info') {
      appendLine(lines, readString(part.text) || safeJson(part.values));
      continue;
    }

    if (type === 'image') {
      const storageKey = readString(part.storageKey);
      appendLine(lines, storageKey ? `[Chatbox image: ${storageKey}]` : '[Chatbox image]');
      unsupportedParts += 1;
      continue;
    }

    if (type === 'tool-call') {
      const toolName = readString(part.toolName) || 'tool';
      const state = readString(part.state);
      const detail = safeJson({
        args: part.args,
        result: part.result
      });
      appendLine(lines, `[Chatbox tool ${toolName}${state ? ` ${state}` : ''}]${detail ? `\n${detail}` : ''}`);
      unsupportedParts += 1;
      continue;
    }

    if (type === 'reasoning') {
      unsupportedParts += 1;
      continue;
    }

    const fallback = safeJson(part);
    if (fallback) {
      appendLine(lines, `[Chatbox ${type || 'part'}]\n${fallback}`);
      unsupportedParts += 1;
    }
  }

  return {
    content: lines.join('\n\n').trim(),
    unsupportedParts
  };
}

function appendLegacyAttachments(lines: string[], message: ChatboxRecord) {
  for (const picture of asRecordArray(message.pictures)) {
    const storageKey = readString(picture.storageKey) || readString(picture.url) || readString(picture.path);
    appendLine(lines, storageKey ? `[Chatbox image: ${storageKey}]` : '[Chatbox image]');
  }

  for (const file of asRecordArray(message.files)) {
    const name = readString(file.name) || readString(file.filename) || readString(file.path);
    appendLine(lines, name ? `[Chatbox file: ${name}]` : '[Chatbox file]');
  }

  for (const link of asRecordArray(message.links)) {
    const title = readString(link.title);
    const url = readString(link.url);
    appendLine(lines, [title, url].filter(Boolean).join(' '));
  }
}

function convertMessageContent(message: ChatboxRecord): ChatboxMessageContentResult {
  const parts = readChatboxContentParts(message);
  const converted = parts.length > 0
    ? convertContentParts(parts)
    : { content: readString(message.content), unsupportedParts: 0 };

  const lines = [converted.content].filter(Boolean);
  appendLegacyAttachments(lines, message);

  return {
    content: lines.join('\n\n').trim(),
    unsupportedParts: converted.unsupportedParts
  };
}

function convertMessages(
  sessionId: string,
  messages: ChatboxRecord[],
  stats: ChatboxImportConversionStats,
  fallbackTimestamp: number
): ChatMessage[] {
  return messages.flatMap((message, index) => {
    const converted = convertMessageContent(message);
    stats.unsupportedParts += converted.unsupportedParts;
    if (!converted.content) {
      stats.skippedMessages += 1;
      return [];
    }

    const rawMessageId = readString(message.id) || `${index}`;
    const role = readChatboxMessageRole(message.role);
    const timestamp = parseTimestamp(message.timestamp ?? message.createdAt ?? message.updatedAt, fallbackTimestamp + index);
    stats.messages += 1;

    return [{
      id: buildStableId('chatbox-message', `${sessionId}:${rawMessageId}:${index}`),
      role,
      content: message.role === 'tool'
        ? `[Chatbox tool message]\n${converted.content}`
        : converted.content,
      timestamp,
      origin: role === 'user' ? 'user-input' : role === 'assistant' ? 'assistant-reply' : 'system-note',
      model: readString(message.model) || undefined
    } satisfies ChatMessage];
  });
}

function readSessionTitle(session: ChatboxRecord, messages: ChatMessage[], fallback: string) {
  const explicit = readString(session.name) || readString(session.title);
  if (explicit) return explicit;
  const firstUserMessage = messages.find((message) => message.role === 'user' && message.content.trim());
  if (firstUserMessage) return textExcerpt(firstUserMessage.content);
  return fallback;
}

function buildConversation(
  session: ChatboxRecord,
  messages: ChatMessage[],
  fallbackTitle: string,
  idSeed: string
): Conversation {
  const updatedAt = messages.reduce(
    (max, message) => Math.max(max, message.timestamp),
    parseTimestamp(session.updatedAt ?? session.createdAt, Date.now())
  );
  const starredAt = session.starred ? parseTimestamp(session.starredAt, updatedAt) : null;

  return {
    id: buildStableId('chatbox-conversation', idSeed),
    title: readSessionTitle(session, messages, fallbackTitle),
    collaboratorId: CHATBOX_PERSONA_ID,
    messages,
    draft: '',
    pinnedAt: starredAt,
    updatedAt
  };
}

function collectThreadConversations(
  session: ChatboxRecord,
  sessionId: string,
  sessionTitle: string,
  stats: ChatboxImportConversionStats
) {
  const conversations: Conversation[] = [];
  const threads = asRecordArray(session.threads);

  threads.forEach((thread, index) => {
    const messages = convertMessages(
      `${sessionId}:thread:${index}`,
      asRecordArray(thread.messages),
      stats,
      parseTimestamp(thread.createdAt ?? session.createdAt, Date.now())
    );
    if (messages.length === 0) return;

    const threadName = readString(thread.name) || readString(thread.threadName) || `分支 ${index + 1}`;
    conversations.push(buildConversation(
      {
        ...thread,
        name: `${sessionTitle} / ${threadName}`,
        starred: session.starred
      },
      messages,
      `${sessionTitle} / ${threadName}`,
      `${sessionId}:thread:${readString(thread.id) || index}`
    ));
    stats.threadConversations += 1;
  });

  return conversations;
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

function buildChatboxPersona() {
  return createPersonaTemplate({
    id: CHATBOX_PERSONA_ID,
    name: 'Chatbox 导入',
    description: '从 Chatbox 备份转换来的历史协作者。',
    purpose: '承载 Chatbox 导入的历史对话。',
    generatedPromptMode: 'off',
    baseId: 'custom',
    relationship: 'assistant',
    expression: 'natural',
    compiledPrompt: ''
  });
}

export function convertChatboxExportToStructuredExportSnapshot(
  payload: unknown
): ChatboxStructuredExportConversion {
  const normalizedPayload = normalizeTopLevelPayload(payload);
  if (!isLikelyChatboxPayload(normalizedPayload)) {
    throw new Error('没有识别到 Chatbox 会话数据');
  }

  const stats: ChatboxImportConversionStats = {
    sessions: 0,
    conversations: 0,
    messages: 0,
    skippedSessions: 0,
    skippedMessages: 0,
    threadConversations: 0,
    unsupportedParts: 0
  };
  const conversations: Conversation[] = [];

  for (const { record } of collectChatboxSessions(normalizedPayload)) {
    if (readString(record.type) === 'picture') {
      stats.skippedSessions += 1;
      continue;
    }

    const rawSessionId = readSessionId(record) ?? `anonymous-${stats.sessions + stats.skippedSessions + 1}`;
    const messages = convertMessages(
      rawSessionId,
      asRecordArray(record.messages),
      stats,
      parseTimestamp(record.createdAt ?? record.updatedAt, Date.now())
    );
    if (messages.length === 0) {
      stats.skippedSessions += 1;
      continue;
    }

    const sessionTitle = readSessionTitle(record, messages, `Chatbox 会话 ${stats.sessions + 1}`);
    conversations.push(buildConversation(
      { ...record, name: sessionTitle },
      messages,
      sessionTitle,
      rawSessionId
    ));
    conversations.push(...collectThreadConversations(record, rawSessionId, sessionTitle, stats));
    stats.sessions += 1;
  }

  conversations.sort((left, right) => right.updatedAt - left.updatedAt);
  stats.conversations = conversations.length;

  const persona = buildChatboxPersona();
  return {
    snapshot: {
      spaceState: {},
      chatState: {
        conversations,
        activeConversationId: conversations[0]?.id ?? null
      },
      collectionState: buildCollectionState(),
      personaState: {
        personas: [persona],
        activeCollaboratorId: persona.id,
        seededDefaultPersonaIds: []
      },
      personaMemoryDocContent: { version: 1, docs: {} },
      runtimeState: normalizeRuntimePayload({ providers: [] }),
      assetEntries: []
    },
    stats
  };
}

export async function parseChatboxExportPayloadFromBlob(file: Blob): Promise<ChatboxRecord> {
  const bytes = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;

  if (!isZip) {
    return normalizeTopLevelPayload(parseJson(await file.text(), 'Chatbox 导出文件'));
  }

  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const candidates = Object.values(zip.files)
    .filter((entry) => !entry.dir && entry.name.toLowerCase().endsWith('.json'))
    .sort((left, right) => {
      const leftPreferred = /chatbox-exported-data/i.test(left.name) ? 0 : 1;
      const rightPreferred = /chatbox-exported-data/i.test(right.name) ? 0 : 1;
      return leftPreferred - rightPreferred || left.name.localeCompare(right.name);
    });

  let firstInvalidCandidateError: Error | null = null;
  for (const candidate of candidates) {
    const contents = await candidate.async('string');
    let normalized: ChatboxRecord;
    try {
      normalized = normalizeTopLevelPayload(parseJson(contents, candidate.name));
    } catch (error) {
      firstInvalidCandidateError ??= error instanceof Error ? error : new Error(String(error));
      continue;
    }

    if (isLikelyChatboxPayload(normalized)) return normalized;
  }

  if (firstInvalidCandidateError) throw firstInvalidCandidateError;
  throw new Error('压缩包里没有找到 Chatbox 导出的会话 JSON');
}

export async function convertChatboxExportBlobToStructuredExportSnapshot(
  file: Blob
): Promise<ChatboxStructuredExportConversion> {
  const payload = await parseChatboxExportPayloadFromBlob(file);
  return convertChatboxExportToStructuredExportSnapshot(payload);
}
