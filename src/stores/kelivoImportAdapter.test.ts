import { beforeEach, describe, expect, it, vi } from 'vitest';
import JSZip from 'jszip';
import initSqlJs from 'sql.js';
import type { ChatMessage } from '../types/domain';
import {
  convertKelivoBackupToStructuredExportSnapshot,
  convertKelivoBackupZip,
  isKelivoBackupZip,
  importKelivoBackupPackage,
  importKelivoBackupPackageIfMatched
} from './kelivoImportAdapter';
import type { RuntimePayload } from './runtimeStorePersistence';

const imports = vi.hoisted(() => ({
  importStructuredExportSnapshot: vi.fn(async (_snapshot: unknown, _options?: unknown) => ({})),
  importPersistedDataDirectly: vi.fn()
}));
vi.mock('./storeImportPackage', () => imports);

async function createKelivoBackupBlob(options: {
  settingsPatch?: Record<string, unknown>;
  chatsPatch?: Record<string, unknown>;
} = {}) {
  const zip = new JSZip();
  const settings = {
    provider_configs_v1: JSON.stringify({
      OpenAI: {
        id: 'OpenAI',
        name: 'OpenAI',
        enabled: true,
        providerType: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        chatPath: '/chat/completions',
        apiKey: 'sk-test',
        models: ['gpt-4.1']
      },
      Claude: {
        id: 'Claude',
        name: 'Claude',
        enabled: true,
        providerType: 'anthropic',
        baseUrl: 'https://api.anthropic.com/v1',
        chatPath: '/messages',
        apiKey: 'claude-test',
        models: ['claude-sonnet-4']
      }
    }),
    providers_order_v1: JSON.stringify(['Claude', 'OpenAI']),
    selected_model_v1: 'OpenAI::gpt-4.1-mini',
    assistants_v1: JSON.stringify([{
      id: 'assistant-1',
      name: 'Nova',
      avatar: 'avatars/nova.png',
      background: 'images/room.webp',
      useAssistantAvatar: true,
      chatModelProvider: 'OpenAI',
      chatModelId: 'gpt-4.1-mini',
      systemPrompt: 'Stay close.',
      temperature: 0.8,
      streamOutput: true,
      enableRecentChatsReference: true,
      presetMessages: [{ role: 'system', content: 'preset' }]
    }]),
    current_assistant_id_v1: 'assistant-1',
    user_name: '用户',
    avatar_value: 'avatars/user.png',
    assistant_memories_v1: JSON.stringify([{
      id: 'memory-1',
      assistantId: 'assistant-1',
      content: 'likes Polaris'
    }]),
    world_books_v1: JSON.stringify([{
      id: 'book-1',
      name: '白树世界',
      enabled: true,
      entries: [{
        id: 'entry-1',
        enabled: true,
        keywords: ['白树'],
        content: '带入白树世界设定。',
        scanDepth: 4,
        priority: 9,
        useRegex: false,
        caseSensitive: false
      }, {
        id: 'entry-2',
        enabled: true,
        content: '常驻世界规则。',
        constantActive: true
      }]
    }]),
    world_books_active_ids_by_assistant_v1: JSON.stringify({
      'assistant-1': ['book-1']
    }),
    mcp_servers_v1: JSON.stringify([{
      id: 'mcp-http',
      name: 'HTTP MCP',
      transport: 'http',
      url: 'https://mcp.example.com/mcp',
      enabled: true,
      headers: { Authorization: 'Bearer token' }
    }, {
      id: 'mcp-stdio',
      name: 'Local MCP',
      transport: 'stdio',
      command: 'node'
    }]),
    mcp_request_timeout_ms_v1: 45000
  };
  zip.file('settings.json', JSON.stringify({
    ...settings,
    ...(options.settingsPatch ?? {})
  }));
  const chats = {
    version: 1,
    conversations: [{
      id: 'conversation-1',
      title: 'old room',
      assistantId: 'assistant-1',
      createdAt: '2026-05-31T12:00:00.000Z',
      updatedAt: '2026-05-31T12:01:00.000Z',
      messageIds: ['message-1', 'message-2'],
      isPinned: true
    }],
    messages: [{
      id: 'message-1',
      conversationId: 'conversation-1',
      role: 'user',
      content: 'see upload/sketch.png',
      timestamp: '2026-05-31T12:00:00.000Z'
    }, {
      id: 'message-2',
      conversationId: 'conversation-1',
      role: 'assistant',
      content: 'saw it',
      timestamp: '2026-05-31T12:01:00.000Z',
      modelId: 'gpt-4.1-mini',
      providerId: 'OpenAI',
      totalTokens: 9,
      reasoningText: 'short thought'
    }]
  };
  zip.file('chats.json', JSON.stringify({
    ...chats,
    ...(options.chatsPatch ?? {})
  }));
  zip.file('avatars/nova.png', new Uint8Array([1, 2, 3]));
  zip.file('avatars/user.png', new Uint8Array([4, 5, 6]));
  zip.file('images/room.webp', new Uint8Array([7, 8, 9]));
  zip.file('upload/sketch.png', new Uint8Array([10, 11, 12]));
  const buffer = await zip.generateAsync({ type: 'arraybuffer' });
  return new Blob([buffer], { type: 'application/zip' });
}

async function createCurrentKelivoDatabase() {
  const SQL = await initSqlJs({
    locateFile: () => `${process.cwd()}/node_modules/sql.js/dist/sql-wasm.wasm`
  });
  const db = new SQL.Database();
  db.run(`
    CREATE TABLE conversation_rows (id TEXT PRIMARY KEY, title TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, assistant_id TEXT, version_selections_json TEXT NOT NULL);
    CREATE TABLE message_rows (id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, role TEXT NOT NULL, timestamp INTEGER NOT NULL, reasoning_segments_json TEXT, message_order INTEGER NOT NULL, group_id TEXT, version INTEGER NOT NULL);
    CREATE TABLE message_part_rows (part_id INTEGER PRIMARY KEY AUTOINCREMENT, conversation_id TEXT NOT NULL, revision_id TEXT NOT NULL, ordinal INTEGER NOT NULL, kind TEXT NOT NULL, payload TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
    CREATE TABLE asset_rows (id TEXT PRIMARY KEY, path TEXT NOT NULL);
    CREATE TABLE message_asset_rows (revision_id TEXT NOT NULL, asset_id TEXT NOT NULL);
    CREATE TABLE assistant_rows (id TEXT PRIMARY KEY, sort_order INTEGER NOT NULL, payload TEXT NOT NULL, updated_at INTEGER NOT NULL);
    CREATE TABLE assistant_memory_rows (id TEXT PRIMARY KEY, sort_order INTEGER NOT NULL, assistant_id TEXT NOT NULL, payload TEXT NOT NULL, updated_at INTEGER NOT NULL);
    CREATE TABLE world_book_rows (id TEXT PRIMARY KEY, sort_order INTEGER NOT NULL, payload TEXT NOT NULL, updated_at INTEGER NOT NULL);
    CREATE TABLE provider_rows (provider_key TEXT PRIMARY KEY, sort_order INTEGER NOT NULL, payload TEXT NOT NULL, updated_at INTEGER NOT NULL);
    CREATE TABLE mcp_server_rows (id TEXT PRIMARY KEY, sort_order INTEGER NOT NULL, payload TEXT NOT NULL, updated_at INTEGER NOT NULL);
  `);
  db.run('INSERT INTO conversation_rows VALUES (?, ?, ?, ?, ?, ?)', [
    'conversation-sqlite', 'Branched chat', 1_718_000_000_000_000, 1_718_000_000_300_000,
    'assistant-sqlite', '{"group-a":0}'
  ]);
  db.run('INSERT INTO message_rows VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [
    'assistant-v0', 'conversation-sqlite', 'assistant', 1_718_000_000_100_000, '', 0, 'group-a', 0
  ]);
  db.run('INSERT INTO message_rows VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [
    'assistant-v1', 'conversation-sqlite', 'assistant', 1_718_000_000_200_000, '', 0, 'group-a', 1
  ]);
  db.run('INSERT INTO message_part_rows VALUES (NULL, ?, ?, ?, ?, ?, ?, ?)', [
    'conversation-sqlite', 'assistant-v0', 0, 'reasoning', 'kept thought', 1, 1
  ]);
  db.run('INSERT INTO message_part_rows VALUES (NULL, ?, ?, ?, ?, ?, ?, ?)', [
    'conversation-sqlite', 'assistant-v0', 1, 'text', 'selected branch', 1, 1
  ]);
  db.run('INSERT INTO message_part_rows VALUES (NULL, ?, ?, ?, ?, ?, ?, ?)', [
    'conversation-sqlite', 'assistant-v1', 0, 'text', 'unselected newer branch', 1, 1
  ]);
  db.run('INSERT INTO asset_rows VALUES (?, ?)', ['asset-branch', 'upload/branch.png']);
  db.run('INSERT INTO message_asset_rows VALUES (?, ?)', ['assistant-v0', 'asset-branch']);
  db.run('INSERT INTO assistant_rows VALUES (?, ?, ?, ?)', [
    'assistant-sqlite', 0, JSON.stringify({
      id: 'assistant-sqlite', name: 'Nova', systemPrompt: 'Stay exact.',
      chatModelProvider: 'sqlite-provider', chatModelId: 'sqlite-chat'
    }), 1
  ]);
  db.run('INSERT INTO assistant_memory_rows VALUES (?, ?, ?, ?, ?)', [
    'memory-sqlite', 0, 'assistant-sqlite', JSON.stringify({
      id: 'memory-sqlite', assistantId: 'assistant-sqlite', content: 'Remember the harbor.'
    }), 1
  ]);
  db.run('INSERT INTO world_book_rows VALUES (?, ?, ?, ?)', [
    'book-sqlite', 0, JSON.stringify({
      id: 'book-sqlite', name: 'SQLite Canon', enabled: true,
      entries: [{ id: 'entry-sqlite', enabled: true, constantActive: true, content: 'The harbor exists.' }]
    }), 1
  ]);
  db.run('INSERT INTO provider_rows VALUES (?, ?, ?, ?)', [
    'sqlite-provider', 0, JSON.stringify({
      id: 'sqlite-provider', name: 'SQLite Relay', providerType: 'openai',
      baseUrl: 'https://sqlite-relay.example.test/v1', apiKey: 'sqlite-provider-secret', models: ['sqlite-chat']
    }), 1
  ]);
  db.run('INSERT INTO mcp_server_rows VALUES (?, ?, ?, ?)', [
    'sqlite-mcp', 0, JSON.stringify({
      id: 'sqlite-mcp', name: 'SQLite MCP', transport: 'http', enabled: true,
      url: 'https://sqlite-mcp.example.test/rpc', headers: { Authorization: 'Bearer sqlite-mcp-secret' }
    }), 1
  ]);
  const bytes = db.export();
  db.close();
  return bytes;
}

async function createCurrentKelivoBackupBlob() {
  const zip = new JSZip();
  zip.file('manifest.json', JSON.stringify({ format: 'kelivo-backup', formatVersion: 2 }));
  zip.file('settings.json', JSON.stringify({
    provider_configs_v1: JSON.stringify({
      'sqlite-provider': {
        id: 'sqlite-provider', name: 'Stale Relay', providerType: 'openai',
        baseUrl: 'https://stale.example.test/v1', apiKey: 'stale-secret', models: ['stale-model']
      }
    })
  }));
  zip.file('database/kelivo.db', await createCurrentKelivoDatabase());
  zip.file('upload/branch.png', new Uint8Array([20, 21, 22]));
  return new Blob([await zip.generateAsync({ type: 'arraybuffer' })], { type: 'application/zip' });
}

describe('convertKelivoBackupZip', () => {
  it('imports current SQLite backups with selected revisions, explicit assets, and credentials', async () => {
    const blob = await createCurrentKelivoBackupBlob();
    await expect(isKelivoBackupZip(blob)).resolves.toBe(true);

    const { snapshot, stats } = await convertKelivoBackupToStructuredExportSnapshot(blob);
    const conversation = snapshot.chatState?.conversations[0];
    expect(stats).toMatchObject({ conversations: 1, messages: 1, personas: 1, providers: 1, mcpServers: 1, assets: 1 });
    expect(conversation?.messages).toHaveLength(1);
    expect(conversation?.messages[0]).toMatchObject({
      id: 'assistant-v0',
      content: 'selected branch',
      thinkingText: 'kept thought',
      attachments: [expect.objectContaining({ name: 'branch.png' })]
    });
    expect(snapshot.personaState?.personas[0]?.memory.personalMemories).toEqual(['Remember the harbor.']);
    expect(JSON.parse(snapshot.personaState?.personas[0]?.advanced.regexTriggers ?? '[]')).toEqual([
      expect.objectContaining({ alwaysOn: true, prompt: 'The harbor exists.' })
    ]);
    expect(snapshot.runtimeState?.providers[0]).toMatchObject({
      id: 'sqlite-provider', apiKey: 'sqlite-provider-secret', model: 'sqlite-chat'
    });
    expect(snapshot.runtimeState?.mcpServers[0]?.headers).toEqual([
      expect.objectContaining({ key: 'Authorization', value: 'Bearer sqlite-mcp-secret' })
    ]);
  });

  it('imports a standalone Kelivo SQLite database without archive assets', async () => {
    const bytes = await createCurrentKelivoDatabase();
    const { snapshot, stats } = await convertKelivoBackupToStructuredExportSnapshot(
      new Blob([new Uint8Array(bytes).buffer], { type: 'application/vnd.sqlite3' })
    );

    expect(stats).toMatchObject({ conversations: 1, messages: 1, assets: 0 });
    expect(snapshot.chatState?.conversations[0]?.messages[0]?.content).toBe('selected branch');
    expect(snapshot.chatState?.conversations[0]?.messages[0]?.attachments).toBeUndefined();
  });

  it('does not claim a generic settings zip as a Kelivo backup', async () => {
    const zip = new JSZip();
    zip.file('settings.json', JSON.stringify({ theme: 'dark' }));
    zip.file('chats.json', JSON.stringify({ conversations: [], messages: [] }));
    const blob = new Blob([await zip.generateAsync({ type: 'arraybuffer' })], { type: 'application/zip' });

    await expect(isKelivoBackupZip(blob)).resolves.toBe(false);
  });

  it('recognizes and converts Kelivo backup stores, assets, providers, and MCP settings', async () => {
    const blob = await createKelivoBackupBlob();
    await expect(isKelivoBackupZip(blob)).resolves.toBe(true);

    const converted = await convertKelivoBackupZip(blob);

    expect(converted.stats).toMatchObject({
      conversations: 1,
      messages: 2,
      personas: 1,
      providers: 2,
      mcpServers: 1,
      skippedMcpServers: 1,
      assets: 4
    });

    const runtime = converted.kvEntries.find((entry) => entry.key === 'runtime-providers-v2')?.value as RuntimePayload;
    expect(runtime.activeProviderId).toBe('OpenAI');
    expect(runtime.providers.map((provider) => provider.id)).toEqual(expect.arrayContaining(['Claude', 'OpenAI']));
    expect(runtime.providers.find((provider) => provider.id === 'OpenAI')).toMatchObject({
      protocol: 'openai-completions',
      path: '/chat/completions',
      apiKey: 'sk-test',
      model: 'gpt-4.1-mini'
    });
    expect(runtime.providers.find((provider) => provider.id === 'Claude')).toMatchObject({
      protocol: 'anthropic-messages',
      path: '/messages',
      apiKey: 'claude-test'
    });
    expect(runtime.mcpToolTimeoutSeconds).toBe(45);
    expect(runtime.mcpServers[0]).toMatchObject({
      id: 'mcp-http',
      transport: 'streamable-http',
      url: 'https://mcp.example.com/mcp',
      isActive: true
    });

    const personaState = converted.kvEntries.find((entry) => entry.key === 'persona-state-v2')?.value as {
      personas: Array<{ name: string; userName: string; compiledPrompt: string; memory: { personalMemories: string[] }; advanced: { regexTriggers?: string } }>;
      activeCollaboratorId: string | null;
    };
    expect(personaState.activeCollaboratorId).toBe('assistant-1');
    expect(personaState.personas[0]).toMatchObject({
      name: 'Nova',
      userName: '用户',
      compiledPrompt: 'Stay close.'
    });
    expect(personaState.personas[0].memory.personalMemories).toEqual(['likes Polaris']);
    expect(JSON.parse(personaState.personas[0].advanced.regexTriggers ?? '[]')).toEqual([
      {
        pattern: '白树',
        prompt: '带入白树世界设定。',
        flags: 'i',
        scanDepth: 4,
        priority: 9
      },
      {
        pattern: '',
        prompt: '常驻世界规则。',
        flags: 'i',
        alwaysOn: true
      }
    ]);

    const messageEntry = converted.kvEntries.find((entry) => entry.key.startsWith('chat-conversation-record-v1:'));
    const messages = (messageEntry?.value as { messages?: ChatMessage[] } | undefined)?.messages ?? [];
    expect(messages[0].attachments?.[0]).toMatchObject({
      kind: 'image',
      name: 'sketch.png'
    });
    expect(messages[1]).toMatchObject({
      providerId: 'OpenAI',
      model: 'gpt-4.1-mini',
      thinkingText: 'short thought'
    });
  });

  it('exposes a structured export snapshot for offline Polaris import packages', async () => {
    const blob = await createKelivoBackupBlob();
    const { snapshot, stats } = await convertKelivoBackupToStructuredExportSnapshot(blob);

    expect(stats).toMatchObject({
      conversations: 1,
      messages: 2,
      personas: 1,
      providers: 2,
      assets: 4
    });
    expect(snapshot.chatState?.conversations[0]?.messages[0]?.content).toBe('see upload/sketch.png');
    expect(snapshot.personaState?.personas[0]?.name).toBe('Nova');
    expect(snapshot.runtimeState?.providers.find((provider) => provider.id === 'OpenAI')?.apiKey).toBe('sk-test');
    expect(snapshot.assetEntries?.map((entry) => entry.meta.name)).toEqual(expect.arrayContaining([
      'nova.png',
      'user.png',
      'room.webp',
      'sketch.png'
    ]));
  });

  it('materializes missing Kelivo conversation assistants as editable personas', async () => {
    const blob = await createKelivoBackupBlob({
      settingsPatch: {
        current_assistant_id_v1: 'missing-assistant'
      },
      chatsPatch: {
        conversations: [{
          id: 'conversation-1',
          title: 'orphan room',
          assistantId: 'missing-assistant',
          createdAt: '2026-05-31T12:00:00.000Z',
          updatedAt: '2026-05-31T12:01:00.000Z',
          messageIds: ['message-1', 'message-2']
        }]
      }
    });

    const converted = await convertKelivoBackupZip(blob);
    const personaState = converted.kvEntries.find((entry) => entry.key === 'persona-state-v2')?.value as {
      personas: Array<{ id: string; name: string; description: string }>;
      activeCollaboratorId: string | null;
    };
    const chatCatalog = converted.kvEntries.find((entry) => entry.key === 'chat-catalog-v1')?.value as {
      conversations?: Array<{ id: string; collaboratorId: string | null }>;
    };
    const spaceEntry = converted.localStorageEntries[0]?.value ?? '{}';
    const spaceState = JSON.parse(spaceEntry) as {
      state?: { frontstageCollaboratorId?: string | null };
    };

    expect(converted.stats.personas).toBe(2);
    expect(personaState.activeCollaboratorId).toBe('missing-assistant');
    expect(personaState.personas).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'missing-assistant',
        name: 'Kelivo 导入协作者 1'
      })
    ]));
    expect(chatCatalog.conversations?.[0]?.collaboratorId).toBe('missing-assistant');
    expect(spaceState.state?.frontstageCollaboratorId).toBe('missing-assistant');
  });
});


describe('Kelivo live import publication', () => {
  beforeEach(() => vi.clearAllMocks());

  it.each(['legacy-zip', 'sqlite-zip', 'sqlite'] as const)('publishes %s through the shared transactional snapshot importer', async (format) => {
    const blob = format === 'legacy-zip' ? await createKelivoBackupBlob()
      : format === 'sqlite-zip' ? await createCurrentKelivoBackupBlob()
      : new Blob([new Uint8Array(await createCurrentKelivoDatabase())]);
    expect(await importKelivoBackupPackageIfMatched(blob)).toEqual({});
    expect(imports.importStructuredExportSnapshot).toHaveBeenCalledTimes(1);
    const snapshot = imports.importStructuredExportSnapshot.mock.calls[0]?.[0] as unknown as {
      chatState: { conversations: unknown[] }; personaState: { personas: unknown[] }; assetEntries: unknown[];
    };
    expect(snapshot.chatState.conversations.length).toBeGreaterThan(0);
    expect(snapshot.personaState.personas.length).toBeGreaterThan(0);
    expect(imports.importPersistedDataDirectly).not.toHaveBeenCalled();
  });

  it('propagates publication failure without retrying through destructive legacy replacement', async () => {
    imports.importStructuredExportSnapshot.mockRejectedValueOnce(new Error('publish failed'));
    await expect(importKelivoBackupPackage(await createKelivoBackupBlob())).rejects.toThrow('publish failed');
    expect(imports.importStructuredExportSnapshot).toHaveBeenCalledTimes(1);
    expect(imports.importPersistedDataDirectly).not.toHaveBeenCalled();
  });
});
