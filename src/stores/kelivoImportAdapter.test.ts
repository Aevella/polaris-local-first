import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import type { ChatMessage } from '../types/domain';
import {
  convertKelivoBackupToStructuredExportSnapshot,
  convertKelivoBackupZip,
  isKelivoBackupZip
} from './kelivoImportAdapter';
import type { RuntimePayload } from './runtimeStorePersistence';

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

describe('convertKelivoBackupZip', () => {
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
