import type { Database, SqlJsStatic, SqlValue } from 'sql.js';
import sqlWasmUrl from 'sql.js/dist/sql-wasm.wasm?url';

const SQLITE_HEADER = new TextEncoder().encode('SQLite format 3\0');

type SQLiteRow = Record<string, SqlValue>;
type KelivoMessagePart = { kind: string; payload: string };

export type KelivoSQLiteIssue = {
  code: string;
  objectType: string;
};

export type KelivoSQLiteSnapshot = {
  settings: Record<string, unknown>;
  conversations: Array<Record<string, unknown>>;
  messages: Array<Record<string, unknown>>;
  issues: KelivoSQLiteIssue[];
};

let sqlJsPromise: Promise<SqlJsStatic> | null = null;

function sqlJsWasmLocation() {
  if (typeof process !== 'undefined' && process.versions?.node) {
    return `${process.cwd()}/node_modules/sql.js/dist/sql-wasm.wasm`;
  }
  return sqlWasmUrl;
}

async function loadSqlJs() {
  sqlJsPromise ??= import('sql.js').then(({ default: initSqlJs }) => initSqlJs({
    locateFile: () => sqlJsWasmLocation()
  }));
  return await sqlJsPromise;
}

function firstValue(row: SQLiteRow | undefined) {
  return row ? Object.values(row)[0] : undefined;
}

function queryRows(db: Database, sql: string, params: SqlValue[] = []): SQLiteRow[] {
  const result = db.exec(sql, params)[0];
  if (!result) return [];
  return result.values.map((values) => Object.fromEntries(
    result.columns.map((column, index) => [column, values[index]])
  ));
}

function quoteIdentifier(value: string) {
  if (!/^[a-z][a-z0-9_]*$/i.test(value)) {
    throw new Error('Kelivo SQLite 标识符不合法。');
  }
  return `"${value}"`;
}

function tableExists(db: Database, table: string) {
  return queryRows(
    db,
    "SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1",
    [table]
  ).length > 0;
}

function tableColumns(db: Database, table: string) {
  if (!tableExists(db, table)) return new Set<string>();
  return new Set(queryRows(db, `PRAGMA table_info(${quoteIdentifier(table)})`)
    .map((row) => readString(row.name))
    .filter(Boolean));
}

function tableRows(db: Database, table: string) {
  if (!tableExists(db, table)) return [];
  return queryRows(db, `SELECT * FROM ${quoteIdentifier(table)}`);
}

function readString(value: unknown) {
  return typeof value === 'string' ? value : '';
}

function readNumber(value: unknown, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function milliseconds(value: unknown) {
  const numeric = readNumber(value);
  return numeric > 100_000_000_000_000 ? Math.floor(numeric / 1000) : numeric;
}

function parseJson(value: unknown): unknown {
  const text = readString(value);
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function parseJsonObject(value: unknown) {
  const parsed = parseJson(value);
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : null;
}

function issue(code: string, objectType: string): KelivoSQLiteIssue {
  return { code, objectType };
}

function readPayloadObjects(db: Database, table: string, idColumn: string) {
  const columns = tableColumns(db, table);
  if (!columns.has(idColumn) || !columns.has('payload')) return [];
  return tableRows(db, table)
    .sort((left, right) => {
      const order = readNumber(left.sort_order) - readNumber(right.sort_order);
      return order || readString(left[idColumn]).localeCompare(readString(right[idColumn]));
    })
    .flatMap((row) => {
      const object = parseJsonObject(row.payload);
      if (!object) return [];
      if (typeof object.id !== 'string' || !object.id) object.id = readString(row[idColumn]);
      return [object];
    });
}

function readAssistantMemories(db: Database) {
  const columns = tableColumns(db, 'assistant_memory_rows');
  if (!columns.has('id') || !columns.has('assistant_id') || !columns.has('payload')) return [];
  return tableRows(db, 'assistant_memory_rows')
    .sort((left, right) => readNumber(left.sort_order) - readNumber(right.sort_order))
    .flatMap((row) => {
      const object = parseJsonObject(row.payload);
      if (!object) return [];
      if (typeof object.id !== 'string' || !object.id) object.id = readString(row.id);
      if (typeof object.assistantId !== 'string' || !object.assistantId) {
        object.assistantId = readString(row.assistant_id);
      }
      return [object];
    });
}

function readMemoryEntries(db: Database, issues: KelivoSQLiteIssue[]) {
  const columns = tableColumns(db, 'memory_entry_rows');
  if (!columns.has('id') || !columns.has('content')) return [];
  return tableRows(db, 'memory_entry_rows')
    .filter((row) => !columns.has('status') || row.status === 'active')
    .sort((left, right) => readNumber(left.sort_order) - readNumber(right.sort_order))
    .flatMap((row) => {
      const assistantId = readString(row.assistant_id);
      if (!assistantId) {
        issues.push(issue('kelivo_global_memory_not_imported', 'memory'));
        return [];
      }
      return [{
        id: readString(row.id),
        assistantId,
        content: readString(row.content),
        createdAt: milliseconds(row.entry_created_at),
        updatedAt: milliseconds(row.entry_updated_at)
      }];
    });
}

function readBusinessSettings(db: Database, issues: KelivoSQLiteIssue[]) {
  const settings: Record<string, unknown> = {};
  const assistants = readPayloadObjects(db, 'assistant_rows', 'id');
  const memories = [...readAssistantMemories(db), ...readMemoryEntries(db, issues)];
  const worldBooks = readPayloadObjects(db, 'world_book_rows', 'id');
  const providers = readPayloadObjects(db, 'provider_rows', 'provider_key');
  const mcpServers = readPayloadObjects(db, 'mcp_server_rows', 'id');
  const instructionInjections = readPayloadObjects(db, 'instruction_injection_rows', 'id');

  if (assistants.length) settings.assistants_v1 = assistants;
  if (memories.length) settings.assistant_memories_v1 = memories;
  if (worldBooks.length) {
    settings.world_books_v1 = worldBooks;
    const allWorldBookIds = worldBooks.map((book) => readString(book.id)).filter(Boolean);
    settings.world_books_active_ids_by_assistant_v1 = Object.fromEntries(
      assistants.map((assistant) => {
        const configuredIds = Array.isArray(assistant.worldBookIds)
          ? assistant.worldBookIds.map((value) => readString(value)).filter(Boolean)
          : [];
        return [readString(assistant.id), configuredIds.length ? configuredIds : allWorldBookIds];
      }).filter(([assistantId]) => Boolean(assistantId))
    );
  }
  if (providers.length) {
    settings.provider_configs_v1 = Object.fromEntries(providers.map((provider, index) => [
      readString(provider.id) || `kelivo-provider-${index + 1}`,
      provider
    ]));
    settings.providers_order_v1 = providers.map((provider) => readString(provider.id)).filter(Boolean);
  }
  if (mcpServers.length) settings.mcp_servers_v1 = mcpServers;
  if (instructionInjections.length) settings.instruction_injections_v1 = instructionInjections;

  const avatar = tableRows(db, 'preference_rows')
    .find((row) => row.key === 'avatar_value');
  if (avatar) settings.avatar_value = parseJson(avatar.value) ?? readString(avatar.value);
  return settings;
}

function readMessageParts(db: Database) {
  const columns = tableColumns(db, 'message_part_rows');
  if (!columns.has('revision_id') || !columns.has('kind') || !columns.has('payload')) {
    return new Map<string, KelivoMessagePart[]>();
  }
  const grouped = new Map<string, KelivoMessagePart[]>();
  for (const row of tableRows(db, 'message_part_rows').sort((left, right) => {
    const revision = readString(left.revision_id).localeCompare(readString(right.revision_id));
    return revision || readNumber(left.ordinal) - readNumber(right.ordinal);
  })) {
    const revisionId = readString(row.revision_id);
    if (!revisionId) continue;
    grouped.set(revisionId, [...(grouped.get(revisionId) ?? []), {
      kind: readString(row.kind),
      payload: readString(row.payload)
    }]);
  }
  return grouped;
}

function readablePartPayload(payload: string) {
  const decoded = parseJsonObject(payload);
  if (!decoded) return payload;
  return readString(decoded.text) || readString(decoded.content) || payload;
}

function readMessageAssetPaths(db: Database) {
  const messageAssetColumns = tableColumns(db, 'message_asset_rows');
  const assetColumns = tableColumns(db, 'asset_rows');
  if (!messageAssetColumns.has('revision_id') || !messageAssetColumns.has('asset_id')
      || !assetColumns.has('id') || !assetColumns.has('path')) {
    return new Map<string, string[]>();
  }
  const assetsById = new Map(tableRows(db, 'asset_rows')
    .map((row) => [readString(row.id), readString(row.path)] as const)
    .filter(([id, path]) => Boolean(id && path)));
  const paths = new Map<string, string[]>();
  for (const row of tableRows(db, 'message_asset_rows')) {
    const revisionId = readString(row.revision_id);
    const path = assetsById.get(readString(row.asset_id));
    if (!revisionId || !path) continue;
    paths.set(revisionId, [...(paths.get(revisionId) ?? []), path]);
  }
  return paths;
}

function readConversations(db: Database) {
  const columns = tableColumns(db, 'conversation_rows');
  if (!columns.has('id') || !columns.has('title')) {
    throw new Error('Kelivo SQLite 备份缺少有效的 conversation_rows。');
  }
  return tableRows(db, 'conversation_rows')
    .sort((left, right) => milliseconds(left.updated_at) - milliseconds(right.updated_at)
      || readString(left.id).localeCompare(readString(right.id)))
    .map((row) => ({
      id: readString(row.id),
      title: readString(row.title),
      createdAt: milliseconds(row.created_at),
      updatedAt: milliseconds(row.updated_at),
      assistantId: readString(row.assistant_id) || null,
      versionSelections: parseJsonObject(row.version_selections_json) ?? {}
    }));
}

function selectedMessageRows(db: Database, conversations: ReturnType<typeof readConversations>) {
  const columns = tableColumns(db, 'message_rows');
  if (!columns.has('id') || !columns.has('conversation_id') || !columns.has('role')) {
    throw new Error('Kelivo SQLite 备份缺少有效的 message_rows。');
  }
  const selectionsByConversation = new Map(conversations.map((conversation) => [
    conversation.id,
    conversation.versionSelections
  ]));
  const grouped = new Map<string, SQLiteRow[]>();
  for (const row of tableRows(db, 'message_rows')) {
    const id = readString(row.id);
    const conversationId = readString(row.conversation_id);
    if (!id || !conversationId) continue;
    const groupId = readString(row.group_id) || id;
    const key = `${conversationId}\u001f${groupId}`;
    grouped.set(key, [...(grouped.get(key) ?? []), row]);
  }

  const selected: Array<SQLiteRow & { anchorOrder: number }> = [];
  for (const rows of grouped.values()) {
    const first = rows[0];
    const conversationId = readString(first.conversation_id);
    const groupId = readString(first.group_id) || readString(first.id);
    const requestedVersion = selectionsByConversation.get(conversationId)?.[groupId];
    const sorted = [...rows].sort((left, right) =>
      readNumber(right.version) - readNumber(left.version)
      || readNumber(right.message_order) - readNumber(left.message_order)
      || readString(right.id).localeCompare(readString(left.id)));
    const chosen = typeof requestedVersion === 'number'
      ? sorted.find((row) => readNumber(row.version) === requestedVersion) ?? sorted[0]
      : sorted[0];
    selected.push({
      ...chosen,
      anchorOrder: Math.min(...rows.map((row) => readNumber(row.message_order, milliseconds(row.timestamp))))
    });
  }
  return selected.sort((left, right) =>
    readString(left.conversation_id).localeCompare(readString(right.conversation_id))
    || left.anchorOrder - right.anchorOrder
    || readString(left.id).localeCompare(readString(right.id)));
}

function readMessages(db: Database, conversations: ReturnType<typeof readConversations>) {
  const parts = readMessageParts(db);
  const assetPaths = readMessageAssetPaths(db);
  return selectedMessageRows(db, conversations).map((row) => {
    const id = readString(row.id);
    const ownParts = parts.get(id) ?? [];
    const text = ownParts.filter((part) => part.kind === 'text').map((part) => readablePartPayload(part.payload)).join('');
    const reasoning = ownParts.filter((part) => part.kind === 'reasoning').map((part) => readablePartPayload(part.payload)).join('\n');
    return {
      id,
      conversationId: readString(row.conversation_id),
      role: readString(row.role),
      content: text || readString(row.content),
      timestamp: milliseconds(row.timestamp),
      reasoningText: reasoning || readString(row.reasoning_text),
      reasoningSegmentsJson: readString(row.reasoning_segments_json),
      messageOrder: row.anchorOrder,
      assetPaths: assetPaths.get(id) ?? []
    };
  });
}

export function isKelivoSQLiteBytes(bytes: Uint8Array) {
  return bytes.length >= SQLITE_HEADER.length
    && SQLITE_HEADER.every((value, index) => bytes[index] === value);
}

export async function readKelivoSQLiteSnapshot(bytes: Uint8Array): Promise<KelivoSQLiteSnapshot> {
  if (!isKelivoSQLiteBytes(bytes)) {
    throw new Error('选择的文件不是 SQLite 数据库。');
  }
  const SQL = await loadSqlJs();
  const db = new SQL.Database(bytes);
  try {
    const quickCheck = firstValue(queryRows(db, 'PRAGMA quick_check')[0]);
    if (quickCheck !== 'ok' || !tableExists(db, 'conversation_rows') || !tableExists(db, 'message_rows')) {
      throw new Error('Kelivo SQLite 备份不完整或已损坏。');
    }
    const issues: KelivoSQLiteIssue[] = [];
    const conversations = readConversations(db);
    const messages = readMessages(db, conversations);
    const messagesByConversation = new Map<string, string[]>();
    for (const message of messages) {
      const conversationId = readString(message.conversationId);
      messagesByConversation.set(conversationId, [...(messagesByConversation.get(conversationId) ?? []), readString(message.id)]);
    }
    const rawMessageCount = readNumber(firstValue(queryRows(db, 'SELECT COUNT(*) AS count FROM message_rows')[0]));
    if (rawMessageCount > messages.length) issues.push(issue('kelivo_message_revision_normalized', 'message_revision'));
    const legacyToolEvents = tableExists(db, 'tool_event_rows')
      && readNumber(firstValue(queryRows(db, 'SELECT COUNT(*) AS count FROM tool_event_rows')[0])) > 0;
    const partToolEvents = tableExists(db, 'message_part_rows')
      && queryRows(db, "SELECT 1 AS present FROM message_part_rows WHERE kind = 'tool_call' LIMIT 1").length > 0;
    if (legacyToolEvents || partToolEvents) issues.push(issue('kelivo_tool_trace_not_imported', 'tool_event'));
    return {
      settings: readBusinessSettings(db, issues),
      conversations: conversations.map(({ versionSelections: _versionSelections, ...conversation }) => ({
        ...conversation,
        messageIds: messagesByConversation.get(conversation.id) ?? []
      })),
      messages,
      issues
    };
  } finally {
    db.close();
  }
}
