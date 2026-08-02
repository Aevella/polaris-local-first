import { describe, expect, it } from 'vitest';
import {
  normalizeClientDiagnosticsPayload,
  sanitizeClientDiagnosticText
} from './clientDiagnostics';

describe('client diagnostics', () => {
  it('redacts tokens, url tails, and long opaque strings from diagnostic text', () => {
    const sanitized = sanitizeClientDiagnosticText(
      'failed https://example.com/api?token=secret&prompt=hello Bearer sk-1234567890abcdef1234567890abcdef abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcdefghijklmnopqrstuvwxyz'
    );

    expect(sanitized).toContain('https://example.com/api[redacted-url-tail]');
    expect(sanitized).toContain('Bearer [redacted]');
    expect(sanitized).toContain('[redacted-long-token]');
    expect(sanitized).not.toContain('secret');
    expect(sanitized).not.toContain('prompt=hello');
  });

  it('normalizes storage summaries without accepting raw unknown payload fields', () => {
    const normalized = normalizeClientDiagnosticsPayload({
      schemaVersion: 1,
      eventId: 'event-1',
      sessionId: 'session-1',
      eventKind: 'startup',
      createdAt: 1,
      platform: 'ios',
      ignoredRawBody: 'do not keep me',
      storage: {
        storageMode: 'native',
        storageLabel: 'iOS native storage',
        kvKeyCount: 12.4,
        kvKeyBuckets: {
          'chat:records': 3,
          'persona:doc-body': 2,
          'bad key with spaces': 99
        },
        assetMetaKeyCount: 4,
        assetBinaryKeyCount: 4,
        assetPreviewKeyCount: 2,
        localStorageKeyCount: 6,
        localStorageBytes: 100
      }
    }, 10);

    expect(normalized).toMatchObject({
      eventKind: 'startup',
      platform: 'ios',
      storage: {
        kvKeyCount: 12,
        kvKeyBuckets: {
          'chat:records': 3,
          'persona:doc-body': 2
        }
      },
      receivedAt: 10
    });
    expect(normalized).not.toHaveProperty('ignoredRawBody');
  });

  it('normalizes LocalData usage summaries without accepting row bodies or commit ids', () => {
    const normalized = normalizeClientDiagnosticsPayload({
      schemaVersion: 1,
      eventId: 'event-1',
      sessionId: 'session-1',
      eventKind: 'startup',
      createdAt: 1,
      platform: 'web',
      storage: {
        kvKeyCount: 42,
        kvKeyBuckets: {},
        assetMetaKeyCount: 0,
        assetBinaryKeyCount: 0,
        assetPreviewKeyCount: 0,
        localStorageKeyCount: 0,
        localStorageBytes: 0
      },
      localData: {
        activeDataSource: 'repository',
        activeDataSourceRowPresent: true,
        activeDomainCount: 2,
        activeDomains: ['collection', 'space', 'bad domain with spaces'],
        repositoryKeyCount: 12,
        repositoryRowCount: 9,
        repositoryPointerCount: 2,
        repositoryRowsByDomain: {
          collection: 6,
          space: 3,
          'bad domain with spaces': 99
        },
        nonRepositoryKvKeyCount: 30,
        domainSources: [
          {
            domain: 'chat',
            status: 'local-data-live',
            activeObjectCount: 2,
            objectCount: 2,
            repositoryRowCount: 4,
            legacySourceCount: 1,
            issueCount: 1,
            issues: ['缺正文 1'],
            evidence: ['chat-conversation-record-v1:secret'],
            rawConversationTitle: 'do not keep me'
          },
          {
            domain: 'bad domain with spaces',
            status: 'repository-active',
            activeObjectCount: 99
          },
          {
            domain: 'persona',
            status: 'unknown-status',
            activeObjectCount: 99
          }
        ],
        collaboratorOrphans: [
          {
            collaboratorFingerprint: 'anon-1234abcd',
            rowFingerprint: 'anon-5678efab',
            rowState: 'deleted',
            rowUpdatedAt: 1781502700004,
            rowDeletedAt: 1781502800004,
            repositoryRowPresent: true,
            personaStateHasId: false,
            referencedByLiveOwnerRef: true,
            hasOrphanMemoryBodies: true,
            splitMemoryBodyCount: 1,
            chunkedMemoryBodyCount: 2,
            chunkedMemoryBodyChunkCount: 4,
            rawPrompt: 'do not keep me'
          },
          {
            collaboratorId: '这不是结构id',
            rowKey: '一段正文',
            rowState: 'deleted',
            rowUpdatedAt: 1
          }
        ],
        rawConversationTitle: 'do not keep me',
        commitId: 'commit-secret'
      }
    }, 10);

    expect(normalized).toMatchObject({
      localData: {
        activeDataSource: 'repository',
        activeDataSourceRowPresent: true,
        activeDomainCount: 2,
        activeDomains: ['collection', 'space'],
        repositoryRowsByDomain: {
          collection: 6,
          space: 3
        },
        domainSources: [{
          domain: 'chat',
          status: 'local-data-live',
          activeObjectCount: 2,
          objectCount: 2,
          repositoryRowCount: 4,
          legacySourceCount: 1,
          issueCount: 1
        }],
        collaboratorOrphans: [{
          collaboratorFingerprint: 'anon-1234abcd',
          rowFingerprint: 'anon-5678efab',
          rowState: 'deleted',
          rowUpdatedAt: 1781502700004,
          rowDeletedAt: 1781502800004,
          repositoryRowPresent: true,
          personaStateHasId: false,
          referencedByLiveOwnerRef: true,
          hasOrphanMemoryBodies: true,
          splitMemoryBodyCount: 1,
          chunkedMemoryBodyCount: 2,
          chunkedMemoryBodyChunkCount: 4
        }]
      }
    });
    expect(normalized?.localData).not.toHaveProperty('rawConversationTitle');
    expect(normalized?.localData).not.toHaveProperty('commitId');
    expect(normalized?.localData?.domainSources?.[0]).not.toHaveProperty('evidence');
    expect(normalized?.localData?.domainSources?.[0]).not.toHaveProperty('rawConversationTitle');
    expect(normalized?.localData?.collaboratorOrphans?.[0]).not.toHaveProperty('rawPrompt');
  });

  it('rejects error events that do not contain a usable error summary', () => {
    expect(normalizeClientDiagnosticsPayload({
      schemaVersion: 1,
      eventId: 'event-1',
      sessionId: 'session-1',
      eventKind: 'window-error',
      createdAt: 1,
      platform: 'web'
    })).toBeNull();
  });

  it('keeps persistence diagnostics to backend, counts, stage, integrity, and anonymous fingerprints', () => {
    const normalized = normalizeClientDiagnosticsPayload({
      schemaVersion: 1,
      eventId: 'event-persistence',
      sessionId: 'session-1',
      eventKind: 'persistence-error',
      createdAt: 1,
      platform: 'ios',
      persistence: {
        backend: 'native-transactional',
        store: 'chat',
        domain: 'chat',
        operation: 'read-isolated-row',
        stage: 'hydrate-row',
        integrity: 'degraded',
        rowCount: 1,
        fingerprint: 'anon-1234abcd',
        body: 'private conversation body',
        title: 'private title'
      },
      error: {
        source: 'persistence',
        message: 'Local persistence integrity event.'
      }
    });

    expect(normalized?.persistence).toEqual({
      backend: 'native-transactional',
      store: 'chat',
      domain: 'chat',
      operation: 'read-isolated-row',
      stage: 'hydrate-row',
      integrity: 'degraded',
      rowCount: 1,
      fingerprint: 'anon-1234abcd'
    });
    expect(normalized?.persistence).not.toHaveProperty('body');
    expect(normalized?.persistence).not.toHaveProperty('title');
  });
});
