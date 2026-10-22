import { describe, expect, it } from 'vitest';
import type { ChatMessage, Conversation, GroupChatRoom, WorkspaceLedgerEvent } from '../../types/domain';
import {
  CONVERSATION_DURABLE_FIELDS,
  CONVERSATION_FIELD_CLASSIFICATION,
  LocalDataProjectionContractError
} from './chatConversationContracts';
import {
  buildConversationLocalDataProjection,
  buildConversationRecordMetadata,
  buildConversationLocalDataUnitOfWork,
  collectConversationAssetRefs,
  getChatDomainMetaLocalDataRef,
  getConversationCatalogLocalDataRef,
  getConversationRecordLocalDataRef
} from './chatRows';
import { getLocalDataRowKey } from './types';

function message(id: string, content: string, timestamp: number, attachments: ChatMessage['attachments'] = []): ChatMessage {
  return {
    id,
    role: 'user',
    content,
    timestamp,
    attachments
  };
}

function conversation(messages: ChatMessage[]): Conversation {
  const workspaceLedger: WorkspaceLedgerEvent[] = [{
    id: 'ledger-1',
    kind: 'workspace_scope_changed',
    createdAt: 12,
    change: 'entered',
    previousProjectId: null,
    nextProjectId: 'project-1',
    summary: 'Entered project workspace'
  }];

  return {
    id: 'c-chat',
    title: 'LocalData chat',
    collaboratorId: 'pharos',
    activeProjectId: 'project-1',
    reasoningStrength: 'high',
    task: {
      id: 'task-1',
      sourceMessageId: 'm-1',
      goal: 'finish local data adapter',
      title: 'Adapter',
      status: 'running',
      stage: 'implementation',
      steps: [],
      executions: [],
      createdAt: 1,
      updatedAt: 2
    },
    draft: 'pending draft text',
    workspaceLedger,
    pinnedAt: 5,
    updatedAt: 20,
    messages
  };
}

describe('collectConversationAssetRefs', () => {
  it('collects unique attachment, text, tool result, native call, and card references', () => {
    const toolMessage: ChatMessage = {
      ...message('m-3', 'tool text', 3),
      nativeToolCalls: [{
        name: 'generateImage',
        argumentsText: '{"source":"polaris-asset://asset-native"}'
      }],
      toolInvocation: {
        id: 'tool-1',
        kind: 'generateImage',
        status: 'executed',
        title: 'Generated',
        summary: 'result polaris-asset://asset-tool-summary',
        mcpResult: {
          serverId: 'server-1',
          serverName: 'Server',
          toolName: 'result',
          argumentsObject: {},
          structuredContent: {
            image: 'polaris-asset://asset-tool-structured'
          }
        }
      },
      cardReference: {
        id: 'card-1',
        title: 'Card',
        language: 'html',
        code: '<img src="polaris-asset://asset-card-code">',
        cardFaceCss: '.card { background: url("polaris-asset://asset-card-css"); }',
        mode: 'reference'
      }
    };

    expect(collectConversationAssetRefs([
      message('m-1', 'inline polaris-asset://asset-inline', 1, [{
        id: 'attachment-1',
        assetId: 'asset-attachment',
        kind: 'image',
        name: 'a.png',
        mimeType: 'image/png',
        size: 10
      }]),
      {
        ...message('m-2', 'again polaris-asset://asset-inline and polaris-asset://asset%20encoded', 2),
        requestContent: 'request polaris-asset://asset-request',
        thinkingText: 'thinking polaris-asset://asset-thinking',
        voiceCache: {
          assetId: 'asset-voice-cache',
          name: 'voice.mp3',
          mimeType: 'audio/mpeg',
          size: 256,
          createdAt: 2,
          textHash: 'voice-hash',
          textLength: 5,
          providerType: 'openai-compatible',
          model: 'tts-1',
          voice: 'alloy',
          format: 'mp3'
        }
      },
      toolMessage
    ])).toEqual([
      'asset encoded',
      'asset-attachment',
      'asset-card-code',
      'asset-card-css',
      'asset-inline',
      'asset-native',
      'asset-request',
      'asset-thinking',
      'asset-tool-structured',
      'asset-tool-summary',
      'asset-voice-cache'
    ]);
  });
});

describe('conversation durable projection contract', () => {
  it('classifies current Conversation fields so durable additions cannot bypass the adapter silently', () => {
    expect(CONVERSATION_FIELD_CLASSIFICATION).toEqual({
      id: 'durable',
      title: 'durable',
      kind: 'durable',
      collaboratorId: 'durable',
      group: 'durable',
      groupRoomId: 'durable',
      activeProjectId: 'durable',
      reasoningStrength: 'durable',
      requestContext: 'durable',
      windowPreferences: 'durable',
      messages: 'durable',
      toolLedger: 'derived',
      workspaceLedger: 'durable',
      task: 'durable',
      draft: 'durable',
      pinnedAt: 'durable',
      updatedAt: 'durable'
    });
    expect(CONVERSATION_DURABLE_FIELDS).toEqual([
      'id',
      'title',
      'kind',
      'collaboratorId',
      'group',
      'groupRoomId',
      'activeProjectId',
      'reasoningStrength',
      'requestContext',
      'windowPreferences',
      'messages',
      'workspaceLedger',
      'task',
      'draft',
      'pinnedAt',
      'updatedAt'
    ]);
  });
});

describe('buildConversationLocalDataProjection', () => {
  it('maps a complete conversation into catalog and record rows', () => {
    const source = conversation([
      message('m-1', 'hello', 10),
      message('m-2', 'with polaris-asset://asset-inline', 15)
    ]);

    const projection = buildConversationLocalDataProjection({
      conversation: source,
      bodyState: 'complete',
      version: 3,
      committedAt: 30
    });

    expect(projection.catalogRow).toEqual(expect.objectContaining({
      state: 'complete',
      key: getLocalDataRowKey(getConversationCatalogLocalDataRef(source.id)),
      value: expect.objectContaining({
        id: source.id,
        title: source.title,
        kind: 'direct',
        collaboratorId: 'pharos',
        groupRoomId: null,
        activeProjectId: 'project-1',
        reasoningStrength: 'high',
        pinnedAt: 5,
        messageCount: 2,
        latestMessageTimestamp: 15,
        state: 'active',
        recordVersion: 3
      })
    }));
    expect(projection.recordRow).toEqual(expect.objectContaining({
      state: 'complete',
      key: getLocalDataRowKey(getConversationRecordLocalDataRef(source.id)),
      value: expect.objectContaining({
        id: source.id,
        version: 3,
        committedAt: 30,
        messages: source.messages,
        task: source.task,
        draft: 'pending draft text',
        workspaceLedger: source.workspaceLedger,
        ownerProjectId: 'project-1',
        assetRefs: ['asset-inline']
      })
    }));
  });

  it('keeps unloaded bodies unloaded instead of turning them into empty complete records', () => {
    const source = conversation([]);

    const projection = buildConversationLocalDataProjection({
      conversation: source,
      bodyState: 'unloaded',
      expectedMessageCount: 4,
      expectedLatestMessageTimestamp: 99,
      version: 3,
      committedAt: 30
    });

    expect(projection.catalogRow).toEqual(expect.objectContaining({
      value: expect.objectContaining({
        messageCount: 4,
        latestMessageTimestamp: 99,
        state: 'unloaded'
      })
    }));
    expect(projection.recordRow).toBeUndefined();
  });

  it('marks a body incomplete in catalog metadata without writing an incomplete record row', () => {
    const source = conversation([]);

    const projection = buildConversationLocalDataProjection({
      conversation: source,
      bodyState: 'incomplete',
      expectedMessageCount: 1,
      expectedLatestMessageTimestamp: 99,
      version: 3,
      committedAt: 30,
      missingKeys: ['chat-conversation-record-v1:c-chat']
    });

    expect(projection.catalogRow).toEqual(expect.objectContaining({
      value: expect.objectContaining({
        messageCount: 1,
        latestMessageTimestamp: 99,
        state: 'incomplete',
        missingRecordKeys: ['chat-conversation-record-v1:c-chat']
      })
    }));
    expect(projection.recordRow).toBeUndefined();
  });

  it('rejects a complete projection whose expected metadata does not match loaded messages', () => {
    const source = conversation([]);

    expect(() => buildConversationLocalDataProjection({
      conversation: source,
      bodyState: 'complete',
      expectedMessageCount: 1,
      expectedLatestMessageTimestamp: 99,
      version: 3,
      committedAt: 30
    })).toThrow(LocalDataProjectionContractError);
  });
});

describe('buildConversationLocalDataUnitOfWork', () => {
  it('creates a chat-scoped unit with domain metadata, catalog rows, and complete record rows', () => {
    const source = conversation([message('m-1', 'hello', 10)]);
    const groupRoom: GroupChatRoom = {
      id: 'group-1',
      title: '三人群',
      memberIds: ['pharos', 'lyra'],
      activeConversationId: null,
      draft: '',
      background: '',
      replyMode: 'round',
      allowMemberSilence: false,
      memoryRecallEnabled: true,
      toolSettings: { cards: true },
      createdAt: 1,
      updatedAt: 2
    };

    const unit = buildConversationLocalDataUnitOfWork({
      id: 'chat-unit',
      activeConversationId: source.id,
      groupRooms: [groupRoom],
      version: 3,
      updatedAt: 40,
      conversations: [{
        conversation: source,
        bodyState: 'complete',
        version: 3,
        committedAt: 30
      }]
    });

    expect(unit).toEqual(expect.objectContaining({
      id: 'chat-unit',
      domain: 'chat',
      version: 3
    }));
    expect(unit.mutations).toHaveLength(3);
    expect(unit.mutations[0]).toEqual({
      type: 'put',
      row: expect.objectContaining({
        key: getLocalDataRowKey(getChatDomainMetaLocalDataRef()),
        value: expect.objectContaining({
          activeConversationId: source.id,
          activeConversationCount: 1,
          quarantinedConversationCount: 0,
          totalConversationCount: 1,
          groupRooms: [groupRoom]
        })
      })
    });
    expect(unit.mutations.map((mutation) => mutation.type)).toEqual(['put', 'put', 'put']);
  });

  it('does not include record mutations for unloaded conversations', () => {
    const source = conversation([]);

    const unit = buildConversationLocalDataUnitOfWork({
      id: 'chat-unit',
      activeConversationId: source.id,
      version: 3,
      updatedAt: 40,
      conversations: [{
        conversation: source,
        bodyState: 'unloaded',
        expectedMessageCount: 4,
        expectedLatestMessageTimestamp: 99,
        version: 3,
        committedAt: 30
      }]
    });

    expect(unit.mutations).toHaveLength(2);
    expect(unit.mutations[0]).toEqual(expect.objectContaining({
      row: expect.objectContaining({
        value: expect.objectContaining({
          activeConversationCount: 0,
          quarantinedConversationCount: 1,
          totalConversationCount: 1
        })
      })
    }));
    expect(unit.mutations).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        row: expect.objectContaining({
          key: getLocalDataRowKey(getConversationRecordLocalDataRef(source.id))
        })
      })
    ]));
  });
});

describe('buildConversationRecordMetadata', () => {
  it('keeps the durable metadata contract shared by whole and incremental bodies', () => {
    const source = conversation([message('m', 'hello', 1)]);
    source.draft = 'draft';
    source.activeProjectId = 'project';
    const args = { conversation: source, bodyState: 'complete' as const, version: 1, committedAt: 2 };
    const metadata = buildConversationRecordMetadata(args, ['asset']);
    expect(metadata).toMatchObject({ id: source.id, draft: 'draft', ownerProjectId: 'project', version: 1, committedAt: 2, assetRefs: ['asset'] });
    const row = buildConversationLocalDataProjection(args).recordRow;
    expect(row?.state === 'complete' ? { ...row.value, assetRefs: ['asset'], messages: undefined } : null).toEqual({ ...metadata, messages: undefined });
    expect(buildConversationRecordMetadata(args, ['asset'])).toEqual(metadata);
  });
});
