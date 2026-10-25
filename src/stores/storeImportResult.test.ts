import { describe, expect, it } from 'vitest';
import { formatStoreImportResult } from './storeImportResult';

describe('formatStoreImportResult', () => {
  it('makes independent domain success and retained failures explicit', () => {
    expect(formatStoreImportResult({
      status: 'partial',
      importedDomains: ['chat', 'runtime'],
      retainedDomains: [{
        domain: 'collection',
        stage: 'domain-commit',
        reason: 'injected commit interruption'
      }]
    })).toBe('部分导入完成：2 个数据域已更新。房间写入失败，已有数据没有被清空。');
  });

  it('separates activation or refresh verification from retained data', () => {
    expect(formatStoreImportResult({
      status: 'partial',
      importedDomains: ['chat'],
      retainedDomains: [{
        domain: 'chat',
        stage: 'promotion',
        reason: 'verification unavailable'
      }]
    })).toBe('部分导入完成：1 个数据域已更新。对话的激活、清理或界面刷新将在下次启动继续检查。');
  });
});

it('reports retained document directories without claiming their bodies were restored', () => {
  expect(formatStoreImportResult({status: 'complete', importedDomains: ['persona', 'document'], retainedDomains: [],
    missingDocumentBodies: [{personaId: 'p', docId: 'd', title: 'Notes'}]}))
    .toBe('导入完成：2 个数据域已安全替换。其中 1 份资料缺少正文，标题和摘要已保留：Notes。');
});
