import { describe, expect, it } from 'vitest';
import {
  buildLocalDataCensusReport,
  formatLocalDataCensusReport
} from './localDataCensusReport';
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

describe('buildLocalDataCensusReport', () => {
  it('counts legacy chat message chunks as readable bodies when self-contained records are absent', () => {
    const report = buildLocalDataCensusReport({
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

    const chat = report.domains.find((domain) => domain.domain === 'chat');
    expect(report.ok).toBe(true);
    expect(report.blockers).toEqual([]);
    expect(chat).toEqual(expect.objectContaining({
      baselineObjectIds: ['c-legacy'],
      missingBodyObjectIds: [],
      assetRefIds: ['asset-ok'],
      legacySourceKeys: ['chat-messages-v2:c-legacy']
    }));
  });

  it('does not classify unread existing chat body keys as missing bodies', () => {
    const report = buildLocalDataCensusReport({
      kv: [
        {
          key: 'chat-catalog-v1',
          value: {
            conversations: [
              {
                id: 'c-lightweight',
                collaboratorId: 'pharos',
                recordKey: 'chat-conversation-record-v1:c-lightweight'
              },
              {
                id: 'c-legacy-lightweight',
                collaboratorId: 'pharos',
                recordKey: 'chat-conversation-record-v1:c-legacy-lightweight'
              },
              {
                id: 'c-missing',
                collaboratorId: 'pharos',
                recordKey: 'chat-conversation-record-v1:c-missing'
              }
            ],
            activeConversationId: 'c-lightweight'
          }
        },
        { key: 'chat-conversation-record-v1:c-lightweight', value: undefined },
        { key: 'chat-messages-v2:c-legacy-lightweight', value: undefined },
        {
          key: 'persona-state-v2',
          value: {
            personas: [{ id: 'pharos' }],
            activeCollaboratorId: 'pharos'
          }
        }
      ],
      assetMeta: [],
      assetBinaryKeys: [],
      localStorage: []
    });

    const chat = report.domains.find((domain) => domain.domain === 'chat');
    expect(chat).toEqual(expect.objectContaining({
      baselineObjectIds: ['c-legacy-lightweight', 'c-lightweight', 'c-missing'],
      missingBodyObjectIds: ['c-missing']
    }));
  });

  it('uses LocalData asset rows as asset census facts without legacy asset store scans', () => {
    const ownedRef = { domain: 'asset' as const, kind: 'asset', id: 'asset-owned' };
    const orphanRef = { domain: 'asset' as const, kind: 'asset', id: 'asset-orphan' };
    const missingBinaryRef = { domain: 'asset' as const, kind: 'asset', id: 'asset-missing-binary' };
    const previewOnlyRef = { domain: 'asset' as const, kind: 'asset', id: 'asset-preview-only' };
    const report = buildLocalDataCensusReport({
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

    const asset = report.domains.find((domain) => domain.domain === 'asset');

    expect(asset).toEqual(expect.objectContaining({
      baselineObjectIds: ['asset-missing-binary', 'asset-orphan', 'asset-owned', 'asset-preview-only'],
      activeObjectIds: ['asset-missing-binary', 'asset-owned'],
      missingBodyObjectIds: ['asset-missing-binary'],
      orphanBodyObjectIds: ['asset-orphan'],
      missingOwnerObjectIds: ['asset-orphan'],
      metadataIssueIds: ['previewOnly:asset-preview-only']
    }));
    expect(report.blockers).toEqual(expect.arrayContaining([
      'asset:missing-body',
      'asset:metadata-issue'
    ]));
    expect(report.warnings).toEqual(expect.arrayContaining([
      'asset:missing-owner',
      'asset:orphan-body'
    ]));
  });

  it('builds a full-domain read-only migration report with object and asset closure evidence', () => {
    const report = buildLocalDataCensusReport({
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
            activeConversationId: 'c-missing-active',
            conversations: [
              {
                id: 'c-1',
                collaboratorId: 'pharos',
                activeProjectId: 'project-from-conv',
                recordKey: 'chat-conversation-record-v1:c-1'
              },
              {
                id: 'c-2',
                collaboratorId: 'missing-persona',
                recordKey: 'chat-conversation-record-v1:c-2'
              },
              {
                id: 'c-3',
                collaboratorId: null,
                recordKey: 'chat-conversation-record-v1:c-3'
              }
            ]
          }
        },
        {
          key: 'chat-conversation-record-v1:c-1',
          value: {
            messages: [
              {
                attachments: [
                  { assetId: 'asset-ok' },
                  { assetId: 'asset-cleared', clearedAt: 1 }
                ]
              }
            ]
          }
        },
        {
          key: 'chat-conversation-record-v1:c-orphan',
          value: { messages: [{ attachments: [{ assetId: 'asset-missing-meta' }] }] }
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
                  referenceDocs: [{ id: 'memory-missing' }]
                }
              }
            ]
          }
        },
        { key: 'persona-memory-doc-content-v2:pharos:memory-orphan', value: 'orphan memory body' },
        {
          key: 'collection-state-v2',
          value: {
            cards: [
              {
                id: 'card-1',
                ownerCollaboratorId: 'pharos',
                code: 'url(polaris-asset://asset-ok)'
              },
              {
                id: 'card-2',
                ownerCollaboratorId: '',
                originConversationId: 'c-1',
                code: ''
              }
            ],
            imageCards: [
              { id: 'image-1', assetId: 'asset-missing-binary', ownerCollaboratorId: 'missing-persona' },
              { id: 'image-2', assetId: 'asset-ok', ownerCollaboratorId: 'collection-only-owner' }
            ],
            roomProjects: [
              { id: 'project-from-conv', ownerCollaboratorId: '' }
            ],
            projectFiles: [
              { id: 'file-1', projectId: 'project-missing', ownerCollaboratorId: 'pharos', content: '' }
            ],
            workspaceReferenceDocs: [
              { id: 'workspace-doc-1', projectId: 'project-missing', ownerCollaboratorId: 'pharos', summary: '', content: '' }
            ]
          }
        },
        { key: 'workspace-reference-doc-content-v1:workspace-orphan', value: 'orphan workspace body' },
        {
          key: 'space-theme-state-v1',
          value: {
            frontstageCollaboratorId: 'missing-persona',
            collectionProjectId: 'project-missing'
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

    const chat = report.domains.find((domain) => domain.domain === 'chat');
    const persona = report.domains.find((domain) => domain.domain === 'persona');
    const collection = report.domains.find((domain) => domain.domain === 'collection');
    const document = report.domains.find((domain) => domain.domain === 'document');
    const asset = report.domains.find((domain) => domain.domain === 'asset');
    const space = report.domains.find((domain) => domain.domain === 'space');

    expect(report.ok).toBe(false);
    expect(report.activeDataSource).toBe('unknown');
    expect(report.repositoryRowCount).toBe(1);
    expect(report.knownCollaboratorIds).toEqual(['pharos']);
    expect(report.knownOwnerIds).toEqual(['missing-persona', 'pharos', 'polaris-assistant']);
    expect(chat).toEqual(expect.objectContaining({
      baselineObjectIds: ['c-1', 'c-2', 'c-3'],
      activeObjectIds: ['c-1', 'c-2', 'c-3'],
      missingOwnerObjectIds: ['c-3'],
      danglingOwnerObjectIds: [],
      missingBodyObjectIds: ['c-2', 'c-3'],
      orphanBodyObjectIds: ['c-orphan'],
      assetRefIds: ['asset-ok'],
      metadataIssueIds: ['activeConversationId:c-missing-active']
    }));
    expect(persona).toEqual(expect.objectContaining({
      baselineObjectIds: ['pharos'],
      missingBodyObjectIds: ['pharos:memory-missing'],
      orphanBodyObjectIds: ['pharos:memory-orphan'],
      missingAssetBinaryRefIds: ['asset-avatar'],
      metadataIssueIds: ['activeCollaboratorId:missing-persona']
    }));
    expect(collection).toEqual(expect.objectContaining({
      missingOwnerObjectIds: ['card:card-2', 'project:project-from-conv'],
      recoverableOwnerObjectIds: ['card:card-2', 'project:project-from-conv'],
      unresolvedOwnerObjectIds: [],
      danglingOwnerObjectIds: ['image-card:image-2'],
      missingBodyObjectIds: ['workspace-doc-1'],
      orphanBodyObjectIds: ['workspace-orphan'],
      missingAssetBinaryRefIds: ['asset-missing-binary'],
      metadataIssueIds: ['projectFileProject:file-1', 'workspaceDocProject:workspace-doc-1']
    }));
    expect(document).toEqual(expect.objectContaining({
      baselineObjectIds: ['persona-memory-doc:pharos:memory-missing', 'workspace-reference-doc:workspace-doc-1'],
      activeObjectIds: [],
      missingBodyObjectIds: ['persona-memory-doc:pharos:memory-missing', 'workspace-reference-doc:workspace-doc-1'],
      orphanBodyObjectIds: ['persona:pharos:memory-orphan', 'workspace:workspace-orphan']
    }));
    expect(asset).toEqual(expect.objectContaining({
      baselineObjectIds: ['asset-avatar', 'asset-missing-binary', 'asset-ok', 'asset-unreferenced'],
      activeObjectIds: ['asset-avatar', 'asset-missing-binary', 'asset-ok'],
      missingBodyObjectIds: ['asset-avatar', 'asset-missing-binary'],
      orphanBodyObjectIds: ['asset-unreferenced'],
      metadataIssueIds: ['previewOnly:asset-preview-only']
    }));
    expect(space).toEqual(expect.objectContaining({
      baselineObjectIds: ['localStorage:polaris-space-store-v1', 'space-theme-state-v1'],
      metadataIssueIds: ['collectionProjectId:project-missing', 'frontstageCollaboratorId:missing-persona']
    }));
    expect(report.totals).toEqual(expect.objectContaining({
      missingBodyObjectCount: 8,
      recoverableOwnerObjectCount: 2,
      unresolvedOwnerObjectCount: 0,
      danglingOwnerObjectCount: 1,
      metadataIssueCount: 7
    }));
    expect(report.blockers).toEqual(expect.arrayContaining([
      'chat:missing-body',
      'persona:missing-body',
      'document:missing-body',
      'collection:metadata-issue',
      'asset:metadata-issue',
      'space:metadata-issue'
    ]));
    expect(formatLocalDataCensusReport(report)).toContain('ok: false');
  });

  it('reports chunked document bodies shorter than their directory as missing body evidence', () => {
    const report = buildLocalDataCensusReport({
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
            roomProjects: [],
            projectFiles: [],
            workspaceReferenceDocs: [
              { id: 'workspace-tail-missing', projectId: 'project-1', summary: '', content: '', charCount: 11, contentLoaded: false }
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

    const persona = report.domains.find((domain) => domain.domain === 'persona');
    const collection = report.domains.find((domain) => domain.domain === 'collection');
    const document = report.domains.find((domain) => domain.domain === 'document');

    expect(report.ok).toBe(false);
    expect(report.blockers).toEqual(expect.arrayContaining([
      'persona:missing-body',
      'collection:missing-body',
      'document:missing-body',
      'document:metadata-issue'
    ]));
    expect(persona).toEqual(expect.objectContaining({
      missingBodyObjectIds: ['pharos:memory-tail-missing']
    }));
    expect(collection).toEqual(expect.objectContaining({
      missingBodyObjectIds: ['workspace-tail-missing']
    }));
    expect(document).toEqual(expect.objectContaining({
      activeObjectIds: [],
      missingBodyObjectIds: [
        'persona-memory-doc:pharos:memory-tail-missing',
        'workspace-reference-doc:workspace-tail-missing'
      ],
      metadataIssueIds: [
        'chunk:persona-memory-doc:pharos:memory-tail-missing',
        'chunk:workspace-reference-doc:workspace-tail-missing'
      ]
    }));
  });
});
