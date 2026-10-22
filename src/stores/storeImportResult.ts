import type { LocalDataDomain } from '../engines/localData';

export type StoreImportDomainFailure = {
  domain: LocalDataDomain | 'localStorage';
  stage: 'asset-staging' | 'domain-commit' | 'promotion' | 'local-storage' | 'refresh' | 'cleanup';
  reason: string;
};

export type ImportedMissingDocumentBody = { personaId: string; docId: string; title: string };

export type StoreImportResult = {
  status: 'complete' | 'partial';
  missingDocumentBodies?: ImportedMissingDocumentBody[];
  importedDomains: LocalDataDomain[];
  retainedDomains: StoreImportDomainFailure[];
};

const DOMAIN_LABELS: Record<StoreImportDomainFailure['domain'], string> = {
  chat: '对话',
  collection: '房间',
  persona: '协作者',
  runtime: '设置',
  space: '界面状态',
  asset: '附件',
  document: '文档',
  localStorage: '本地界面状态'
};

export function formatStoreImportResult(result: StoreImportResult) {
  const missing = result.missingDocumentBodies ?? [];
  const documentNotice = missing.length
    ? `其中 ${missing.length} 份资料缺少正文，标题和摘要已保留：${missing.map(doc => doc.title || doc.docId).join('、')}。` : '';
  if (result.status === 'complete') {
    return `导入完成：${result.importedDomains.length} 个数据域已安全替换。${documentNotice}`;
  }
  const retained = result.retainedDomains
    .filter((entry) => entry.stage !== 'promotion' && entry.stage !== 'refresh')
    .map((entry) => DOMAIN_LABELS[entry.domain]);
  const verification = result.retainedDomains
    .filter((entry) => entry.stage === 'promotion' || entry.stage === 'refresh' || entry.stage === 'cleanup')
    .map((entry) => DOMAIN_LABELS[entry.domain]);
  const parts = [`部分导入完成：${result.importedDomains.length} 个数据域已更新。`];
  if (retained.length > 0) {
    parts.push(`${Array.from(new Set(retained)).join('、')}写入失败，已有数据没有被清空。`);
  }
  if (verification.length > 0) {
    parts.push(`${Array.from(new Set(verification)).join('、')}的激活、清理或界面刷新将在下次启动继续检查。`);
  }
  return parts.join('') + documentNotice;
}
