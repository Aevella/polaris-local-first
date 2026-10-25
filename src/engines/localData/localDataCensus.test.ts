import { describe, expect, it } from 'vitest';
import { buildLocalDataCensusSnapshot } from './localDataCensus';
import {
  createCompleteLocalDataRow,
  createIncompleteLocalDataRow,
  getLocalDataActiveDataSourceKey,
  getLocalDataRowKey
} from './types';

function assetRowValue(seed: {
  id: string;
  hasMeta: boolean;
  hasBinary: boolean;
  hasPreview?: boolean;
  ownerRefs?: Array<{ kind: 'theme' | 'image-card'; id: string; label: string }>;
}) {
  return {
    id: seed.id,
    objectId: `asset:${seed.id}`,
    kind: seed.hasMeta ? 'image' : 'unknown',
    name: `${seed.id}.png`,
    mimeType: 'image/png',
    size: seed.hasMeta ? 10 : null,
    createdAt: seed.hasMeta ? 1 : null,
    hasMeta: seed.hasMeta,
    hasBinary: seed.hasBinary,
    hasPreview: Boolean(seed.hasPreview),
    binaryBytes: seed.hasBinary ? 10 : 0,
    previewBytes: seed.hasPreview ? 2 : 0,
    ownerRefs: seed.ownerRefs ?? [],
    ownerCount: seed.ownerRefs?.length ?? 0,
    orphan: !seed.ownerRefs?.length,
    updatedAt: 1
  };
}

describe('buildLocalDataCensusSnapshot', () => {
  it('treats legacy chat message chunks as readable bodies when catalog records are absent', () => {
    const snapshot = buildLocalDataCensusSnapshot({
      kv: [
        {
          key: 'chat-catalog-v1',
          value: {
            conversations: [
              {
                id: 'c-legacy',
                collaboratorId: 'pharos',
                recordKey: 'chat-conversation-record-v1:c-legacy'
              }
            ],
            activeConversationId: 'c-legacy'
          }
        },
        {
          key: 'chat-messages-v2:c-legacy',
          value: [{ attachments: [{ assetId: 'asset-ok' }] }]
        },
        {
          key: 'persona-state-v2',
          value: {
            personas: [{ id: 'pharos' }],
            activeCollaboratorId: 'pharos'
          }
        }
      ],
      assetMeta: [
        { key: 'asset-ok', value: { id: 'asset-ok', kind: 'image', name: 'ok.png', mimeType: 'image/png', size: 1, createdAt: 1 } }
      ],
      assetBinary: [{ key: 'asset-ok', value: new Blob(['ok']) }],
      localStorage: []
    });

    expect(snapshot.chat).toEqual(expect.objectContaining({
      catalogConversationCount: 1,
      conversationRecordCount: 0,
      catalogMissingRecordCount: 0,
      missingBodyCount: 0,
      assetRefCount: 1,
      missingAssetMetaRefCount: 0,
      missingAssetBinaryRefCount: 0
    }));
  });

  it('counts local data domains without exposing persisted content', () => {
    const snapshot = buildLocalDataCensusSnapshot({
      kv: [
        {
          key: getLocalDataActiveDataSourceKey(),
          value: {
            schemaVersion: 1,
            key: getLocalDataActiveDataSourceKey(),
            activeDataSource: 'unknown',
            activeCommitId: null,
            stagingCommitId: null,
            updatedAt: 1,
            domains: {}
          }
        },
        {
          key: 'local-data-v1:row:chat:conversation:c-1',
          value: createCompleteLocalDataRow({
            ref: { domain: 'chat', kind: 'conversation', id: 'c-1' },
            value: { id: 'c-1' },
            version: 1,
            updatedAt: 1
          })
        },
        {
          key: 'chat-catalog-v1',
          value: {
            schemaVersion: 1,
            activeConversationId: 'missing-active',
            conversations: [
              {
                id: 'c-1',
                collaboratorId: 'pharos',
                recordKey: 'chat-conversation-record-v1:c-1',
                messageCount: 1
              },
              {
                id: 'c-2',
                collaboratorId: 'missing-persona',
                recordKey: 'chat-conversation-record-v1:c-2',
                messageCount: 2
              },
              {
                id: 'c-3',
                collaboratorId: null,
                recordKey: 'chat-conversation-record-v1:c-3',
                messageCount: 1
              }
            ]
          }
        },
        {
          key: 'chat-conversation-record-v1:c-1',
          value: {
            schemaVersion: 1,
            messages: [
              { attachments: [{ assetId: 'asset-ok' }, { assetId: 'asset-cleared', clearedAt: 2 }] }
            ]
          }
        },
        {
          key: 'chat-conversation-record-v1:c-orphan',
          value: { schemaVersion: 1, messages: [{ attachments: [{ assetId: 'asset-orphan-ref' }] }] }
        },
        {
          key: 'persona-state-v2',
          value: {
            activeCollaboratorId: 'missing-persona',
            personas: [
              {
                id: 'pharos',
                assistantAvatarAssetId: 'asset-avatar',
                memory: {
                  referenceDocs: [{ id: 'doc-missing', content: '', contentLoaded: false }]
                }
              }
            ]
          }
        },
        { key: 'persona-memory-doc-content-v2:pharos:doc-orphan', value: 'orphan memory body' },
        {
          key: 'collection-state-v2',
          value: {
            cards: [
              {
                id: 'card-1',
                ownerCollaboratorId: 'pharos',
                code: 'background: url(polaris-asset://asset-ok)'
              },
              {
                id: 'card-2',
                ownerCollaboratorId: '',
                code: ''
              }
            ],
            imageCards: [
              { id: 'image-1', assetId: 'asset-missing-binary', ownerCollaboratorId: 'missing-persona' },
              { id: 'image-2', assetId: 'asset-ok', ownerCollaboratorId: 'collection-only-owner' }
            ],
            projectFiles: [
              { id: 'file-1', projectId: 'project-missing', ownerCollaboratorId: 'pharos', content: '' }
            ],
            roomProjects: [],
            workspaceReferenceDocs: [
              { id: 'doc-1', projectId: 'project-missing', ownerCollaboratorId: 'pharos', content: '', summary: '' }
            ]
          }
        },
        { key: 'workspace-reference-doc-content-v1:doc-orphan', value: 'orphan workspace body' },
        {
          key: 'space-theme-state-v1',
          value: {
            frontstageCollaboratorId: 'missing-persona',
            collectionProjectId: 'project-missing',
            customization: { backgroundAssetId: 'asset-space-missing' }
          }
        }
      ],
      assetMeta: [
        { key: 'asset-ok', value: { id: 'asset-ok', kind: 'image', name: 'ok.png', mimeType: 'image/png', size: 2, createdAt: 1 } },
        { key: 'asset-avatar', value: { id: 'asset-avatar', kind: 'image', name: 'avatar.png', mimeType: 'image/png', size: 3, createdAt: 1 } },
        { key: 'asset-missing-binary', value: { id: 'asset-missing-binary', kind: 'image', name: 'missing.png', mimeType: 'image/png', size: 4, createdAt: 1 } },
        { key: 'asset-unreferenced', value: { id: 'asset-unreferenced', kind: 'file', name: 'old.txt', mimeType: 'text/plain', size: 5, createdAt: 1 } }
      ],
      assetBinary: [
        { key: 'asset-ok', value: new Blob(['ok']) },
        { key: 'asset-unreferenced', value: new Blob(['old']) }
      ],
      assetPreview: [
        { key: 'asset-preview-only', value: new Blob(['preview']) }
      ],
      localStorage: [
        { key: 'polaris-space-store-v1', value: '{"state":{}}' }
      ]
    });

    expect(snapshot.repository).toEqual(expect.objectContaining({
      activeDataSource: 'unknown',
      activeDataSourceRowPresent: true,
      rowCount: 1
    }));
    expect(snapshot.knownCollaboratorCount).toBe(1);
    // Retired Polaris Assistant remains a known historical owner, not a live collaborator.
    expect(snapshot.knownOwnerCount).toBe(3);
    expect(snapshot.chat).toEqual(expect.objectContaining({
      catalogConversationCount: 3,
      conversationRecordCount: 2,
      catalogMissingRecordCount: 2,
      orphanConversationRecordCount: 1,
      missingOwnerRefCount: 1,
      danglingOwnerRefCount: 0,
      activeConversationMissing: true
    }));
    expect(snapshot.persona).toEqual(expect.objectContaining({
      personaCount: 1,
      activeCollaboratorMissing: true,
      missingBodyCount: 1,
      orphanBodyCount: 1,
      avatarAssetRefCount: 1,
      missingAssetBinaryRefCount: 1
    }));
    expect(snapshot.collection).toEqual(expect.objectContaining({
      objectCount: 6,
      missingOwnerRefCount: 1,
      danglingOwnerRefCount: 1,
      missingBodyCount: 1,
      orphanBodyCount: 1,
      projectFileMissingProjectCount: 1,
      workspaceDocMissingProjectCount: 1,
      missingAssetBinaryRefCount: 1
    }));
    expect(snapshot.asset).toEqual(expect.objectContaining({
      referencedAssetCount: 5,
      referencedMissingMetaCount: 2,
      referencedMissingBinaryCount: 4,
      storedOrphanAssetCount: 1,
      previewOnlyCount: 1
    }));
    expect(snapshot.space).toEqual(expect.objectContaining({
      legacyLocalStorageSourceCount: 1,
      activeCollaboratorRefMissing: true,
      activeProjectRefMissing: true
    }));
  });

  it('uses LocalData asset rows as asset census facts without legacy asset store scans', () => {
    const ownedRef = { domain: 'asset' as const, kind: 'asset', id: 'asset-owned' };
    const orphanRef = { domain: 'asset' as const, kind: 'asset', id: 'asset-orphan' };
    const missingBinaryRef = { domain: 'asset' as const, kind: 'asset', id: 'asset-missing-binary' };
    const previewOnlyRef = { domain: 'asset' as const, kind: 'asset', id: 'asset-preview-only' };
    const snapshot = buildLocalDataCensusSnapshot({
      kv: [
        {
          key: getLocalDataRowKey(ownedRef),
          value: createCompleteLocalDataRow({
            ref: ownedRef,
            value: assetRowValue({
              id: ownedRef.id,
              hasMeta: true,
              hasBinary: true,
              ownerRefs: [{ kind: 'theme', id: 'theme-current', label: 'Theme' }]
            }),
            version: 1,
            updatedAt: 1
          })
        },
        {
          key: getLocalDataRowKey(orphanRef),
          value: createCompleteLocalDataRow({
            ref: orphanRef,
            value: assetRowValue({
              id: orphanRef.id,
              hasMeta: true,
              hasBinary: true
            }),
            version: 1,
            updatedAt: 1
          })
        },
        {
          key: getLocalDataRowKey(missingBinaryRef),
          value: createIncompleteLocalDataRow({
            ref: missingBinaryRef,
            reason: 'missing-binary',
            missingKeys: [`asset-binary:${missingBinaryRef.id}`],
            meta: assetRowValue({
              id: missingBinaryRef.id,
              hasMeta: true,
              hasBinary: false,
              ownerRefs: [{ kind: 'image-card', id: 'image-1', label: 'Image' }]
            }),
            version: 1,
            updatedAt: 1
          })
        },
        {
          key: getLocalDataRowKey(previewOnlyRef),
          value: createIncompleteLocalDataRow({
            ref: previewOnlyRef,
            reason: 'preview-only',
            missingKeys: [`asset-meta:${previewOnlyRef.id}`, `asset-binary:${previewOnlyRef.id}`],
            meta: assetRowValue({
              id: previewOnlyRef.id,
              hasMeta: false,
              hasBinary: false,
              hasPreview: true
            }),
            version: 1,
            updatedAt: 1
          })
        }
      ],
      assetMeta: [],
      assetBinary: [],
      assetPreview: [],
      localStorage: []
    });

    expect(snapshot.asset).toEqual(expect.objectContaining({
      storedMetaCount: 3,
      storedBinaryCount: 2,
      storedPreviewCount: 1,
      referencedAssetCount: 2,
      referencedMissingMetaCount: 0,
      referencedMissingBinaryCount: 1,
      storedOrphanAssetCount: 1,
      previewOnlyCount: 1
    }));
  });

  it('counts chunked document bodies shorter than their directory as missing bodies', () => {
    const snapshot = buildLocalDataCensusSnapshot({
      kv: [
        {
          key: 'persona-state-v2',
          value: {
            personas: [{
              id: 'pharos',
              memory: {
                referenceDocs: [{ id: 'memory-tail-missing', content: '', charCount: 11, contentLoaded: false }]
              }
            }],
            activeCollaboratorId: 'pharos'
          }
        },
        {
          key: 'persona-memory-doc-content-v3:pharos:memory-tail-missing:0',
          value: 'hello '
        },
        {
          key: 'collection-state-v2',
          value: {
            cards: [],
            imageCards: [],
            projectFiles: [],
            roomProjects: [],
            workspaceReferenceDocs: [
              { id: 'workspace-tail-missing', projectId: 'project-1', content: '', charCount: 11, contentLoaded: false, summary: '' }
            ]
          }
        },
        {
          key: 'workspace-reference-doc-content-v2:workspace-tail-missing:0',
          value: 'hello '
        }
      ],
      assetMeta: [],
      assetBinary: [],
      localStorage: []
    });

    expect(snapshot.persona).toEqual(expect.objectContaining({
      missingBodyCount: 1,
      orphanBodyCount: 0
    }));
    expect(snapshot.collection).toEqual(expect.objectContaining({
      missingBodyCount: 1,
      orphanBodyCount: 0
    }));
  });
});
